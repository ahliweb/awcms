/**
 * Mailketing REST API v2 contract (Issue #1159, ADR-0151 §1). Pure — no I/O, no
 * `process.env` reads; the adapter
 * (`../infrastructure/mailketing-v2-provider.ts`) and `scripts/validate-env.ts`
 * both import from here so the validator and the runtime cannot disagree.
 *
 * ## Provenance and what is NOT verified
 *
 * Built from the documented contract (ADR-0151 §Context, official docs
 * v2.0.2): header auth, `POST /api/v2/send` with JSON, response
 * `{ success, data: { message_id } }`, statuses 401/402/403/404/422/429/5xx,
 * `GET /credits` + `GET /senders`. It was written WITHOUT network access:
 * **nothing here has been verified against the live API**. The send-body field
 * names are the single most likely drift point and live in
 * `buildMailketingV2SendBody` only. Stage 2 of the rollout (ADR-0151 §1)
 * exists to close that gap before any production flip.
 *
 * ## Semantics the rest of the module relies on
 *
 * - `success:true` on HTTP 200 means QUEUED BY THE PROVIDER — not delivered.
 *   The dispatcher stores it as `sent` (accepted); delivery is unknown.
 * - `success:false` on HTTP 200 is a refusal (non-retryable).
 * - `message_id` is provider-generated and is stored as `provider_message_id`
 *   after acceptance. It is NEVER an idempotency key and never sent by us.
 * - No error text from the provider body is ever copied into a result: bodies
 *   can echo the recipient, and a hostile or buggy intermediary could echo
 *   the token. Classification yields fixed strings plus, at most, a short
 *   allow-listed `code`.
 */

export const MAILKETING_API_VERSIONS = ["v1", "v2"] as const;
export type MailketingApiVersion = (typeof MAILKETING_API_VERSIONS)[number];

/** Stage 0..2 default (ADR-0151 §1): v1 stays the default until the owner flips it. Never changes silently. */
export const DEFAULT_MAILKETING_API_VERSION: MailketingApiVersion = "v1";

/** The one production API host. A tenant, operator or request can never name another (SSRF-safe, ADR-0151 §6). */
export const MAILKETING_V2_ALLOWED_HOSTS = ["api.mailketing.co.id"] as const;
export const MAILKETING_V2_DEFAULT_BASE_URL = "https://api.mailketing.co.id";

export const MAILKETING_V2_MAX_RESPONSE_BYTES = 64 * 1024;
export const MAILKETING_V2_MIN_RETRY_AFTER_MS = 1_000;
export const MAILKETING_V2_MAX_RETRY_AFTER_MS = 60 * 60_000;
/**
 * Rollout stage-2 acknowledgement (ADR-0151 §1). Until an operator sets
 * `EMAIL_MAILKETING_V2_VERIFIED=true` after the live check (field names, auth
 * scheme, /credits shape), v2 works but is NOT approved for production and every
 * dispatch pass / `config:validate` says so.
 */
export function isMailketingV2Verified(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.EMAIL_MAILKETING_V2_VERIFIED?.trim() === "true";
}

export const MAILKETING_V2_UNVERIFIED_WARNING =
  "Mailketing v2 contract UNVERIFIED: production v2 is NOT approved until the live stage-2 check " +
  "(send-body field names, auth scheme, /credits shape) is done and EMAIL_MAILKETING_V2_VERIFIED=true is set (ADR-0151).";

/** How long a 402 (no credit) holds a message without spending a retry. */
export const MAILKETING_V2_CREDIT_HOLD_MS = 15 * 60_000;

export type MailketingApiVersionResolution =
  { ok: true; version: MailketingApiVersion } | { ok: false; reason: string };

/**
 * Fail-closed version switch. Unset or blank = the documented default (`v1`).
 * ANY other value that is not exactly `v1` or `v2` is a configuration error —
 * never silently coerced to v1 (a typo such as `V2`/`2` that quietly kept v1
 * would leave an operator believing the migration happened).
 */
export function resolveMailketingApiVersion(
  env: NodeJS.ProcessEnv = process.env
): MailketingApiVersionResolution {
  const raw = env.EMAIL_MAILKETING_API_VERSION;

  if (raw === undefined || raw.trim() === "") {
    return { ok: true, version: DEFAULT_MAILKETING_API_VERSION };
  }

  const value = raw.trim();

  if ((MAILKETING_API_VERSIONS as readonly string[]).includes(value)) {
    return { ok: true, version: value as MailketingApiVersion };
  }

  return {
    ok: false,
    reason: `EMAIL_MAILKETING_API_VERSION must be one of [${MAILKETING_API_VERSIONS.join(", ")}].`
  };
}

export type MailketingV2BaseUrlResolution =
  { ok: true; baseUrl: string } | { ok: false; reason: string };

/**
 * v2 base URL: unset = the fixed production host. A configured value is
 * accepted only if it is exactly the allow-listed origin — https, allow-listed
 * host, no credentials, no port, no path/query/fragment. It is not an
 * arbitrary endpoint (the v1 variable of the same name still is one; v1 is
 * unchanged by design).
 */
