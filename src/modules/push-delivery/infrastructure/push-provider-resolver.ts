/**
 * Production resolver (Issue #465, extended #466) — mirrors
 * `email/infrastructure/email-provider-resolver.ts`: picks the concrete
 * `PushProvider` from configuration and DEGRADES to a clean failed-result
 * provider on misconfiguration rather than throwing. One misconfigured
 * deployment must not crash the dispatcher; `bun run config:validate` is where
 * that should have been caught at boot.
 *
 * The degraded provider returns `retryable: false`. A missing `PUSH_PROVIDER`,
 * or a credential that does not parse, will not fix itself between now and the
 * next pass, so retrying would burn the whole retry budget of every queued row
 * against a condition only an operator can change — and then bury the real
 * cause under `retry_count` exhaustion.
 */
import { parseFcmCredentialsBase64 } from "../domain/fcm-credentials";
import {
  isKnownPushProvider,
  resolvePushSendTimeoutMs,
  type PushProviderKind
} from "../domain/push-config";
import type { PushProvider } from "../domain/push-provider-contract";
import { createFcmPushProvider } from "./fcm-provider";
import { createLogPushProvider } from "./log-push-provider";

function createMisconfiguredProvider(reason: string): PushProvider {
  return {
    // Claims both so the dispatcher's transport check does not mask this with a
    // different, more confusing error ("provider cannot speak web_push") when
    // the real problem is that no provider was configured at all.
    supportedTransports: ["web_push", "fcm"],
    async send() {
      return { ok: false, error: reason, retryable: false };
    },
    async healthCheck() {
      return { ok: false, error: reason };
    }
  };
}

export function resolvePushProvider(
  env: NodeJS.ProcessEnv = process.env
): PushProvider {
  const provider = env.PUSH_PROVIDER;

  if (!isKnownPushProvider(provider)) {
    return createMisconfiguredProvider(
      "PUSH_PROVIDER is missing or not a known provider."
    );
  }

  // Exhaustive over `PushProviderKind`. When `web_push` joins it, the compiler
  // flags this switch rather than letting a new kind fall through and silently
  // succeed without ever sending anything.
  const kind: PushProviderKind = provider;

  switch (kind) {
    case "log":
      return createLogPushProvider();

    case "fcm": {
      const raw = env.PUSH_FCM_CREDENTIALS_BASE64;

      if (!raw) {
        return createMisconfiguredProvider(
          "PUSH_FCM_CREDENTIALS_BASE64 is not set."
        );
      }

      const parsed = parseFcmCredentialsBase64(raw);

      if (!parsed.ok) {
        // The reason names FIELDS and shapes, never a value — the parser is
        // written so `private_key` cannot reach a message, and this is the path
        // where such a message would end up in a log.
        return createMisconfiguredProvider(
          `PUSH_FCM_CREDENTIALS_BASE64 is invalid: ${parsed.reason}.`
        );
      }

      return createFcmPushProvider({
        credential: parsed.credential,
        timeoutMs: resolvePushSendTimeoutMs(env)
      });
    }
  }
}
