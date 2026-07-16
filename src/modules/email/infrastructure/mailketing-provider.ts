/**
 * Mailketing adapter (Issue #495) — the first (and, for now, only) real
 * `EmailProvider` implementation for the port defined in Issue #493
 * (`../domain/email-provider-contract.ts`).
 *
 * Connection shape (endpoint, auth style, request/response fields) was
 * inspected from `ahliweb/awcms-micro`'s Mailketing plugin per the epic's
 * explicit reference boundary — connection/config behavior only, no
 * architecture, no credentials. Real Mailketing API facts reused here:
 * `POST {baseUrl}/api/v1/send`, `application/x-www-form-urlencoded` body
 * with `api_token`/`recipient`/`from_email`/`from_name`/`subject`/`content`,
 * JSON response `{ status: "success" | "failed", response, message_id? }`.
 * Auth is token-only (`api_token` form field) — Mailketing itself has no
 * separate "account identifier" concept. `EMAIL_MAILKETING_ACCOUNT_ID`
 * (Issue #493/#494) is therefore never sent to the provider; it is kept
 * purely as an operator-facing label (masked/plain in admin diagnostics —
 * Issue #499) for deployments that rotate between multiple Mailketing
 * accounts, not an API parameter.
 *
 * One send = one recipient (the real API itself has no bulk/array
 * recipient field), which is exactly why `awcms_email_messages`
 * (Issue #494) is one row per recipient rather than a fan-out shape.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTimeout } from "../../../lib/integration/timeout";
import type {
  EmailDeliveryResult,
  EmailHealthCheckResult,
  EmailMessage,
  EmailProvider
} from "../domain/email-provider-contract";

const PROVIDER_KEY = "email-mailketing";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const DEFAULT_BASE_URL = "https://api.mailketing.co.id";

export type MailketingProviderConfig = {
  apiToken: string;
  /** Override for tests/dev only — a local fake HTTP server standing in for Mailketing. Always from configuration, never request input (SSRF-safe, same convention as `object-storage-uploader.ts`'s R2 endpoint). */
  baseUrl?: string;
  timeoutMs?: number;
};

type MailketingSendResponse = {
  status?: string;
  response?: string;
  message_id?: string;
};

function truncate(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

/**
 * HTTP-level failures (network error, timeout, 5xx) are `retryable: true` —
 * transient, may succeed later. A `2xx` response with
 * `status: "failed"` is a provider-side validation/business rejection
 * (invalid recipient, bad token, etc.) — `retryable: false`, since retrying
 * an identical request cannot change the outcome.
 */
export function createMailketingEmailProvider(
  config: MailketingProviderConfig
): EmailProvider {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const breaker = getProviderCircuitBreaker(PROVIDER_KEY);

  async function callSend(
    formData: URLSearchParams
  ): Promise<{ response: Response; rawBody: string }> {
    const response = await withTimeout(
      fetch(`${baseUrl}/api/v1/send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString()
      }),
      timeoutMs,
      "mailketing send"
    );
    const rawBody = await response.text().catch(() => "");

    return { response, rawBody };
  }

  return {
    async send(message: EmailMessage): Promise<EmailDeliveryResult> {
      const attemptedAt = new Date();

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "Mailketing circuit breaker is open; skipping attempt.",
          retryable: true
        };
      }

      const recipient = message.to[0]?.address;

      if (!recipient) {
        breaker.recordFailure(attemptedAt);
        return {
          ok: false,
          error: "Email message has no recipient address.",
          retryable: false
        };
      }

      const formData = new URLSearchParams({
        api_token: config.apiToken,
        recipient,
        from_email: message.from.address,
        from_name: message.from.name ?? "",
        subject: message.subject,
        content: message.htmlBody ?? message.textBody ?? ""
      });

      try {
        const { response, rawBody } = await callSend(formData);

        if (!response.ok) {
          breaker.recordFailure(attemptedAt);
          return {
            ok: false,
            error: truncate(
              `Mailketing API returned HTTP ${response.status}${rawBody ? `: ${rawBody}` : ""}`
            ),
            retryable: response.status >= 500
          };
        }

        let parsed: MailketingSendResponse = {};

        try {
          parsed = JSON.parse(rawBody) as MailketingSendResponse;
        } catch {
          breaker.recordFailure(attemptedAt);
          return {
            ok: false,
            error: "Mailketing API returned a non-JSON response.",
            retryable: true
          };
        }

        if (parsed.status !== "success") {
          breaker.recordFailure(attemptedAt);
          return {
            ok: false,
            error: truncate(parsed.response ?? "Unknown error from Mailketing"),
            retryable: false
          };
        }

        breaker.recordSuccess(attemptedAt);
        return { ok: true, providerMessageId: parsed.message_id };
      } catch (error) {
        breaker.recordFailure(attemptedAt);
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: truncate(message), retryable: true };
      }
    },

    /**
     * Probes with empty fields — a valid token gets a field-validation
     * error (e.g. "Empty Recipient"), an invalid token gets
     * "Wrong API Token"/"Invalid Token", a down server returns 5xx. Same
     * technique the reference implementation uses; never sends a real
     * message.
     */
    async healthCheck(): Promise<EmailHealthCheckResult> {
      const formData = new URLSearchParams({
        api_token: config.apiToken,
        recipient: "",
        from_email: "",
        from_name: "",
        subject: "",
        content: ""
      });

      try {
        const { response, rawBody } = await callSend(formData);

        if (response.status >= 500) {
          return {
            ok: false,
            error: truncate(
              `Mailketing API server error (HTTP ${response.status})`
            )
          };
        }

        let parsed: MailketingSendResponse = {};

        try {
          parsed = JSON.parse(rawBody) as MailketingSendResponse;
        } catch {
          /* non-JSON body on a non-5xx status is still an accepted token */
        }

        if (
          parsed.status === "failed" &&
          parsed.response &&
          /wrong api token|invalid token/i.test(parsed.response)
        ) {
          return {
            ok: false,
            error: truncate(`Invalid API token: ${parsed.response}`)
          };
        }

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: truncate(message) };
      }
    }
  };
}
