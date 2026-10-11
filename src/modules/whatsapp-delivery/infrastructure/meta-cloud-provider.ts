/**
 * Meta WhatsApp Cloud API adapter (Issue #963) — `WHATSAPP_PROVIDER=meta`.
 *
 * Business-initiated messages outside the 24-hour window must be pre-approved
 * TEMPLATE messages, so this adapter sends `type: "template"` only. A message
 * whose registration carries no `providerTemplate` fails TERMINALLY
 * (`template_not_approved`) — it never falls back to free text for
 * `transactional` or `marketing` (ADR-0133 section 10, Q4).
 *
 * Only the adapter feeds the circuit breaker. A per-message rejection
 * (undeliverable number, template mismatch) is recorded as a message outcome,
 * not as provider ill-health.
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

export type MetaCloudProviderOptions = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  timeoutMs: number;
  http?: WhatsappHttpClient;
  now?: () => Date;
};

/** Undeliverable / not a WhatsApp user / number reassigned. */
const RECIPIENT_INVALID_CODES = new Set([131026, 131021, 131009]);
/** Throughput and pair rate limits: transient. */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131056]);
/** Token expired/invalid, permission or account problems: configuration, not retryable per message. */
const AUTH_CODES = new Set([0, 190, 10, 200]);

function readError(text: string): { code?: number; message: string } {
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: unknown; message?: unknown };
    };
    const error = parsed.error;

    return {
      ...(typeof error?.code === "number" ? { code: error.code } : {}),
      message:
        typeof error?.message === "string"
          ? scrubProviderText(error.message)
          : ""
    };
  } catch {
    return { message: "" };
  }
}

export function createMetaCloudWhatsappProvider(
  options: MetaCloudProviderOptions
): WhatsappProvider {
  const http = options.http ?? defaultWhatsappHttpClient;
  const now = options.now ?? (() => new Date());
  const breaker = getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY);
  const url = `https://graph.facebook.com/${options.apiVersion}/${options.phoneNumberId}/messages`;

  return {
    async send(request: WhatsappSendRequest): Promise<WhatsappSendResult> {
      if (!request.providerTemplate) {
        return {
          ok: false,
          error: `Template "${request.templateKey}" has no approved provider template.`,
          retryable: false,
          failureCode: "template_not_approved"
        };
      }

      const attemptedAt = now();
      const response = await http(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: request.to.replace(/^\+/, ""),
          type: "template",
          template: {
            name: request.providerTemplate.name,
            language: { code: request.providerTemplate.language },
            ...(request.parameters.length > 0
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: request.parameters.map((text) => ({
                        type: "text",
                        text
                      }))
                    }
                  ]
                }
              : {})
          }
        }),
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

      if (response.status >= 200 && response.status < 300) {
        breaker.recordSuccess(attemptedAt);

        try {
          const parsed = JSON.parse(response.body) as {
            messages?: { id?: unknown }[];
          };
          const id = parsed.messages?.[0]?.id;

          return {
            ok: true,
            ...(typeof id === "string"
              ? { providerMessageId: id.slice(0, 200) }
              : {})
          };
        } catch {
          return { ok: true };
        }
      }

      const { code, message } = readError(response.body);

      if (
        response.status >= 500 ||
        response.status === 429 ||
        (code !== undefined && RATE_LIMIT_CODES.has(code))
      ) {
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: message || `Meta answered HTTP ${response.status}.`,
          retryable: true,
          failureCode:
            response.status >= 500 ? "provider_error" : "rate_limited"
        };
      }

      if (code !== undefined && RECIPIENT_INVALID_CODES.has(code)) {
        return {
          ok: false,
          error: message || "Recipient cannot receive WhatsApp.",
          retryable: false,
          failureCode: "recipient_invalid",
          recipientInvalid: true
        };
      }

      if (
        response.status === 401 ||
        response.status === 403 ||
        (code !== undefined && AUTH_CODES.has(code))
      ) {
        return {
          ok: false,
          error: "Meta rejected the configured credentials.",
          retryable: false,
          failureCode: "unauthorized"
        };
      }

      return {
        ok: false,
        error:
          message || `Meta rejected the message (HTTP ${response.status}).`,
        retryable: false,
        failureCode: "rejected"
      };
    },

    async healthCheck(): Promise<WhatsappHealthResult> {
      return breaker.canAttempt(now())
        ? { ok: true }
        : { ok: false, error: "Circuit breaker is open." };
    }
  };
}
