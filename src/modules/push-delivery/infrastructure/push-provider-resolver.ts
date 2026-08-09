/**
 * Production resolver (Issue #465) — mirrors
 * `email/infrastructure/email-provider-resolver.ts`: picks the concrete
 * `PushProvider` from configuration and DEGRADES to a clean failed-result
 * provider on misconfiguration rather than throwing. One misconfigured
 * deployment must not crash the dispatcher; `bun run config:validate` is where
 * that should have been caught at boot.
 *
 * The degraded provider returns `retryable: false`. A missing or unknown
 * `PUSH_PROVIDER` will not fix itself between now and the next pass, so
 * retrying would burn the whole retry budget of every queued row against a
 * condition only an operator can change — and then bury the real cause under
 * `retry_count` exhaustion.
 */
import {
  isKnownPushProvider,
  type PushProviderKind
} from "../domain/push-config";
import type { PushProvider } from "../domain/push-provider-contract";
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

  // Exhaustive over `PushProviderKind`. When Issue #466 adds `fcm`/`web_push`,
  // the compiler flags this switch rather than letting a new kind fall through
  // to `log` and silently succeed without ever sending anything.
  const kind: PushProviderKind = provider;

  switch (kind) {
    case "log":
      return createLogPushProvider();
  }
}
