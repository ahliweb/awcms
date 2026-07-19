/**
 * SSRF guard for tenant-configured OIDC outbound calls (Issue #185, epic
 * ERP-readiness enterprise auth #177). NEW in awcms — awcms-mini's generic SSO
 * (#591/#603) deliberately did NOT IP-range-block `issuer_url` (it assumed a
 * `full_online` profile reaching an on-prem IdP over a private VPN). Issue #185
 * for this base makes the opposite, stricter choice its top security
 * requirement: discovery/JWKS/token URLs are HTTPS-only and must never reach a
 * private/loopback/link-local/metadata address.
 *
 * The `issuer_url` (and whatever `token_endpoint`/`jwks_uri` its discovery
 * document points at) is the ONE outbound URL in this codebase that comes from
 * tenant-admin data rather than server env config, and the `/start` entry point
 * that triggers the fetch is unauthenticated — so ABAC on
 * `sso_providers.create` limits who can CONFIGURE a malicious URL but not who
 * can TRIGGER the fetch. This guard is the actual control.
 *
 * Layers (all fail-closed, every one unit-tested in `tests/oidc-ssrf.test.ts`):
 *   1. Scheme: `https:` only — except a host explicitly allow-listed in
 *      `AUTH_SSO_ALLOW_INSECURE_HOSTS` (the reviewed escape hatch for a LOCAL
 *      fake IdP in tests only; never a real IdP), which may use `http:`.
 *   2. No embedded credentials in the URL (`user:pass@host`).
 *   3. DNS-resolve the host and reject if ANY resolved A/AAAA address is in a
 *      blocked range (private/loopback/link-local/ULA/CGNAT/metadata/multicast/
 *      reserved, plus IPv4-mapped/NAT64 IPv6 that embed a blocked v4). An IP
 *      literal host is validated directly. This closes "issuer_url points at an
 *      internal address" and, by validating BEFORE connecting, the primary DNS
 *      shape of a rebinding attack. (Residual: a name that flips to an internal
 *      IP in the window between this resolve and the socket connect cannot be
 *      closed without a low-level connect-time pin, which Bun's `fetch` does not
 *      expose — documented as an accepted residual in ADR-0028. The real bound
 *      is NOT the positive discovery/JWKS cache TTL (1 hour, and it never fills
 *      on a rebind — a rebound response fails the issuer/shape parse), but the
 *      30-second NEGATIVE-result cache plus the per-`${tenantId}:${providerKey}`
 *      circuit breaker in `generic-oidc-client.ts`, which throttle repeated
 *      probing of a target that keeps failing.)
 *   4. Redirects are followed MANUALLY, re-validating every hop's URL through
 *      the same guard, capped at `maxRedirects` — a 30x to an internal URL is
 *      blocked exactly like a direct one.
 *   5. Bounded timeout (via `AbortController`) and a hard response-size cap —
 *      a hostile endpoint cannot hang the caller or exhaust memory.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SsrfGuardResult =
  { ok: true; response: Response } | { ok: false; reason: SsrfDenyReason };

export type SsrfDenyReason =
  | "invalid_url"
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "dns_resolution_failed"
  | "blocked_address"
  | "too_many_redirects"
  | "response_too_large"
  | "request_failed";

export type SsrfFetchOptions = {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects?: number;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Parses `AUTH_SSO_ALLOW_INSECURE_HOSTS` (comma-separated `host` or `host:port`
 * entries) — the ONLY way to reach a non-HTTPS or loopback/private address, for
 * a local fake IdP in tests. Empty/unset on every real deployment.
 */
export function parseInsecureHostAllowList(
  env: NodeJS.ProcessEnv = process.env
): Set<string> {
  const raw = env.AUTH_SSO_ALLOW_INSECURE_HOSTS?.trim();

  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

function isHostAllowListed(url: URL, allowList: Set<string>): boolean {
  if (allowList.size === 0) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const hostPort = url.port ? `${host}:${url.port}` : host;

  return allowList.has(host) || allowList.has(hostPort);
}

/** Parses a dotted-quad IPv4 string into a 32-bit unsigned integer, or null. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet > 255) {
      return null;
    }

    value = value * 256 + octet;
  }

  return value >>> 0;
}

function inRange(value: number, cidrBase: string, prefix: number): boolean {
  const base = ipv4ToInt(cidrBase);

  if (base === null) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (value & mask) === (base & mask);
}

/**
 * True when an IPv4 address is NOT a globally-routable public address:
 * this-network, private (RFC1918), CGNAT, loopback, link-local (incl. the
 * `169.254.169.254` cloud metadata endpoint), benchmarking, documentation,
 * multicast, reserved, and broadcast ranges.
 */
export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);

  if (value === null) {
    return true; // unparseable → fail closed
  }

  const blockedRanges: Array<[string, number]> = [
    ["0.0.0.0", 8], // "this" network
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local incl. 169.254.169.254 metadata
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1 documentation
    ["192.88.99.0", 24], // 6to4 relay anycast
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4] // reserved (includes 255.255.255.255 broadcast)
  ];

  return blockedRanges.some(([base, prefix]) => inRange(value, base, prefix));
}

