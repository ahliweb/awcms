/**
 * Web Push adapter (RFC 8030 + 8291 + 8292) — `PUSH_PROVIDER=web_push`
 * (Issue #466, ADR-0074).
 *
 * This is the adapter ADR-0074 chose INSTEAD of the FCM Web SDK, and the
 * reason is measurable: `firebase/app` + `firebase/messaging` is 45,041 B
 * against a 21,000 B per-file ceiling, and it needs `www.gstatic.com` in
 * `script-src` plus two `googleapis.com` origins in `connect-src` — against a
 * CSP that has six directives, no `connect-src` at all, and a test locking in
 * zero third-party origins (ADR-0029).
 *
 * `PushManager.subscribe()` is a browser API, not a `fetch` from page script,
 * so this path costs **zero** client bytes and **zero** CSP origins. Everything
 * in this file runs server-side.
 *
 * ## The payload is encrypted for ONE subscriber
 *
 * The push service is a relay that never sees plaintext. It also never
 * validates it: a body a browser cannot decrypt is accepted, forwarded, and
 * dropped in silence. That is why `domain/web-push-encryption.ts` is verified
 * against RFC 8291's own worked example rather than round-tripped — a wrong key
 * schedule produces a system where every send reports success and nothing
 * arrives.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { log } from "../../../lib/logging/logger";
import { PUSH_CIRCUIT_BREAKER_KEY } from "../domain/push-config";
import type {
  PushDeliveryResult,
  PushHealthCheckResult,
  PushMessage,
  PushProvider,
  PushTarget
} from "../domain/push-provider-contract";
import { encryptWebPushPayload } from "../domain/web-push-encryption";
import { mapWebPushResponse } from "../domain/web-push-error-mapping";
import { defaultPushHttpClient, type PushHttpClient } from "./push-http-client";
import {
  buildVapidAuthorizationHeader,
  type VapidKeyMaterial
} from "./vapid-jwt";

const MODULE_KEY = "push_delivery";

/**
 * How long the push service should hold an undelivered message for a device
 * that is offline. Four hours: long enough to survive a laptop lid being shut
 * over lunch, short enough that a notification never arrives so late that it is
 * about something already handled — the same reasoning that caps the retry
 * backoff at 15 minutes.
 */
const DEFAULT_TTL_SECONDS = 4 * 60 * 60;

export type WebPushProviderOptions = {
  vapid: VapidKeyMaterial;
  timeoutMs: number;
  ttlSeconds?: number;
  http?: PushHttpClient;
  now?: () => Date;
};

/**
 * What the service worker receives. Kept deliberately small and flat — it
 * travels encrypted through a third party, and every field is one an operator
 * would be comfortable seeing in a browser notification.
 */
export function buildWebPushPayload(message: PushMessage): string {
  return JSON.stringify({
    title: message.title,
    body: message.body,
    ...(message.targetPath ? { targetPath: message.targetPath } : {}),
    ...(message.data ? { data: message.data } : {})
  });
}

export function createWebPushProvider(
  options: WebPushProviderOptions
): PushProvider {
  const http = options.http ?? defaultPushHttpClient;
  const now = options.now ?? (() => new Date());
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const breaker = getProviderCircuitBreaker(PUSH_CIRCUIT_BREAKER_KEY);

  return {
    supportedTransports: ["web_push"],

    async send(
      target: PushTarget,
      message: PushMessage
    ): Promise<PushDeliveryResult> {
      const attemptedAt = now();

      if (!target.p256dhKey || !target.authSecret) {
        // Structurally impossible for a stored row — the DB CHECK requires both
        // for `web_push` — so this can only be an injected/hand-built target.
        // Refused rather than encrypted with a guessed key, which would produce
        // a message the browser silently drops.
        return {
          ok: false,
          error: "web_push target is missing p256dh/auth key material.",
          retryable: false
        };
      }

      let body: Uint8Array;
      let authorization: string;

      try {
        body = await encryptWebPushPayload(
          buildWebPushPayload(message),
          { p256dh: target.p256dhKey, authSecret: target.authSecret },
          {}
        );
        authorization = await buildVapidAuthorizationHeader(
          target.endpoint,
          options.vapid,
          attemptedAt
        );
      } catch (error) {
        // Malformed key material or an unparseable endpoint. Both are facts
        // about the stored row, and both will hold next time.
        return {
          ok: false,
          error: `could not prepare the push request: ${(error as Error).message}`,
          retryable: false
        };
      }

      const response = await http(target.endpoint, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(ttlSeconds)
        },
        body,
        timeoutMs: options.timeoutMs
      });

      if (!response.ok) {
        breaker.recordFailure(attemptedAt);

        return { ok: false, error: response.reason, retryable: true };
      }

      const outcome = mapWebPushResponse(response.status, response.body);

      if (outcome.kind === "success") {
        breaker.recordSuccess(attemptedAt);

        return { ok: true };
      }

      if (outcome.kind === "subscription_gone") {
        log("info", "push.web_push.subscription_gone", {
          moduleKey: MODULE_KEY,
          endpoint: target.endpointMasked,
          correlationId: message.correlationId
        });

        return {
          ok: false,
          error: outcome.error,
          retryable: false,
          subscriptionGone: true
        };
      }

      if (outcome.tripsBreaker) {
        breaker.recordFailure(attemptedAt);
      }

      return {
        ok: false,
        error: outcome.error,
        retryable: outcome.retryable
      };
    },

    /**
     * Verifies the KEY MATERIAL and nothing else — it signs a VAPID token for a
     * well-known audience without sending it anywhere.
     *
     * There is no push-service health endpoint to call, and there is no such
     * thing as "is Web Push up": each browser vendor runs its own service, and
     * a deployment's subscribers are spread across them. A check that picked
     * one to probe would report the health of a service this deployment might
     * have no subscribers on.
     */
    async healthCheck(): Promise<PushHealthCheckResult> {
      try {
        await buildVapidAuthorizationHeader(
          "https://updates.push.services.mozilla.com/",
          options.vapid,
          now()
        );

        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }
  };
}
