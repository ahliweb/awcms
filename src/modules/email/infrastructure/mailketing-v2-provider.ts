/**
 * Mailketing REST API v2 adapter (Issue #1159, ADR-0151 §1). Selected ONLY when
 * `EMAIL_MAILKETING_API_VERSION=v2`; v1 (`./mailketing-provider.ts`) is
 * untouched and remains the default. Same `EmailProvider` port, same
 * `email-dispatch` outbox — this file adds a transport, not a subsystem.
 *
 * Contract and the "not verified against the live API" caveat:
 * `../domain/mailketing-v2-contract.ts`.
 *
 * ## Invariants (ADR-0151 M1–M3, M9-in-single-account form)
 *
 * - The token travels in a header only — never URL, query, body, log, error.
 *   Result strings are fixed text plus a status code; no provider body text,
 *   thrown-error text or recipient is ever copied into them.
 * - Egress goes through `ssrfSafeFetch` with `maxRedirects: 0` (a Location can
 *   never carry the `Authorization` header elsewhere), a total timeout and a
 *   response-size cap, to the fixed allow-listed host.
 * - `success:true` = accepted/queued, NOT delivered. `message_id` is stored by
 *   the dispatcher as `provider_message_id`; it is not an idempotency key.
 *   A crash after acceptance but before finalize is UNCERTAIN (see the
 *   dispatcher's `uncertain` counter) — no provider-side dedupe is claimed.
 * - Breaker (same key as v1, `email-mailketing`, so the dispatcher's
 *   short-circuit works for either version): counts statements about the
 *   service, the account, or a contract the adapter may have wrong — network,
 *   timeout, egress-policy denial, 5xx, 429, malformed 200, 401/402/403, and
 *   also refusals (`success:false`, 404/422/other 4xx). The shared breaker needs
 *   5 CONSECUTIVE failures and any success resets it, so one bad recipient never
 *   trips it, but a wrong field name (every send refused while `/credits` stays
 *   green) stops claiming instead of silently failing the queue. Stopping also
 *   protects the vendor's failed-request quota per IP. Single-account model;
 *   per-connection keys are #1160.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";
import type {
  EmailDeliveryResult,
  EmailHealthCheckResult,
  EmailMessage,
  EmailProvider
} from "../domain/email-provider-contract";
import {
  MAILKETING_V2_CREDIT_HOLD_MS,
  MAILKETING_V2_DEFAULT_BASE_URL,
  MAILKETING_V2_MAX_RESPONSE_BYTES,
  buildMailketingV2Headers,
  buildMailketingV2SendBody,
  classifyMailketingV2Response,
  parseMailketingV2Credits,
  parseMailketingV2Senders,
  type MailketingV2Outcome
} from "../domain/mailketing-v2-contract";

const PROVIDER_KEY = "email-mailketing";
const DEFAULT_TIMEOUT_MS = 10_000;

export type MailketingV2TransportRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
};

export type MailketingV2TransportResult =
  | { ok: true; status: number; retryAfter: string | null; body: string }
  | {
      ok: false;
      /** `network` includes timeout and DNS failure; `policy` is an SSRF-guard denial (a misconfiguration, not an outage). */
      reason: "timeout" | "network" | "too_large" | "redirect" | "policy";
    };

export type MailketingV2Transport = (
  request: MailketingV2TransportRequest
) => Promise<MailketingV2TransportResult>;

export type MailketingV2ProviderConfig = {
  apiToken: string;
  /** Code-only override for tests. The production resolver only ever passes the validated allow-listed origin. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Test seam; default is the SSRF-guarded transport below. */
  transport?: MailketingV2Transport;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /**
   * Issue #1160 (ADR-0151 M9): the breaker this connection feeds and obeys.
   * Default `email-mailketing`, the DEPLOYMENT sender's key (unchanged). A
   * tenant-owned Mailketing account passes its own per-account key
   * (`emailSenderBreakerKey`), so one tenant's bad token, empty balance or
   * refusal streak opens only its own lane, never the deployment's or another
   * tenant's.
   */
  breakerKey?: string;
};

export function createSsrfGuardedMailketingTransport(
  env: NodeJS.ProcessEnv = process.env
): MailketingV2Transport {
  return async (request) => {
    const result = await ssrfSafeFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeoutMs: request.timeoutMs,
      maxResponseBytes: MAILKETING_V2_MAX_RESPONSE_BYTES,
      maxRedirects: 0,
      env
    });

    if (!result.ok) {
      const reason = result.reason;

      return {
        ok: false,
        reason:
          reason === "request_failed" || reason === "dns_resolution_failed"
            ? "network"
            : reason === "response_too_large"
              ? "too_large"
              : reason === "too_many_redirects"
                ? "redirect"
                : "policy"
      };
    }

    return {
      ok: true,
      status: result.response.status,
      retryAfter: result.response.headers.get("retry-after"),
      body: await result.response.text().catch(() => "")
    };
  };
}

