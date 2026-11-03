/**
 * StarSender per-device adapter (Issue #1142, ADR-0148 section 4 and 7) — an
 * UNOFFICIAL WhatsApp gateway. One instance is built per lane, per pass, from a
 * tenant-owned device's own record and its own decrypted device key
 * (`whatsapp-sender-providers.ts`); it has no way to be handed another device's
 * key, and the destination is a constant.
 *
 * Properties, each held by a test over the contract fixtures:
 *
 *   * ALLOWLISTED endpoint: `STARSENDER_SEND_URL` only, asserted against the
 *     allowed origin before every call; no redirect is followed (`maxRedirects:
 *     0`), so the device key (an `Authorization` header) is never forwarded.
 *   * BOUNDED timeout: the shared outbound seam's total wall-clock budget.
 *   * SAFE retry classification: a failure that proves the request did not leave
 *     (DNS) or that StarSender refused it (429, 5xx, a disconnected device) may be
 *     retried; a timeout or reset after the request may have been processed is an
 *     UNKNOWN outcome and is not retried, because StarSender documents no
 *     idempotency key and a retry could message the recipient twice.
 *   * HTTP 200 is not success: the body's `success` decides, and a body in an
 *     unknown shape is `malformed_response`, never acceptance.
 *   * A success is "accepted by StarSender", never "delivered" or "read", and
 *     carries no provider message id (unevidenced).
 *   * Errors are FIXED sentences keyed by a coarse code; provider text is never
 *     copied, so the device key, the number and the body cannot leak through it.
 *   * One circuit breaker per device (the `breakerKey` the lane passes): another
 *     device's failures never open this one. Only this adapter feeds it.
 *   * No fallback: a failure is returned; nothing here tries another endpoint,
 *     device, number or provider.
 *
 * `healthCheck` reports the breaker only: StarSender documents no side-effect-free
 * status call, and a send would message someone (the Fonnte adapter's reasoning).
 * It is therefore NOT a device-connectivity check; the device state in
 * `channel_accounts` is operator-attested (`attest-device`).
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
  buildStarsenderRequestBody,
  classifyStarsenderResponse,
  classifyStarsenderTransportFailure,
  isPlausibleStarsenderDeviceKey,
  starsenderFailure,
  starsenderFailureFeedsBreaker,
  STARSENDER_ALLOWED_ORIGIN,
  STARSENDER_SEND_URL
} from "../domain/starsender-contract";
import {
  defaultWhatsappHttpClient,
  type WhatsappHttpClient
} from "./whatsapp-http-client";

export type StarsenderProviderOptions = {
  /** The device API key, decrypted in memory for this lane. Never logged, never copied into a result. */
  deviceKey: string;
  timeoutMs: number;
  breakerKey?: string;
  http?: WhatsappHttpClient;
  now?: () => Date;
};

export function createStarsenderWhatsappProvider(
  options: StarsenderProviderOptions
): WhatsappProvider | null {
  if (!isPlausibleStarsenderDeviceKey(options.deviceKey)) return null;

  // The endpoint is a constant; this is the belt for a future edit that makes it
  // configurable: it must still be the allowlisted origin.
  if (new URL(STARSENDER_SEND_URL).origin !== STARSENDER_ALLOWED_ORIGIN) {
    return null;
  }

  const http = options.http ?? defaultWhatsappHttpClient;
  const now = options.now ?? (() => new Date());
  const breaker = getProviderCircuitBreaker(
    options.breakerKey ?? WHATSAPP_CIRCUIT_BREAKER_KEY
  );

  return {
    async send(request: WhatsappSendRequest): Promise<WhatsappSendResult> {
      const body = buildStarsenderRequestBody({
        to: request.to,
        body: request.body
      });

      if (body === null) return starsenderFailure("recipient_unusable");

      const attemptedAt = now();
      const response = await http(STARSENDER_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: options.deviceKey,
          "Content-Type": "application/json"
        },
        body,
        timeoutMs: options.timeoutMs,
        maxRedirects: 0
      });

      const result: WhatsappSendResult = response.ok
        ? classifyStarsenderResponse(response.status, response.body)
        : starsenderFailure(
            classifyStarsenderTransportFailure(response.reason)
          );

      if (result.ok) {
        breaker.recordSuccess(attemptedAt);
      } else if (starsenderFailureFeedsBreaker(result.failureCode)) {
        breaker.recordFailure(attemptedAt);
      }

      return result;
    },

    async healthCheck(): Promise<WhatsappHealthResult> {
      return breaker.canAttempt(now())
        ? { ok: true }
        : { ok: false, error: "Circuit breaker is open." };
    }
  };
}
