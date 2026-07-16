/**
 * Log/fake `EmailProvider` (Issue #495) — `EMAIL_PROVIDER=log`. Writes a
 * structured log line instead of calling a real provider; always succeeds.
 * Used for local development without real Mailketing credentials, and by
 * tests that want to exercise the dispatcher's full claim/send/finalize
 * cycle without network I/O.
 *
 * Never logs the raw recipient address — reuses the same
 * normalize/hash/mask pattern the rest of the codebase uses for sensitive
 * identifiers (`profile-identity/domain/identifier.ts`), not a second
 * masking implementation. Subject/body are the caller's own content, not
 * inherently secret, but recipient masking alone is enough to keep this
 * provider's logs safe by default.
 */
import { log } from "../../../lib/logging/logger";
import {
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../../profile-identity/domain/identifier";
import type {
  EmailDeliveryResult,
  EmailHealthCheckResult,
  EmailMessage,
  EmailProvider
} from "../domain/email-provider-contract";

export function createLogEmailProvider(): EmailProvider {
  return {
    async send(message: EmailMessage): Promise<EmailDeliveryResult> {
      const recipient = message.to[0]?.address ?? "";
      const masked = recipient
        ? maskIdentifierValue(normalizeIdentifierValue("email", recipient))
        : "(no recipient)";

      log("info", "email.log_provider.send", {
        to: masked,
        subject: message.subject,
        correlationId: message.correlationId
      });

      return { ok: true, providerMessageId: `log:${crypto.randomUUID()}` };
    },

    async healthCheck(): Promise<EmailHealthCheckResult> {
      return { ok: true };
    }
  };
}
