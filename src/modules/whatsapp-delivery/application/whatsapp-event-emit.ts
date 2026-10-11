/**
 * Domain-event emission for `whatsapp_delivery` (Issue #963, ADR-0133 section
 * 8). Every call is a plain DB write in the caller's OWN transaction
 * (`appendDomainEvent` makes no network call), which is what makes "a rolled
 * back booking emits no `queued` event" true by construction.
 *
 * Payloads carry ids, enums and the MASKED recipient. Never a phone number, a
 * body or a template variable: the caller joins its own record through the
 * envelope's `correlationId`.
 */
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  WHATSAPP_CONSENT_AGGREGATE_TYPE,
  WHATSAPP_DISPATCH_AGGREGATE_TYPE,
  WHATSAPP_EVENT_VERSION,
  WHATSAPP_MESSAGE_AGGREGATE_TYPE,
  WHATSAPP_MODULE_KEY
} from "../domain/whatsapp-events";

export type WhatsappMessageEventInput = {
  messageId: string;
  templateKey: string;
  purpose: string;
  recipientMasked: string;
  status: "queued" | "sent" | "failed" | "expired";
  failureCode?: string | null;
  correlationId?: string | null;
  actorTenantUserId?: string | null;
};

export async function emitWhatsappMessageEvent(
  tx: Bun.SQL,
  tenantId: string,
  eventType: string,
  input: WhatsappMessageEventInput
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType,
    eventVersion: WHATSAPP_EVENT_VERSION,
    aggregateType: WHATSAPP_MESSAGE_AGGREGATE_TYPE,
    aggregateId: input.messageId,
    correlationId: input.correlationId ?? null,
    producerModule: WHATSAPP_MODULE_KEY,
    actorTenantUserId: input.actorTenantUserId ?? null,
    payload: {
      messageId: input.messageId,
      templateKey: input.templateKey,
      purpose: input.purpose,
      recipientMasked: input.recipientMasked,
      status: input.status,
      ...(input.failureCode ? { failureCode: input.failureCode } : {})
    }
  });
}

export async function emitWhatsappConsentEvent(
  tx: Bun.SQL,
  tenantId: string,
  eventType: string,
  input: {
    consentId: string;
    purpose: string;
    recipientMasked: string;
    correlationId?: string | null;
    actorTenantUserId?: string | null;
  }
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType,
    eventVersion: WHATSAPP_EVENT_VERSION,
    aggregateType: WHATSAPP_CONSENT_AGGREGATE_TYPE,
    aggregateId: input.consentId,
    correlationId: input.correlationId ?? null,
    producerModule: WHATSAPP_MODULE_KEY,
    actorTenantUserId: input.actorTenantUserId ?? null,
    payload: {
      consentId: input.consentId,
      purpose: input.purpose,
      recipientMasked: input.recipientMasked
    }
  });
}

export async function emitWhatsappDispatchFailedEvent(
  tx: Bun.SQL,
  tenantId: string,
  input: { failureCode: string; batchSize?: number; occurredAt: Date }
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: "awcms.whatsapp.dispatch.failed",
    eventVersion: WHATSAPP_EVENT_VERSION,
    aggregateType: WHATSAPP_DISPATCH_AGGREGATE_TYPE,
    aggregateId: crypto.randomUUID(),
    producerModule: WHATSAPP_MODULE_KEY,
    payload: {
      failureCode: input.failureCode,
      ...(input.batchSize !== undefined ? { batchSize: input.batchSize } : {}),
      occurredAt: input.occurredAt.toISOString()
    }
  });
}