export function createMailketingV2Provider(
  config: MailketingV2ProviderConfig
): EmailProvider {
  const baseUrl = config.baseUrl ?? MAILKETING_V2_DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport =
    config.transport ?? createSsrfGuardedMailketingTransport(config.env);
  const clock = config.now ?? (() => new Date());
  const breaker = getProviderCircuitBreaker(config.breakerKey ?? PROVIDER_KEY);

  type Exchange =
    | { ok: true; outcome: MailketingV2Outcome }
    | {
        ok: false;
        reason: Extract<MailketingV2TransportResult, { ok: false }>["reason"];
      };

  async function exchange(
    method: "GET" | "POST",
    path: string,
    body?: string
  ): Promise<Exchange> {
    let result: MailketingV2TransportResult;

    try {
      result = await transport({
        url: `${baseUrl}${path}`,
        method,
        headers: buildMailketingV2Headers(config.apiToken, body !== undefined),
        body,
        timeoutMs
      });
    } catch {
      // Never surface the thrown error's text: a transport/runtime error can
      // embed request details. Classified as a network failure.
      return { ok: false, reason: "network" };
    }

    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }

    return {
      ok: true,
      outcome: classifyMailketingV2Response(
        result.status,
        result.body,
        result.retryAfter,
        clock()
      )
    };
  }

  return {
    async send(message: EmailMessage): Promise<EmailDeliveryResult> {
      const attemptedAt = clock();

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "Mailketing circuit breaker is open; no attempt was made.",
          retryable: true,
          skipped: true
        };
      }

      const recipient = message.to[0]?.address;

      if (!recipient) {
        return {
          ok: false,
          error: "Email message has no recipient address.",
          retryable: false
        };
      }

      const result = await exchange(
        "POST",
        "/api/v2/send",
        buildMailketingV2SendBody({
          recipient,
          fromEmail: message.from.address,
          fromName: message.from.name ?? "",
          subject: message.subject,
          content: message.htmlBody ?? message.textBody ?? ""
        })
      );

      if (!result.ok) {
        if (result.reason === "policy") {
          // The SSRF guard refused the fixed host (a DNS sinkhole, a redirect
          // Location it will not follow). Often transient and, either way, not
          // a statement about this message: retryable and it counts toward the
          // breaker, never terminal.
          breaker.recordFailure(attemptedAt);
          return {
            ok: false,
            error: "Mailketing v2 request was blocked by the egress policy.",
            retryable: true
          };
        }

        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: `Mailketing v2 request failed (${result.reason}).`,
          retryable: true
        };
      }

      const outcome = result.outcome;

      switch (outcome.kind) {
        case "accepted":
          breaker.recordSuccess(attemptedAt);
          return { ok: true, providerMessageId: outcome.messageId };

        case "refused":
          // 200 + success:false. Usually THIS message (a bad address), but a
          // wrong field name or auth scheme looks identical from here. It counts
          // toward the breaker so a streak (the shared 5-consecutive threshold)
          // stops claiming instead of marking the whole queue `failed`; any
          // success in between resets it, so one bad recipient never trips it.
          breaker.recordFailure(attemptedAt);
          return {
            ok: false,
            error: `Mailketing v2 refused the message${outcome.code ? ` (code ${outcome.code})` : ""}.`,
            retryable: false
          };

        case "malformed":
          // The provider may have accepted it. A retry could send up to
          // max-retries+1 copies, so this is terminal and UNCERTAIN, not retried.
          breaker.recordFailure(attemptedAt);
          return {
            ok: false,
            error:
              "Mailketing v2 returned a malformed 200 response (UNCERTAIN_MALFORMED_RESPONSE); " +
              "the provider may have accepted the message, so it is not retried.",
            retryable: false,
            uncertain: true
          };

        case "http":
          return mapHttpFailure(outcome, attemptedAt);
      }
    },

    /**
     * Read-only probe: `GET /api/v2/credits`. Never sends mail, never builds a
     * recipient, spends no credit. A valid token gets 200; 401 means a bad
     * token; 402/403 are reported as such. (ADR-0151 §6.)
     */
    async healthCheck(): Promise<EmailHealthCheckResult> {
      const result = await exchange("GET", "/api/v2/credits");

      if (!result.ok) {
        return {
          ok: false,
          error: `Mailketing v2 health probe failed (${result.reason}).`
        };
      }

      const outcome = result.outcome;

      if (outcome.kind === "accepted") {
        return { ok: true };
      }

      if (outcome.kind === "refused") {
        return { ok: false, error: "Mailketing v2 health probe was refused." };
      }

      if (outcome.kind === "malformed") {
        return {
          ok: false,
          error: "Mailketing v2 health probe returned a malformed response."
        };
      }

      return {
        ok: false,
        error:
          outcome.category === "auth"
            ? "Mailketing v2 rejected the API token (HTTP 401)."
            : outcome.category === "credit"
              ? "Mailketing v2 reports insufficient credit (HTTP 402)."
              : `Mailketing v2 health probe failed (HTTP ${outcome.status}).`
      };
    }
  };

  function mapHttpFailure(
    outcome: Extract<MailketingV2Outcome, { kind: "http" }>,
    attemptedAt: Date
  ): EmailDeliveryResult {
    const status = outcome.status;

    switch (outcome.category) {
      case "auth":
        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: "Mailketing v2 rejected the API token (HTTP 401).",
          retryable: false
        };
      case "credit":
        // Not the message's fault and not burned: held without a retry spend.
        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: "Mailketing v2 reports insufficient credit (HTTP 402).",
          retryable: true,
          skipped: true,
          holdMs: MAILKETING_V2_CREDIT_HOLD_MS,
          creditHold: true
        };
      case "sender":
        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: "Mailketing v2 reports an unverified sender (HTTP 403).",
          retryable: false
        };
      case "rate_limited":
        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: "Mailketing v2 rate limited the request (HTTP 429).",
          retryable: true,
          retryAfterMs: outcome.retryAfterMs
        };
      case "server":
      case "redirect":
        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: `Mailketing v2 service error (HTTP ${status}).`,
          retryable: true
        };
      case "invalid":
        // Per-message 404/422/other 4xx, but a wrong contract looks the same:
        // counts toward the breaker (5 consecutive, reset by any success).
        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: `Mailketing v2 rejected the request (HTTP ${status}).`,
          retryable: false
        };
    }
  }
}

