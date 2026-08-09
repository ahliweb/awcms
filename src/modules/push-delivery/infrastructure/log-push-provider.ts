/**
 * Log/fake `PushProvider` (Issue #465) — `PUSH_PROVIDER=log`. Writes a
 * structured log line instead of calling a real push service; always succeeds.
 * Same role as `email/infrastructure/log-email-provider.ts`: local development
 * without real credentials, and tests that exercise the dispatcher's whole
 * claim/send/finalize cycle without network I/O.
 *
 * It claims BOTH transports, and that is not laziness. The dispatcher refuses
 * a target whose transport the resolved provider does not list, so a `log`
 * adapter that claimed only one would make half the queue unroutable in
 * development for a reason that has nothing to do with the code under test.
 *
 * Never logs the raw endpoint. It receives one — delivery is impossible
 * without it — but a Web Push endpoint URL and an FCM registration token are
 * credential-grade, so the line carries `endpointMasked`, computed once at
 * registration and carried on the target.
 */
import { log } from "../../../lib/logging/logger";
import type {
  PushDeliveryResult,
  PushHealthCheckResult,
  PushMessage,
  PushProvider,
  PushTarget
} from "../domain/push-provider-contract";

export function createLogPushProvider(): PushProvider {
  return {
    supportedTransports: ["web_push", "fcm"],

    async send(
      target: PushTarget,
      message: PushMessage
    ): Promise<PushDeliveryResult> {
      log("info", "push.log_provider.send", {
        transport: target.transport,
        endpoint: target.endpointMasked,
        title: message.title,
        correlationId: message.correlationId
      });

      return { ok: true, providerMessageId: `log:${crypto.randomUUID()}` };
    },

    async healthCheck(): Promise<PushHealthCheckResult> {
      return { ok: true };
    }
  };
}
