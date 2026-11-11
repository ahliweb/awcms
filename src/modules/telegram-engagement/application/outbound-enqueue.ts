/**
 * Queueing a reply, an opted-in notice or an explicit opt-in prompt (ADR-0152
 * section 5, TG5 to TG7). One INSERT in the caller's transaction; the
 * dispatcher sends it later, outside any transaction.
 *
 * ## Who can be addressed
 *
 * Only an existing CONTACT of THIS tenant, i.e. a person who started the bot.
 * There is no parameter that takes a chat id, a handle, a phone number or an
 * imported id (T-N2): the validator refuses unknown fields and this function
 * takes a contact id it then loads under RLS.
 *
 * ## What is checked here, and again at dispatch
 *
 *   - the contact is `started` and eligible for the purpose (support from
 *     `/start`; transactional/marketing from the explicit button), the evidence
 *     row snapshotted on the message;
 *   - the bot's endpoint is `active` (verified webhook) and the account holds
 *     the `dm` capability with evidence (ADR-0148 I2).
 *
 * A refusal is a value, never a fallback to another channel or bot (TG6).
 */
import type { KeyRing } from "../../../lib/security/field-encryption";
import { encryptMessageText } from "../domain/contact-crypto";
import type {
  PromptablePurpose,
  Purpose
} from "../domain/telegram-engagement-constants";
import { MESSAGE_TTL_HOURS } from "../domain/telegram-engagement-constants";
import { botCapabilityAllowed } from "../infrastructure/channel-accounts-bridge";
import { eligibilityFor, fetchContact } from "./contact-directory";

export type EnqueueRefusal =
  | "CONTACT_NOT_STARTED"
  | "CONSENT_REQUIRED"
  | "CONSENT_WITHDRAWN"
  | "BOT_NOT_ACTIVE"
  | "CAPABILITY_DENIED";

export type EnqueueOutcome =
  | { outcome: "queued"; messageId: string; accountId: string }
  | { outcome: "not_found" }
  | { outcome: "refused"; code: EnqueueRefusal };

export type EnqueueInput =
  | { kind: "text"; purpose: Purpose; text: string }
  | {
      kind: "consent_prompt";
      promptPurpose: PromptablePurpose;
      noticeVersion: string;
      noticeText: string;
    };

export async function enqueueMessage(
  tx: Bun.SQL,
  tenantId: string,
  actor: string | null,
  contactId: string,
  input: EnqueueInput,
  ring: KeyRing,
  now: Date = new Date()
): Promise<EnqueueOutcome> {
  const contact = await fetchContact(tx, tenantId, contactId, { lock: true });

  if (!contact) return { outcome: "not_found" };

  // A prompt is itself a SUPPORT message inside the conversation the person
  // opened: asking is allowed, the answer is the consent.
  const purpose: Purpose = input.kind === "text" ? input.purpose : "support";
  const verdict = await eligibilityFor(tx, tenantId, contact, purpose);

  if (!verdict.eligible) return { outcome: "refused", code: verdict.reason };

  const endpoints = (await tx`
    SELECT id FROM awcms_telegram_engagement_endpoints
    WHERE tenant_id = ${tenantId} AND account_id = ${contact.account_id}
      AND state = 'active'
  `) as { id: string }[];

  if (endpoints.length === 0) {
    return { outcome: "refused", code: "BOT_NOT_ACTIVE" };
  }

  if (!(await botCapabilityAllowed(tx, tenantId, contact.account_id, "dm"))) {
    return { outcome: "refused", code: "CAPABILITY_DENIED" };
  }

  const messageId = crypto.randomUUID();
  const text = input.kind === "text" ? input.text : input.noticeText;
  const expiresAt = new Date(now.getTime() + MESSAGE_TTL_HOURS * 3600_000);

  await tx`
    INSERT INTO awcms_telegram_engagement_messages
      (id, tenant_id, account_id, contact_id, purpose, kind,
       consent_evidence_id, prompt_purpose, prompt_notice_version,
       text_ciphertext, status, next_attempt_at, expires_at, created_by)
    VALUES (${messageId}, ${tenantId}, ${contact.account_id}, ${contactId},
            ${purpose}, ${input.kind}, ${verdict.consentEvidenceId},
            ${input.kind === "consent_prompt" ? input.promptPurpose : null},
            ${input.kind === "consent_prompt" ? input.noticeVersion : null},
            ${encryptMessageText(text, tenantId, messageId, ring)},
            'queued', ${now}, ${expiresAt}, ${actor})
  `;

  return { outcome: "queued", messageId, accountId: contact.account_id };
}
