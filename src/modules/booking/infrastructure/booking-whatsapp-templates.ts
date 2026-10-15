/**
 * Registers booking's two WhatsApp templates with the delivery module's
 * template registry (Issue #943, ADR-0133 section 4: "a consumer registers its
 * templates from its own module scope, module-prefixed").
 *
 * This is the ONE place `booking` imports from `whatsapp_delivery` code, and the
 * edge is declared (`capabilities.consumes`, optional). The template registry is
 * process-local code, not rows, so EVERY process that renders or sends a booking
 * message must call this: the reminder job (to enqueue) and `whatsapp:dispatch`
 * (to resolve the key at send time; an unregistered key is terminal
 * `template_unknown`). `tests/booking-reminder.test.ts` fails if either entry
 * point stops calling it.
 *
 * Idempotent: registering the identical definition again is a no-op.
 */
import { BOOKING_WHATSAPP_TEMPLATES } from "../domain/booking-reminder";
import { registerWhatsappTemplate } from "../../whatsapp-delivery/domain/whatsapp-templates";

export function registerBookingWhatsappTemplates(): void {
  for (const template of BOOKING_WHATSAPP_TEMPLATES) {
    registerWhatsappTemplate({
      key: template.key,
      version: template.version,
      purpose: template.purpose,
      body: template.body,
      variables: template.variables
    });
  }
}
