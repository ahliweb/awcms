/**
 * Optional Cloudflare DNS adapter. Manual domain management (`POST
 * /api/v1/tenant/domains/{id}/verify`) remains the MVP default — this adapter
 * is never called unless an operator explicitly sets
 * `TENANT_DOMAIN_DNS_PROVIDER=cloudflare` (see
 * `../domain/tenant-domain-dns-config.ts`). **No route in this repo calls it
 * yet** — wiring it into `.../verify` or a "provision platform subdomain" flow
 * is deferred (see the module README's §Not yet available); this file exists so
 * that future work can depend on the `TenantDomainDnsProvider` port without
 * inventing the provider boundary, config split, or redaction/timeout/
 * idempotency behavior at that point. awcms builds and runs with no Cloudflare
 * credentials configured — `resolveTenantDomainDnsProvider` degrades to a clean
 * misconfigured-result provider rather than throwing.
 *
 * Capabilities: create a TXT/CNAME DNS verification record, and check whether a
 * DNS record has propagated to the value expected. Both calls are
 * timeout-bounded (`withTimeout`) and gated by a shared circuit breaker
 * (`getProviderCircuitBreaker("tenant-domain-cloudflare-dns")`) — the same
 * pattern the email/sync-storage outbound provider calls already use. Both
 * methods are meant to be invoked OUTSIDE any DB transaction (ADR-0006) — this
 * file never opens, or participates in, one.
 *
 * Security notes (binding):
 * - `apiToken`/`zoneId` are read only from configuration
 *   (`resolveTenantDomainDnsProvider(env)` below) — never persisted to
 *   `awcms_tenant_domains`, never rendered in any response.
 *   `verification_record_value` (migration 046) is the *public* DNS value a
 *   tenant is told to publish, never this token.
 * - Errors returned to callers are redacted: never the raw Cloudflare API
 *   response `errors[].message` text (only the numeric `errors[].code` values
 *   are surfaced — safe, non-identifying), never the configured token or zone
 *   id, never a stack trace. `redact()` additionally strips the configured
 *   secrets out of any thrown-error text as defense in depth.
 * - `createVerificationRecord`/`checkVerificationStatus` reject any `recordName`
 *   that is not `TENANT_DOMAIN_PLATFORM_ROOT_DOMAIN` itself or a subdomain of it
 *   (`isWithinPlatformRootDomain`) — this adapter refuses to create or query DNS
 *   records for an arbitrary caller-supplied hostname outside the platform's own
 *   managed zone. Record-name shape validation is a dedicated check, not a reuse
 *   of `normalizePublicHost()` — DNS verification record names conventionally
 *   use an underscore-prefixed label (e.g. `_acme-challenge.example.com`) that a
 *   `Host`-header shape check rightly rejects but every DNS verification flow
 *   needs to allow; see `isValidDnsRecordNameShape` below. `normalizePublicHost()`
 *   is still reused for the CNAME *target value* (a real "points-to" hostname).
 * - `createVerificationRecord` is idempotent: it first lists existing records
 *   with the same type/name/content and returns `{ ok: true, alreadyExists:
 *   true }` without a second write if a match is already present.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTimeout } from "../../../lib/integration/timeout";
import { normalizePublicHost } from "../../../lib/tenant/public-host-tenant-resolver";
import {
  DEFAULT_TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS,
  isKnownTenantDomainDnsProvider,
  resolveTenantDomainCloudflareTimeoutMs,
  TENANT_DOMAIN_CLOUDFLARE_REQUIRED_WHEN_SELECTED
} from "../domain/tenant-domain-dns-config";

const PROVIDER_KEY = "tenant-domain-cloudflare-dns";
const DEFAULT_TIMEOUT_MS = DEFAULT_TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS;
const MAX_ERROR_MESSAGE_LENGTH = 300;
const DEFAULT_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const MAX_TXT_VALUE_LENGTH = 2048; // Cloudflare TXT record content limit.

export type DnsRecordType = "TXT" | "CNAME";

export type CreateVerificationRecordInput = {
  recordType: DnsRecordType;
  /** Fully-qualified DNS name, e.g. "_awcms-verify.tenant1.platform.example". Must equal or be a subdomain of the configured platform root domain. */
  recordName: string;
  /** TXT record content, or the CNAME target hostname. */
  recordValue: string;
};

