/**
 * Fonnte adapter (Issue #963) — `WHATSAPP_PROVIDER=fonnte`. Server -> Fonnte's
 * HTTP API with a deployment-level token; free-text messages (Fonnte has no
 * pre-approved template concept).
 *
 * The adapter is the ONLY thing that feeds the circuit breaker; the dispatcher
 * only reads it. A per-message rejection (bad number) must never trip it, or
 * one bad recipient would stop everyone's delivery. Fonnte answers HTTP 200
 * with `{ status: false, reason }` for rejections, so the body decides.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { WHATSAPP_CIRCUIT_BREAKER_KEY } from "../domain/whatsapp-config";
import type {
  WhatsappHealthResult,
  WhatsappProvider,
  WhatsappSendRequest,
  WhatsappSendResult
} from "../domain/whatsapp-provider-contract";
import {
  defaultWhatsappHttpClient,
  scrubProviderText,
  type WhatsappHttpClient
} from "./whatsapp-http-client";

export const FONNTE_SEND_URL = "https://api.fonnte.com/send";

export type FonnteProviderOptions = {
  token: string;
  timeoutMs: number;
  http?: WhatsappHttpClient;
  now?: () => Date;
};

const TRANSIENT = /(disconnect|device|queue|busy|try again|rate)/i;

function safeParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createFonnteWhatsappProvider(
  options: FonnteProviderOptions
): WhatsappProvider {
  const http = options.http ?? defaultWhatsappHttpClient;
  const now = options.now ?? (() => new Date());
  const breaker = getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY);

  return {
    async send(request: WhatsappSendRequest): Promise<WhatsappSendResult> {
      const attemptedAt = now();
      const form = new URLSearchParams({
        target: request.to.replace(/^\+/, ""),
        message: request.body
      });

      const response = await http(FONNTE_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: options.token,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString(),
        timeoutMs: options.timeoutMs
      });

      if (!response.ok) {
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: scrubProviderText(response.reason),
          retryable: true,
          failureCode: "network_error"
        };
      }

      if (response.status === 429 || response.status >= 500) {
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: `Fonnte answered HTTP ${response.status}.`,
          retryable: true,
          failureCode:
            response.status === 429 ? "rate_limited" : "provider_error"
        };
      }

      const payload = safeParse(response.body);
      const reason =
        typeof payload.reason === "string"
          ? scrubProviderText(payload.reason)
          : "";

      if (response.status === 401 || response.status === 403) {
        // A credential problem is a configuration fact, not an outage signal.
        return {
          ok: false,
          error: "Fonnte rejected the configured token.",
          retryable: false,
          failureCode: "unauthorized"
        };
      }

      if (
        response.status >= 200 &&
        response.status < 300 &&
        payload.status === true
      ) {
        breaker.recordSuccess(attemptedAt);

        const id = Array.isArray(payload.id) ? payload.id[0] : payload.id;

        return {
          ok: true,
          ...(typeof id === "string" || typeof id === "number"
            ? { providerMessageId: String(id).slice(0, 200) }
            : {})
        };
      }

      // Fonnte offers no STRUCTURED "this number cannot receive WhatsApp" signal,
      // only free-text `reason`. Matching that text to create a permanent
      // hard-failure suppression would let a provider wording change (or a
      // reason that merely mentions "target") silently and permanently block a
      // recipient from every message, security ones included. So without a
      // structured signal a rejection is a failure of THIS message only
      // (audit F7): never `recipientInvalid`. Meta's numeric error codes are
      // structured and keep that verdict.
      if (TRANSIENT.test(reason)) {
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: reason,
          retryable: true,
          failureCode: "provider_unavailable"
        };
      }

      return {
        ok: false,
        error:
          reason || `Fonnte rejected the message (HTTP ${response.status}).`,
        retryable: false,
        failureCode: "rejected"
      };
    },

    async healthCheck(): Promise<WhatsappHealthResult> {
      // Fonnte offers no side-effect-free probe; a send would message someone.
      // The breaker state is the honest signal.
      return breaker.canAttempt(now())
        ? { ok: true }
        : { ok: false, error: "Circuit breaker is open." };
    }
  };
}