/** Expands an IPv6 address to its 8 hextet groups (numbers), or null if malformed. */
function ipv6Groups(ip: string): number[] | null {
  let address = ip;

  // Strip a zone id (fe80::1%eth0) — the address portion is what matters here.
  const zoneIndex = address.indexOf("%");
  if (zoneIndex !== -1) {
    address = address.slice(0, zoneIndex);
  }

  // Handle an embedded IPv4 tail (::ffff:1.2.3.4 / 64:ff9b::1.2.3.4).
  let ipv4Tail: number | null = null;
  const lastColon = address.lastIndexOf(":");
  const tail = lastColon === -1 ? "" : address.slice(lastColon + 1);
  if (tail.includes(".")) {
    ipv4Tail = ipv4ToInt(tail);
    if (ipv4Tail === null) {
      return null;
    }
    address = `${address.slice(0, lastColon + 1)}${(
      (ipv4Tail >>> 16) &
      0xffff
    ).toString(16)}:${(ipv4Tail & 0xffff).toString(16)}`;
  }

  const doubleColonParts = address.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  const head = doubleColonParts[0] ? doubleColonParts[0].split(":") : [];
  const tailGroups =
    doubleColonParts.length === 2 && doubleColonParts[1]
      ? doubleColonParts[1].split(":")
      : [];

  const parseGroup = (group: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    return parseInt(group, 16);
  };

  const headNums: number[] = [];
  for (const group of head) {
    const n = parseGroup(group);
    if (n === null) return null;
    headNums.push(n);
  }

  const tailNums: number[] = [];
  for (const group of tailGroups) {
    const n = parseGroup(group);
    if (n === null) return null;
    tailNums.push(n);
  }

  if (doubleColonParts.length === 2) {
    const missing = 8 - headNums.length - tailNums.length;
    if (missing < 0) return null;
    return [...headNums, ...Array(missing).fill(0), ...tailNums];
  }

  return headNums.length === 8 ? headNums : null;
}

/**
 * True when an IPv6 address is NOT globally routable: unspecified, loopback,
 * ULA (fc00::/7), link-local (fe80::/10), multicast (ff00::/8), documentation,
 * and — crucially — IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96), and the
 * deprecated IPv4-compatible form (::a.b.c.d, ::/96) that embed an IPv4 address,
 * whose embedded v4 is re-checked against `isBlockedIpv4` (a bypass otherwise:
 * `::ffff:169.254.169.254`, `::169.254.169.254`).
 */
export function isBlockedIpv6(ip: string): boolean {
  const groups = ipv6Groups(ip);

  if (groups === null) {
    return true; // unparseable → fail closed
  }

  const [g0, g1, g5, g6, g7] = [
    groups[0]!,
    groups[1]!,
    groups[5]!,
    groups[6]!,
    groups[7]!
  ];

  // Unspecified :: and loopback ::1
  if (groups.every((g) => g === 0)) {
    return true; // ::
  }
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) {
    return true; // ::1
  }

  // IPv4-mapped ::ffff:a.b.c.d (0:0:0:0:0:ffff:xxxx:xxxx)
  if (groups.slice(0, 5).every((g) => g === 0) && g5 === 0xffff) {
    const embedded = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(embedded);
  }

  // NAT64 64:ff9b::/96
  if (
    g0 === 0x64 &&
    g1 === 0xff9b &&
    groups.slice(2, 6).every((g) => g === 0)
  ) {
    const embedded = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(embedded);
  }

  // Deprecated IPv4-compatible ::a.b.c.d (::/96 — first six groups all zero,
  // NOT the ::ffff: mapped form above which has g5=0xffff). Re-check the
  // embedded v4, else `::169.254.169.254` / `::10.0.0.1` slip through as
  // "public" (auditor L2). `::`/`::1` are already handled above.
  if (groups.slice(0, 6).every((g) => g === 0)) {
    const embedded = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(embedded);
  }

  // fc00::/7 ULA
  if ((g0 & 0xfe00) === 0xfc00) {
    return true;
  }
  // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfe80) {
    return true;
  }
  // ff00::/8 multicast
  if ((g0 & 0xff00) === 0xff00) {
    return true;
  }
  // 2001:db8::/32 documentation
  if (g0 === 0x2001 && g1 === 0x0db8) {
    return true;
  }

  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);

  if (family === 4) {
    return isBlockedIpv4(ip);
  }
  if (family === 6) {
    return isBlockedIpv6(ip);
  }

  return true; // not a valid IP literal → fail closed
}

