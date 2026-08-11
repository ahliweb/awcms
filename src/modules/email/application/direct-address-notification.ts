/**
 * Enqueue one auth email to a RAW ADDRESS — the recipient shape
 * `enqueueAnnouncement` cannot express (Gelombang 4 of Issue #423, ADR-0082).
 *
 * ## Why this exists at all
 *
 * Every existing delivery path resolves recipients through
 * `awcms_tenant_users → awcms_identities → awcms_profiles`, requiring both rows
 * to be `active`. That is correct for every email this system sent until now,
 * because all of them were addressed to an ACCOUNT.
 *
 * An invitation is not. The whole point of the message is that its recipient
 * has no membership row yet — the row only comes into existence if they accept.
 * `AuthNotificationPort.enqueueAuthNotification` takes a
 * `recipientTenantUserId` and therefore cannot address them, so this is a
 * second operation rather than a widening of the first: making that field
 * nullable would leave every existing caller one typo away from enqueueing an
 * unaddressed row.
 *
 * ## Enqueue only, and the same suppression rule
 *
 * No provider call happens here (ADR-0006) — the dispatcher sends later,
 * outside any transaction, exactly as it does for announcements. The
 * suppression list is honoured, because an address that asked to stop hearing
 * from this tenant did not make an exception for invitations.
 *
 * ## The deliberate asymmetry between the address and its hash
 *
 * `to_address_hash` and `to_address_masked` are computed from the NORMALIZED
 * (lowercased) address, because that is what `fetchSuppressedRecipientHashes`
 * matches on and a suppression that missed `Foo@x.com` while catching
 * `foo@x.com` would be no suppression at all.
 *
 * `to_address` is stored normalized too, matching what `enqueueAnnouncement`
 * writes for every other message — this column is what the SMTP envelope uses,
 * and mail domains are case-insensitive.
 *
 * What is NOT normalized is `awcms_invitations.login_identifier`, and the split
 * is the point: that column has to match `awcms_identities.login_identifier`
 * byte for byte, because every lookup on the auth path is exact equality. See
 * `identity-access/domain/invitation-policy.ts`.
 */
import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../../profile-identity/domain/identifier";
import { renderEmailTemplate } from "../domain/email-template-render";
import { fetchActiveEmailTemplateByKey } from "./email-template-directory";
import { fetchSuppressedRecipientHashes } from "./suppression-directory";

export type EnqueueDirectAddressResult = {
  /** `false` when the tenant has no ACTIVE template for the key, or the address is suppressed. */
  enqueued: boolean;
};

export async function enqueueDirectAddressEmail(
  tx: Bun.SQL,
  tenantId: string,
  templateKey: string,
  toAddress: string,
  variables: Record<string, string>,
  correlationId: string,
  locale = "en"
): Promise<EnqueueDirectAddressResult> {
  const template = await fetchActiveEmailTemplateByKey(
    tx,
    tenantId,
    templateKey
  );

  if (!template) {
    return { enqueued: false };
  }

  const normalized = normalizeIdentifierValue("email", toAddress);
  const addressHash = hashIdentifierValue(normalized);

  const suppressedHashes = await fetchSuppressedRecipientHashes(tx, tenantId);
  if (suppressedHashes.has(addressHash)) {
    return { enqueued: false };
  }

  const rendered = renderEmailTemplate(
    template,
    variables,
    templateKey,
    locale
  );

  await tx`
    INSERT INTO awcms_email_messages
      (tenant_id, correlation_id, category, template_key, to_address,
       to_address_hash, to_address_masked, subject, variables, priority)
    VALUES
      (${tenantId}, ${correlationId}, ${templateKey}, ${templateKey},
       ${normalized}, ${addressHash}, ${maskIdentifierValue(normalized)},
       ${rendered.subject}, ${JSON.stringify(variables)}::jsonb, 'high')
  `;

  return { enqueued: true };
}
