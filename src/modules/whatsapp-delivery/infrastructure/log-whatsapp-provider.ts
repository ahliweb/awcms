/**
 * Log/fake `WhatsappProvider` (Issue #963) — `WHATSAPP_PROVIDER=log`. Records a
 * structured line instead of calling WhatsApp; always succeeds. For local
 * development without credentials and for tests that exercise the dispatcher's
 * whole claim/send/finalise cycle without network I/O. It logs the MASKED
 * number and never the body (an OTP lives there).
 */
import { log } from "../../../lib/logging/logger";
import type {
  WhatsappHealthResult,
  WhatsappProvider,
  WhatsappSendRequest,
  WhatsappSendResult
} from "../domain/whatsapp-provider-contract";

export function createLogWhatsappProvider(): WhatsappProvider {
  return {
    async send(request: WhatsappSendRequest): Promise<WhatsappSendResult> {
      log("info", "whatsapp.log_provider.send", {
        to: request.toMasked,
        templateKey: request.templateKey,
        correlationId: request.correlationId
      });

      return { ok: true, providerMessageId: `log:${crypto.randomUUID()}` };
    },

    async healthCheck(): Promise<WhatsappHealthResult> {
      return { ok: true };
    }
  };
}