export type UrlValidation =
  { ok: true } | { ok: false; reason: SsrfDenyReason };

/**
 * Validates a single outbound URL: scheme, no embedded credentials, and every
 * resolved address public. Exported so unit tests can drive it directly and so
 * the redirect loop below can re-validate each hop.
 */
export async function validateOutboundUrl(
  rawUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  resolver: (host: string) => Promise<string[]> = defaultResolver
): Promise<UrlValidation> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: "credentials_in_url" };
  }

  const allowList = parseInsecureHostAllowList(env);
  const allowListed = isHostAllowListed(url, allowList);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowListed)) {
    return { ok: false, reason: "scheme_not_allowed" };
  }

  // An explicitly allow-listed local host (tests only) bypasses the IP-range
  // checks — that is the whole point of the escape hatch (a fake IdP on
  // 127.0.0.1). Never set on a real deployment.
  if (allowListed) {
    return { ok: true };
  }

  const host = url.hostname;
  const literalFamily = isIP(host);

  if (literalFamily !== 0) {
    return isBlockedAddress(host)
      ? { ok: false, reason: "blocked_address" }
      : { ok: true };
  }

  let addresses: string[];

  try {
    addresses = await resolver(host);
  } catch {
    return { ok: false, reason: "dns_resolution_failed" };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: "dns_resolution_failed" };
  }

  if (addresses.some((address) => isBlockedAddress(address))) {
    return { ok: false, reason: "blocked_address" };
  }

  return { ok: true };
}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

async function readCappedResponse(
  response: Response,
  maxBytes: number
): Promise<Response | null> {
  const body = response.body;

  if (!body) {
    return new Response(null, {
      status: response.status,
      headers: response.headers
    });
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }

    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(combined, {
    status: response.status,
    headers: response.headers
  });
}

/**
 * SSRF-safe outbound fetch with manual, re-validated redirects, a bounded
 * timeout, and a hard response-size cap. Returns a discriminated result — never
 * throws for a policy denial (only genuinely unexpected internal errors surface
 * as `request_failed`). The returned `Response`'s body has already been fully
 * buffered under the size cap, so callers may `.json()`/`.text()` it freely.
 *
 * `timeoutMs` is a TOTAL wall-clock budget covering EVERY hop AND the body read
 * (auditor L3): a single `AbortController` + timer spans the whole call, so a
 * hostile IdP cannot slow-drip a body that stays under the size cap past the
 * deadline — the abort tears down the in-flight fetch/stream and the read
 * rejects, surfacing as `request_failed`.
 */
export async function ssrfSafeFetch(
  rawUrl: string,
  options: SsrfFetchOptions
): Promise<SsrfGuardResult> {
  const env = options.env ?? process.env;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = rawUrl;
  let currentMethod = options.method ?? "GET";
  let currentBody = options.body;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const validation = await validateOutboundUrl(currentUrl, env);

      if (!validation.ok) {
        return { ok: false, reason: validation.reason };
      }

      let response: Response;

      try {
        response = await fetch(currentUrl, {
          method: currentMethod,
          headers: options.headers,
          body: currentBody,
          redirect: "manual",
          signal: controller.signal
        });
      } catch {
        // Network error, or the total-budget timer aborted the connection.
        return { ok: false, reason: "request_failed" };
      }

      // Manual redirect handling — re-validate the Location target through the
      // full guard so a 30x to an internal address is blocked exactly like a
      // direct request to one.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");

        if (!location) {
          // A redirect with no Location is unusable — treat as a failed request
          // rather than returning a 3xx the caller cannot follow.
          return { ok: false, reason: "request_failed" };
        }

        let nextUrl: string;

        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return { ok: false, reason: "invalid_url" };
        }

        if (hop === maxRedirects) {
          return { ok: false, reason: "too_many_redirects" };
        }

        currentUrl = nextUrl;
        // Per RFC 7231, a 303 (and the common 301/302 practice) turns the
        // follow into a GET with no body.
        currentMethod = "GET";
        currentBody = undefined;
        continue;
      }

      let capped: Response | null;

      try {
        // Covered by the same total-budget timer: a slow-drip body past the
        // deadline aborts the stream and rejects here → request_failed.
        capped = await readCappedResponse(response, options.maxResponseBytes);
      } catch {
        return { ok: false, reason: "request_failed" };
      }

      if (capped === null) {
        return { ok: false, reason: "response_too_large" };
      }

      return { ok: true, response: capped };
    }

    return { ok: false, reason: "too_many_redirects" };
  } finally {
    clearTimeout(timer);
  }
}