export type CreateVerificationRecordResult =
  | { ok: true; providerRecordId?: string; alreadyExists: boolean }
  | { ok: false; error: string; retryable: boolean };

export type CheckVerificationStatusInput = {
  recordType: DnsRecordType;
  recordName: string;
  expectedValue: string;
};

export type CheckVerificationStatusResult =
  | { ok: true; verified: boolean }
  | { ok: false; error: string; retryable: boolean };

/**
 * The port. A future issue that wires this into `.../verify` or a
 * subdomain-provisioning endpoint should depend on this type, never on
 * `createCloudflareDnsProvider` by name.
 */
export type TenantDomainDnsProvider = {
  createVerificationRecord(
    input: CreateVerificationRecordInput
  ): Promise<CreateVerificationRecordResult>;
  checkVerificationStatus(
    input: CheckVerificationStatusInput
  ): Promise<CheckVerificationStatusResult>;
};

export type CloudflareDnsProviderConfig = {
  zoneId: string;
  apiToken: string;
  platformRootDomain: string;
  /** Override for tests/dev only — a local fake HTTP server standing in for the Cloudflare API. Always supplied from configuration, never from request/user input (SSRF-safe). */
  baseUrl?: string;
  /** Defaults to `DEFAULT_TIMEOUT_MS` (8s) if omitted. `resolveTenantDomainDnsProvider` below always passes `resolveTenantDomainCloudflareTimeoutMs(env)` here, so production deployments tune this via `TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS`, not by editing code. */
  timeoutMs?: number;
};

type CloudflareApiError = { code: number; message: string };

type CloudflareApiResponse<T> = {
  success: boolean;
  errors?: CloudflareApiError[];
  result?: T;
};

type CloudflareDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
};

function truncate(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

/**
 * Strips the configured secret/identifier values out of `message` before it is
 * ever returned to a caller or logged — defense in depth against a thrown error
 * accidentally echoing part of the request (e.g. a `fetch()` network-error
 * message that includes the target URL, which embeds the zone id).
 */
function redact(message: string, secrets: readonly string[]): string {
  let sanitized = message;

  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.split(secret).join("[redacted]");
    }
  }

  return sanitized;
}

/**
 * Only the numeric Cloudflare `errors[].code` values are surfaced — never
 * `.message`, which can echo request content this adapter does not fully
 * control.
 */
function summarizeApiErrors(errors: CloudflareApiError[] | undefined): string {
  if (!errors || errors.length === 0) {
    return "no error detail provided";
  }

  return `error code(s) ${errors.map((error) => error.code).join(", ")}`;
}

const MAX_RECORD_NAME_LENGTH = 253; // RFC 1035 total hostname length limit.
const MAX_RECORD_NAME_LABEL_LENGTH = 63; // RFC 1035 per-label length limit.
// Deliberately more permissive than `normalizePublicHost()`'s
// `HOST_LABEL_PATTERN`: DNS verification record names conventionally use an
// underscore-prefixed label (e.g. "_acme-challenge.example.com",
// "_dmarc.example.com") that RFC 1035 technically disallows but every major DNS
// verification flow uses and every public resolver accepts (RFC 2181 §11
// relaxes the restriction). A `Host` header, by contrast, is never legitimately
// underscore-prefixed — which is why this file does not reuse
// `normalizePublicHost()` for `recordName` shape, only for the CNAME *target
// value* below (a real "points-to" hostname, not a record label).
const RECORD_NAME_LABEL_PATTERN = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;

function isValidDnsRecordNameShape(value: string): boolean {
  const trimmed = value.trim().toLowerCase();

  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_RECORD_NAME_LENGTH ||
    trimmed.startsWith(".") ||
    trimmed.endsWith(".") ||
    trimmed.includes("..") ||
    /\s/.test(trimmed)
  ) {
    return false;
  }

  return trimmed
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= MAX_RECORD_NAME_LABEL_LENGTH &&
        RECORD_NAME_LABEL_PATTERN.test(label)
    );
}

/**
 * `recordName` must equal `platformRootDomain` or be a subdomain of it —
 * refuses to let this adapter touch a hostname outside the platform's own
 * managed zone, even though the configured Cloudflare zone/token may technically
 * be able to. `platformRootDomain` comes from trusted operator configuration
 * (`TENANT_DOMAIN_PLATFORM_ROOT_DOMAIN`), not request input.
 */
