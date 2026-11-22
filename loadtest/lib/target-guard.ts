/**
 * Target guard (Issue #1283). A load generator looks like a DoS tool, so it
 * refuses a target that is not provably this machine or a private network
 * unless the operator names that exact host again on the command line.
 *
 * Pure: it only parses the URL. It cannot know which host is "production", so
 * the safe default is "anything routable is refused until confirmed".
 */

export type TargetVerdict = { ok: boolean; host: string; reason?: string };

function ipv4Private(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = [octets[0]!, octets[1]!];
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "::1" ||
    ipv4Private(h)
  );
}

export function assessTarget(
  baseUrl: string,
  confirmedHost: string | undefined
): TargetVerdict {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, host: "", reason: "--base-url is not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, host: url.hostname, reason: "only http(s) targets" };
  }
  const host = url.hostname.toLowerCase();
  if (isLocalHost(host)) return { ok: true, host };
  if (confirmedHost !== undefined && confirmedHost.toLowerCase() === host) {
    return { ok: true, host };
  }
  return {
    ok: false,
    host,
    reason:
      `refusing to load "${host}": it is not loopback or a private address. ` +
      `If this is an environment you own and approved for load, repeat the host ` +
      `with --confirm-remote-target ${host}. Never aim this at production.`
  };
}
