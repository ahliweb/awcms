/**
 * FCM HTTP v1 adapter (Issue #466, ADR-0074) — `PUSH_PROVIDER=fcm`.
 *
 * Server → Google, and only that. It never touches the browser, so it costs
 * nothing in the client asset budget and adds no CSP origin — which is exactly
 * why ADR-0074 keeps FCM HTTP v1 while rejecting the FCM Web SDK.
 *
 * Structure mirrors `email/infrastructure/mailketing-provider.ts`: the adapter
 * is the ONLY thing that feeds the circuit breaker, and the dispatcher only
 * reads it. The key comes from `PUSH_CIRCUIT_BREAKER_KEY` rather than a literal
 * so the two sides cannot drift apart silently.
 *
 * ## What this adapter deliberately does not do
 *
 * It does not fan out, batch, or dedupe. One call, one token, one notification
 * — the queue owns fan-out, and a batch API would make partial failure
 * unrepresentable in a table where every row already IS one delivery unit.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { log } from "../../../lib/logging/logger";
import {
  buildFcmSendUrl,
  type FcmServiceAccount
} from "../domain/fcm-credentials";
import { mapFcmResponse } from "../domain/fcm-error-mapping";
import { PUSH_CIRCUIT_BREAKER_KEY } from "../domain/push-config";
import type {
  PushDeliveryResult,
  PushHealthCheckResult,
  PushMessage,
  PushProvider,
  PushTarget
} from "../domain/push-provider-contract";
import {
  getGoogleAccessToken,
  invalidateGoogleAccessToken
} from "./google-access-token";
import { defaultPushHttpClient, type PushHttpClient } from "./push-http-client";

const MODULE_KEY = "push_delivery";

export type FcmProviderOptions = {
  credential: FcmServiceAccount;
  timeoutMs: number;
  /** Injectable so tests drive the adapter without network access — and without having to defeat the SSRF guard, which would test a different code path than production runs. */
  http?: PushHttpClient;
  now?: () => Date;
};

/**
 * FCM `data` values must all be strings. `targetPath` rides here rather than in
 * `notification`, because a native client decides for itself what to do with a
 * click; `webpush.fcm_options.link` is the browser-side equivalent and is not
 * set, since browsers are served by the Web Push adapter, not this one.
 */
function buildDataPayload(message: PushMessage): Record<string, string> {
  const data: Record<string, string> = { ...(message.data ?? {}) };

  if (message.targetPath) {
    data.target_path = message.targetPath;
  }

  if (message.correlationId) {
    data.correlation_id = message.correlationId;
  }

  return data;
}

export function createFcmPushProvider(
  options: FcmProviderOptions
): PushProvider {
  const http = options.http ?? defaultPushHttpClient;
  const now = options.now ?? (() => new Date());
  const breaker = getProviderCircuitBreaker(PUSH_CIRCUIT_BREAKER_KEY);
  const sendUrl = buildFcmSendUrl(options.credential);

  async function post(
    accessToken: string,
    target: PushTarget,
    message: PushMessage
  ) {
    const data = buildDataPayload(message);

    return http(sendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token: target.endpoint,
          notification: { title: message.title, body: message.body },
          ...(Object.keys(data).length > 0 ? { data } : {})
        }
      }),
      timeoutMs: options.timeoutMs
    });
  }

  return {
    supportedTransports: ["fcm"],

    async send(
      target: PushTarget,
      message: PushMessage
    ): Promise<PushDeliveryResult> {
      const attemptedAt = now();

      const token = await getGoogleAccessToken(options.credential, {
        http,
        timeoutMs: options.timeoutMs,
        now: attemptedAt
      });

      if (!token.ok) {
        // A token failure that is retryable means the token endpoint itself was
        // unreachable or erroring, which IS a statement about the upstream —
        // so it counts toward the breaker. A rejected assertion is a
        // configuration fact and does not.
        if (token.retryable) {
          breaker.recordFailure(attemptedAt);
        }

        return { ok: false, error: token.error, retryable: token.retryable };
      }

      let response = await post(token.accessToken, target, message);

      if (!response.ok) {
        breaker.recordFailure(attemptedAt);

        return { ok: false, error: response.reason, retryable: true };
      }

      let outcome = mapFcmResponse(response.status, response.body);

      // ONE retry, and only for 401. Google rejected the token we hold; minting
      // a fresh one and replaying is the whole fix, and doing it here means a
      // token that expired mid-batch costs one extra call instead of failing
      // every remaining message in the pass. Bounded to a single attempt so a
      // credential that is simply wrong cannot loop.
      if (outcome.kind === "unauthorized") {
        invalidateGoogleAccessToken(options.credential.clientEmail);

        const refreshed = await getGoogleAccessToken(options.credential, {
          http,
          timeoutMs: options.timeoutMs,
          now: attemptedAt
        });

        if (!refreshed.ok) {
          return {
            ok: false,
            error: refreshed.error,
            retryable: refreshed.retryable
          };
        }

        response = await post(refreshed.accessToken, target, message);

        if (!response.ok) {
          breaker.recordFailure(attemptedAt);

          return { ok: false, error: response.reason, retryable: true };
        }

        outcome = mapFcmResponse(response.status, response.body);

        if (outcome.kind === "unauthorized") {
          // A freshly minted token was refused too. That is a credential
          // problem, not an expiry, and retrying the message will not fix it.
          return { ok: false, error: outcome.error, retryable: false };
        }
      }

      if (outcome.kind === "success") {
        breaker.recordSuccess(attemptedAt);

        return { ok: true, providerMessageId: response.body.slice(0, 200) };
      }

      if (outcome.kind === "subscription_gone") {
        log("info", "push.fcm.subscription_gone", {
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
     * Proves the CREDENTIAL, not the send path: it mints an access token and
     * stops. Sending a real notification to prove health would require a real
     * device token, and inventing one would answer `UNREGISTERED` — a healthy
     * FCM reporting a failure, which is worse than not checking.
     */
    async healthCheck(): Promise<PushHealthCheckResult> {
      const token = await getGoogleAccessToken(options.credential, {
        http,
        timeoutMs: options.timeoutMs,
        now: now()
      });

      return token.ok ? { ok: true } : { ok: false, error: token.error };
    }
  };
}