function isWithinPlatformRootDomain(
  recordName: string,
  platformRootDomain: string
): boolean {
  const normalizedRoot = platformRootDomain.trim().toLowerCase();

  if (
    normalizedRoot.length === 0 ||
    !isValidDnsRecordNameShape(normalizedRoot)
  ) {
    return false;
  }

  if (!isValidDnsRecordNameShape(recordName)) {
    return false;
  }

  const normalizedName = recordName.trim().toLowerCase();

  return (
    normalizedName === normalizedRoot ||
    normalizedName.endsWith(`.${normalizedRoot}`)
  );
}

function isValidRecordValue(
  recordType: DnsRecordType,
  value: unknown
): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  if (/[\r\n]/.test(value)) {
    return false;
  }

  if (recordType === "TXT") {
    return value.length <= MAX_TXT_VALUE_LENGTH;
  }

  // CNAME target must itself look like a plausible hostname.
  try {
    return normalizePublicHost(value) !== null;
  } catch {
    return false;
  }
}

/**
 * Validates a DNS-record request before any network call is attempted — "do not
 * allow arbitrary DNS record creation from user-controlled input without
 * validation". Pure, exported for unit testing without a network double.
 */
export function validateDnsRecordInput(
  input: { recordType: unknown; recordName: unknown; recordValue: unknown },
  platformRootDomain: string
): string | null {
  if (input.recordType !== "TXT" && input.recordType !== "CNAME") {
    return 'recordType must be "TXT" or "CNAME".';
  }

  if (
    typeof input.recordName !== "string" ||
    !isWithinPlatformRootDomain(input.recordName, platformRootDomain)
  ) {
    return "recordName must equal the platform root domain or be a subdomain of it.";
  }

  if (!isValidRecordValue(input.recordType, input.recordValue)) {
    return "recordValue is not a valid value for the given recordType.";
  }

  return null;
}

function normalizeRecordValueForComparison(
  recordType: DnsRecordType,
  value: string
): string {
  const trimmed = value.trim();

  if (recordType === "CNAME") {
    return trimmed.replace(/\.$/, "").toLowerCase();
  }

  return trimmed;
}

