/**
 * The outward seam of `telegram_engagement`: the domain events a downstream
 * conversation authority (the cross-channel inbox, #1164; awcms-one #460)
 * consumes, in the ADR-0150 section 3 envelope shape.
 *
 * ## Ids, codes and classes, never the person or the words
 *
 * The envelope carries the CONTACT id (opaque, account-scoped) as both the
 * platform-scoped sender and the conversation id, the channel account id, the
 * per-bot `update_id`, a closed `event_kind`, the content KINDS, the provenance
 * (`secret_header`: the per-bot secret-token header verified in constant time)
 * and a `privacy_class`. It never carries a Telegram user id, a chat id, a
 * username, a display name, a phone number, message text, a token or a header
 * (ADR-0152 TG11, ADR-0150 N4). The body itself is not kept upstream
 * (ADR-0150 section 1); whether a short-lived `content_ref` may travel is
 * ADR-0150 open question Q4 and is answered "no" until it is decided.
 *
 * Pure module.
 */
import type { ContentKind } from "./update-parser";
import type {
  ConsentMethod,
  PrivacyClass,
  Purpose
} from "./telegram-engagement-constants";

export const INTERACTION_CONTRACT_VERSION = "1";

export type InteractionEventKind = "message" | "membership" | "command";

export type InteractionReceivedFacts = {
  channelAccountId: string;
  contactId: string;
  updateId: number;
  eventKind: InteractionEventKind;
  contentKinds: ContentKind[];
  forwarded: boolean;
  occurredAt: Date;
  receivedAt: Date;
  correlationId: string;
  privacyClass: PrivacyClass;
};

export function buildInteractionReceivedPayload(
  facts: InteractionReceivedFacts
): Record<string, unknown> {
  return {
    contractVersion: INTERACTION_CONTRACT_VERSION,
    provider: "telegram",
    channelAccountId: facts.channelAccountId,
    eventKind: facts.eventKind,
    // ADR-0150 N3: the replay key is (account, update id); update ids are a
    // per-bot sequence and are never compared across bots.
    providerEventId: String(facts.updateId),
    // Platform-scoped and account-scoped: the contact, never the Telegram id.
    conversationRef: facts.contactId,
    senderRef: facts.contactId,
    contentKinds: facts.contentKinds,
    forwarded: facts.forwarded,
    provenance: "secret_header",
    occurredAt: facts.occurredAt.toISOString(),
    receivedAt: facts.receivedAt.toISOString(),
    correlationId: facts.correlationId,
    privacyClass: facts.privacyClass
  };
}

export type ConsentChangedFacts = {
  channelAccountId: string;
  contactId: string;
  purpose: Purpose;
  action: "opt_in" | "opt_out";
  method: ConsentMethod;
  noticeVersion: string | null;
  occurredAt: Date;
};

/** `consent` class: booleans and versions, never the evidence payload (ADR-0152 section 6). */
export function buildConsentChangedPayload(
  facts: ConsentChangedFacts
): Record<string, unknown> {
  return {
    contractVersion: INTERACTION_CONTRACT_VERSION,
    provider: "telegram",
    channelAccountId: facts.channelAccountId,
    contactRef: facts.contactId,
    purpose: facts.purpose,
    action: facts.action,
    method: facts.method,
    noticeVersion: facts.noticeVersion,
    occurredAt: facts.occurredAt.toISOString(),
    privacyClass: "consent"
  };
}