// ---------------------------------------------------------------------------
// Read-only account probe (Issue #1160, ADR-0151 sections 2 and 6)
// ---------------------------------------------------------------------------

/**
 * What a probe learnt. Fixed codes only: never the provider's text, the token,
 * or an address the caller did not already hold.
 *
 * - `auth`        401: the token is invalid or revoked.
 * - `credit`      402 on a read: the account has no credit.
 * - `unavailable` network, timeout, 5xx, 429, a redirect, an egress refusal or
 *                 any other HTTP status: nothing was learnt.
 * - `malformed`   2xx whose body the fail-closed parser does not recognise.
 */
export type MailketingV2ProbeFailure =
  "auth" | "credit" | "unavailable" | "malformed";

export type MailketingV2ProbeResult<T> =
  { ok: true; value: T } | { ok: false; failure: MailketingV2ProbeFailure };

/** What `GET /senders` said, per address: explicitly verified, or contradictory (unknown). Everything else is unverified. */
export type MailketingV2SenderVerdicts = {
  verified: ReadonlySet<string>;
  ambiguous: ReadonlySet<string>;
};

export type MailketingV2AccountProbe = {
  /** `GET /api/v2/credits`: the reported balance. Spends nothing, sends nothing. */
  readCredits(): Promise<MailketingV2ProbeResult<number>>;
  /** `GET /api/v2/senders`: the addresses the provider reports as VERIFIED. */
  listVerifiedSenders(): Promise<
    MailketingV2ProbeResult<MailketingV2SenderVerdicts>
  >;
};

/**
 * The two read-only calls `email:senders:verify` makes per Mailketing account.
 * Same transport rules as the sender (header-only token, fixed allow-listed
 * host, no redirects, size cap, timeout). It does NOT feed the send breaker:
 * the breaker answers "is sending through this account failing", and a read
 * probe's outcome is recorded as the account's health instead (where the
 * dispatcher's freshness gate reads it).
 */
export function createMailketingV2AccountProbe(
  config: Omit<MailketingV2ProviderConfig, "now"> & { now?: () => Date }
): MailketingV2AccountProbe {
  const baseUrl = config.baseUrl ?? MAILKETING_V2_DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport =
    config.transport ?? createSsrfGuardedMailketingTransport(config.env);

  async function read<T>(
    path: string,
    parse: (body: string) => { ok: true; value: T } | { ok: false }
  ): Promise<MailketingV2ProbeResult<T>> {
    let result: MailketingV2TransportResult;

    try {
      result = await transport({
        url: `${baseUrl}${path}`,
        method: "GET",
        headers: buildMailketingV2Headers(config.apiToken, false),
        timeoutMs
      });
    } catch {
      return { ok: false, failure: "unavailable" };
    }

    if (!result.ok) return { ok: false, failure: "unavailable" };

    if (result.status === 401) return { ok: false, failure: "auth" };
    if (result.status === 402) return { ok: false, failure: "credit" };
    if (result.status < 200 || result.status >= 300) {
      return { ok: false, failure: "unavailable" };
    }

    const parsed = parse(result.body);

    return parsed.ok
      ? { ok: true, value: parsed.value }
      : { ok: false, failure: "malformed" };
  }

  return {
    readCredits: () =>
      read<number>("/api/v2/credits", (body) => {
        const parsed = parseMailketingV2Credits(body);

        return parsed.ok
          ? { ok: true as const, value: parsed.balance }
          : { ok: false as const };
      }),
    listVerifiedSenders: () =>
      read<MailketingV2SenderVerdicts>("/api/v2/senders", (body) => {
        const parsed = parseMailketingV2Senders(body);

        return parsed.ok
          ? {
              ok: true as const,
              value: { verified: parsed.verified, ambiguous: parsed.ambiguous }
            }
          : { ok: false as const };
      })
  };
}