export function createCloudflareDnsProvider(
  config: CloudflareDnsProviderConfig
): TenantDomainDnsProvider {
  const baseUrl = config.baseUrl ?? DEFAULT_API_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const breaker = getProviderCircuitBreaker(PROVIDER_KEY);
  const secrets = [config.apiToken, config.zoneId];

  async function callApi<T>(
    path: string,
    init: RequestInit,
    label: string
  ): Promise<{ status: number; body: CloudflareApiResponse<T> | undefined }> {
    const response = await withTimeout(
      fetch(`${baseUrl}/zones/${config.zoneId}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {})
        }
      }),
      timeoutMs,
      label
    );

    const rawBody = await response.text().catch(() => "");
    let body: CloudflareApiResponse<T> | undefined;

    try {
      body = rawBody
        ? (JSON.parse(rawBody) as CloudflareApiResponse<T>)
        : undefined;
    } catch {
      body = undefined;
    }

    return { status: response.status, body };
  }

  async function listMatchingRecords(
    recordType: DnsRecordType,
    recordName: string
  ): Promise<CloudflareDnsRecord[]> {
    const query = new URLSearchParams({ type: recordType, name: recordName });
    const { status, body } = await callApi<CloudflareDnsRecord[]>(
      `/dns_records?${query.toString()}`,
      { method: "GET" },
      "cloudflare dns list records"
    );

    if (status < 200 || status >= 300 || !body?.success) {
      throw new Error(
        `Cloudflare DNS API list request failed (HTTP ${status}, ${summarizeApiErrors(body?.errors)}).`
      );
    }

    return body.result ?? [];
  }

  return {
    async createVerificationRecord(input) {
      const attemptedAt = new Date();
      const validationError = validateDnsRecordInput(
        input,
        config.platformRootDomain
      );

      if (validationError) {
        return { ok: false, error: validationError, retryable: false };
      }

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "Cloudflare DNS circuit breaker is open; skipping attempt.",
          retryable: true
        };
      }

      try {
        const existing = await listMatchingRecords(
          input.recordType,
          input.recordName
        );
        const match = existing.find(
          (record) => record.content === input.recordValue
        );

        if (match) {
          breaker.recordSuccess(attemptedAt);
          return { ok: true, providerRecordId: match.id, alreadyExists: true };
        }

        const { status, body } = await callApi<CloudflareDnsRecord>(
          "/dns_records",
          {
            method: "POST",
            body: JSON.stringify({
              type: input.recordType,
              name: input.recordName,
              content: input.recordValue,
              ttl: 300,
              proxied: false
            })
          },
          "cloudflare dns create record"
        );

        if (status < 200 || status >= 300 || !body?.success) {
          breaker.recordFailure(attemptedAt);
          return {
            ok: false,
            error: truncate(
              redact(
                `Cloudflare DNS API create request failed (HTTP ${status}, ${summarizeApiErrors(body?.errors)}).`,
                secrets
              )
            ),
            retryable: status >= 500 || status === 0
          };
        }

        breaker.recordSuccess(attemptedAt);
        return {
          ok: true,
          providerRecordId: body.result?.id,
          alreadyExists: false
        };
      } catch (error) {
        breaker.recordFailure(attemptedAt);
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: truncate(redact(message, secrets)),
          retryable: true
        };
      }
    },

    async checkVerificationStatus(input) {
      const attemptedAt = new Date();
      const validationError = validateDnsRecordInput(
        { ...input, recordValue: input.expectedValue },
        config.platformRootDomain
      );

      if (validationError) {
        return { ok: false, error: validationError, retryable: false };
      }

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "Cloudflare DNS circuit breaker is open; skipping attempt.",
          retryable: true
        };
      }

      try {
        const records = await listMatchingRecords(
          input.recordType,
          input.recordName
        );
        const verified = records.some(
          (record) =>
            normalizeRecordValueForComparison(
              input.recordType,
              record.content
            ) ===
            normalizeRecordValueForComparison(
              input.recordType,
              input.expectedValue
            )
        );

        breaker.recordSuccess(attemptedAt);
        return { ok: true, verified };
      } catch (error) {
        breaker.recordFailure(attemptedAt);
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: truncate(redact(message, secrets)),
          retryable: true
        };
      }
    }
  };
}

function createMisconfiguredProvider(reason: string): TenantDomainDnsProvider {
  return {
    async createVerificationRecord() {
      return { ok: false, error: reason, retryable: false };
    },
    async checkVerificationStatus() {
      return { ok: false, error: reason, retryable: false };
    }
  };
}

/**
 * Production resolver: builds the configured provider from `env`, degrading to
 * a clean misconfigured-result provider — never throwing — whenever
 * `TENANT_DOMAIN_DNS_PROVIDER=cloudflare` is missing required config, or the var
 * is unset/`"manual"`/unrecognized. **Not called from anywhere yet** — no route
 * wires it in; see the module README's §Not yet available.
 */
export function resolveTenantDomainDnsProvider(
  env: NodeJS.ProcessEnv = process.env
): TenantDomainDnsProvider {
  const provider = env.TENANT_DOMAIN_DNS_PROVIDER ?? "manual";

  if (!isKnownTenantDomainDnsProvider(provider)) {
    return createMisconfiguredProvider(
      "TENANT_DOMAIN_DNS_PROVIDER is not a known provider."
    );
  }

  if (provider === "manual") {
    return createMisconfiguredProvider(
      'TENANT_DOMAIN_DNS_PROVIDER is "manual" — no automated DNS provider is configured; use manual verification (POST /api/v1/tenant/domains/{id}/verify).'
    );
  }

  const zoneId = env.TENANT_DOMAIN_CLOUDFLARE_ZONE_ID;
  const apiToken = env.TENANT_DOMAIN_CLOUDFLARE_API_TOKEN;
  const platformRootDomain = env.TENANT_DOMAIN_PLATFORM_ROOT_DOMAIN;

  if (!zoneId || !apiToken || !platformRootDomain) {
    return createMisconfiguredProvider(
      `Cloudflare DNS provider is not configured (requires ${TENANT_DOMAIN_CLOUDFLARE_REQUIRED_WHEN_SELECTED.join(", ")}).`
    );
  }

  return createCloudflareDnsProvider({
    zoneId,
    apiToken,
    platformRootDomain,
    timeoutMs: resolveTenantDomainCloudflareTimeoutMs(env)
  });
}