export function resolveMailketingV2BaseUrl(
  raw: string | undefined
): MailketingV2BaseUrlResolution {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, baseUrl: MAILKETING_V2_DEFAULT_BASE_URL };
  }

  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return {
      ok: false,
      reason: "EMAIL_MAILKETING_API_BASE_URL is not a valid URL."
    };
  }

  const allowed =
    url.protocol === "https:" &&
    (MAILKETING_V2_ALLOWED_HOSTS as readonly string[]).includes(
      url.hostname.toLowerCase()
    ) &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    (url.pathname === "/" || url.pathname === "") &&
    url.search === "" &&
    url.hash === "";

  if (!allowed) {
    return {
      ok: false,
      reason:
        `EMAIL_MAILKETING_API_BASE_URL is not allowed for Mailketing v2; ` +
        `only https://${MAILKETING_V2_ALLOWED_HOSTS[0]} is accepted.`
    };
  }

  return { ok: true, baseUrl: MAILKETING_V2_DEFAULT_BASE_URL };
}

/**
 * The v2 send body. Field names mirror the documented v1 names with the
 * transport changed to JSON — UNVERIFIED against the live v2 API (see header).
 * The token is deliberately not a parameter: it can only travel in a header.
 */
export function buildMailketingV2SendBody(input: {
  recipient: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  content: string;
}): string {
  return JSON.stringify({
    recipient: input.recipient,
    from_email: input.fromEmail,
    from_name: input.fromName,
    subject: input.subject,
    content: input.content
  });
}

/**
 * A token goes into an HTTP header, so it must be visible ASCII only: no
 * whitespace, CR/LF (header injection) or non-ASCII. Checked in the resolver
 * and `config:validate`; the reason names the variable, never the value.
 */
export function isMailketingTokenHeaderSafe(token: string): boolean {
  return /^[\x21-\x7E]{1,512}$/.test(token);
}

/** Header-only credential (Q12 recommendation: `Authorization: Bearer`). */
export function buildMailketingV2Headers(
  apiToken: string,
  hasBody: boolean
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json"
  };

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

/** Seconds or an HTTP-date, clamped; `undefined` when absent or unusable. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: Date
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  let ms: number;

  if (/^\d{1,9}$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    // An HTTP-date always names a weekday/month; this keeps "-5" and other
    // numeric junk (which `Date.parse` happily reads as a year) out.
    if (!/[A-Za-z]/.test(trimmed)) {
      return undefined;
    }

    const at = Date.parse(trimmed);

    if (Number.isNaN(at)) {
      return undefined;
    }

    ms = at - now.getTime();
  }

  return Math.min(
    Math.max(ms, MAILKETING_V2_MIN_RETRY_AFTER_MS),
    MAILKETING_V2_MAX_RETRY_AFTER_MS
  );
}

// No `@`: an address-looking value must never be stored as a provider id.
const SAFE_ID = /^[A-Za-z0-9._:+=-]{1,128}$/;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type MailketingV2HttpCategory =
  | "auth" // 401
  | "credit" // 402
  | "sender" // 403
  | "invalid" // 400/404/422 and other 4xx
  | "rate_limited" // 429
  | "server" // 5xx
  | "redirect"; // 3xx (never followed: the token must not follow a Location)

export type MailketingV2Outcome =
  | { kind: "accepted"; messageId?: string }
  | { kind: "refused"; code?: string }
  | { kind: "malformed" }
  | {
      kind: "http";
      status: number;
      category: MailketingV2HttpCategory;
      retryAfterMs?: number;
    };

/** Pure classifier of one completed v2 HTTP exchange (used for send AND health). */
export function classifyMailketingV2Response(
  status: number,
  rawBody: string,
  retryAfterHeader: string | null,
  now: Date
): MailketingV2Outcome {
  if (status >= 200 && status < 300) {
    const body = parseJson(rawBody);

    if (body === null || typeof body.success !== "boolean") {
      return { kind: "malformed" };
    }

    if (body.success === false) {
      const error = isRecord(body.error) ? body.error : body;
      const code =
        typeof error.code === "string" && SAFE_CODE.test(error.code)
          ? error.code
          : undefined;

      return { kind: "refused", code };
    }

    const data = isRecord(body.data) ? body.data : {};
    const messageId =
      typeof data.message_id === "string" && SAFE_ID.test(data.message_id)
        ? data.message_id
        : undefined;

    return { kind: "accepted", messageId };
  }

  const category: MailketingV2HttpCategory =
    status === 401
      ? "auth"
      : status === 402
        ? "credit"
        : status === 403
          ? "sender"
          : status === 429
            ? "rate_limited"
            : status >= 500
              ? "server"
              : status >= 300 && status < 400
                ? "redirect"
                : "invalid";

  return {
    kind: "http",
    status,
    category,
    retryAfterMs:
      category === "rate_limited"
        ? parseRetryAfterMs(retryAfterHeader, now)
        : undefined
  };
}
