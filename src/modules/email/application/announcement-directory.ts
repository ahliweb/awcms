/**
 * Announcement/notification targeting + enqueue (Issue #497, epic #492).
 * Reuses `awcms_email_messages` (`sql/020`) exactly as the password
 * reset flow (#496) does — one row per resolved recipient, sharing a
 * `correlation_id` for a bulk send rather than a fan-out shape (the
 * `email_recipients` table proposed in #494 was deliberately not built;
 * this is the first real bulk-send caller that confirms that decision).
 * Provider calls never happen here — enqueue only, dispatcher (#495)
 * sends later, outside any transaction.
 */
import { log } from "../../../lib/logging/logger";
import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../../profile-identity/domain/identifier";
import { buildSyntheticSampleVariables } from "../domain/email-template-preview";
import { renderEmailTemplate } from "../domain/email-template-render";
import { fetchActiveEmailTemplateByKey } from "./email-template-directory";
import { fetchSuppressedRecipientHashes } from "./suppression-directory";
import type { AnnouncementTarget } from "../domain/announcement-validation";

const MODULE_KEY = "email";

export type ResolvedRecipient = {
  tenantUserId: string;
  loginIdentifier: string;
  displayName: string;
};

type TargetRow = {
  tenant_user_id: string;
  login_identifier: string;
  display_name: string;
};

/**
 * Active tenant_user + active identity only (skips deactivated accounts),
 * and always excludes anyone on `awcms_email_suppression_list`
 * (bounce/complaint/manual/unsubscribe — built in #494, this is its first
 * real consumer).
 */
export async function resolveAnnouncementTargets(
  tx: Bun.SQL,
  tenantId: string,
  target: AnnouncementTarget
): Promise<ResolvedRecipient[]> {
  let rows: TargetRow[];

  if (target.type === "tenant") {
    rows = (await tx`
      SELECT tu.id AS tenant_user_id, i.login_identifier, p.display_name
      FROM awcms_tenant_users tu
      JOIN awcms_identities i
        ON i.id = tu.identity_id AND i.tenant_id = tu.tenant_id
      JOIN awcms_profiles p
        ON p.id = i.profile_id AND p.tenant_id = tu.tenant_id
      WHERE tu.tenant_id = ${tenantId} AND tu.status = 'active' AND i.status = 'active'
    `) as TargetRow[];
  } else if (target.type === "role") {
    rows = (await tx`
      SELECT tu.id AS tenant_user_id, i.login_identifier, p.display_name
      FROM awcms_access_assignments aa
      JOIN awcms_tenant_users tu
        ON tu.id = aa.tenant_user_id AND tu.tenant_id = aa.tenant_id
      JOIN awcms_identities i
        ON i.id = tu.identity_id AND i.tenant_id = tu.tenant_id
      JOIN awcms_profiles p
        ON p.id = i.profile_id AND p.tenant_id = tu.tenant_id
      WHERE aa.tenant_id = ${tenantId} AND aa.role_id = ${target.roleId}
        AND tu.status = 'active' AND i.status = 'active'
    `) as TargetRow[];
  } else {
    // `tx.array(...)` — direct `= ANY(${array})` interpolation fails with
    // Bun.SQL (documented gotcha); array bind values must go through
    // `tx.array(values, "type")`.
    rows = (await tx`
      SELECT tu.id AS tenant_user_id, i.login_identifier, p.display_name
      FROM awcms_tenant_users tu
      JOIN awcms_identities i
        ON i.id = tu.identity_id AND i.tenant_id = tu.tenant_id
      JOIN awcms_profiles p
        ON p.id = i.profile_id AND p.tenant_id = tu.tenant_id
      WHERE tu.tenant_id = ${tenantId}
        AND tu.id = ANY(${tx.array(target.userIds, "uuid")})
        AND tu.status = 'active' AND i.status = 'active'
    `) as TargetRow[];
  }

  if (rows.length === 0) {
    return [];
  }

  const suppressedHashes = await fetchSuppressedRecipientHashes(tx, tenantId);

  return rows
    .filter((row) => {
      const normalized = normalizeIdentifierValue(
        "email",
        row.login_identifier
      );
      return !suppressedHashes.has(hashIdentifierValue(normalized));
    })
    .map((row) => ({
      tenantUserId: row.tenant_user_id,
      loginIdentifier: row.login_identifier,
      displayName: row.display_name
    }));
}

export type AnnouncementPreviewResult = {
  matchedCount: number;
  sample: {
    subject: string;
    textBody?: string;
    htmlBody?: string;
  };
};

/** Never returns the resolved recipient list/addresses — count only, plus a rendered sample using synthetic data merged with any caller-supplied variables (still allowlist-filtered by `renderEmailTemplate`). */
export async function previewAnnouncement(
  tx: Bun.SQL,
  tenantId: string,
  templateKey: string,
  variables: Record<string, string>,
  target: AnnouncementTarget,
  locale = "en"
): Promise<AnnouncementPreviewResult | null> {
  const template = await fetchActiveEmailTemplateByKey(
    tx,
    tenantId,
    templateKey
  );

  if (!template) {
    return null;
  }

  const recipients = await resolveAnnouncementTargets(tx, tenantId, target);
  const sampleVariables = {
    ...buildSyntheticSampleVariables(templateKey),
    ...variables
  };
  const rendered = renderEmailTemplate(
    template,
    sampleVariables,
    templateKey,
    locale
  );

  return { matchedCount: recipients.length, sample: rendered };
}

export type EnqueueAnnouncementResult = {
  recipientCount: number;
  correlationId: string;
};

/**
 * Returns `null` if `templateKey` has no active template — callers must
 * check this before enqueuing (mirrors the dispatcher's own
 * missing-template handling, #495).
 */
export async function enqueueAnnouncement(
  tx: Bun.SQL,
  tenantId: string,
  templateKey: string,
  variables: Record<string, string>,
  target: AnnouncementTarget,
  correlationId: string,
  locale = "en"
): Promise<EnqueueAnnouncementResult | null> {
  const template = await fetchActiveEmailTemplateByKey(
    tx,
    tenantId,
    templateKey
  );

  if (!template) {
    return null;
  }

  const recipients = await resolveAnnouncementTargets(tx, tenantId, target);
  const priority = target.type === "tenant" ? "normal" : "high";

  for (const recipient of recipients) {
    const normalized = normalizeIdentifierValue(
      "email",
      recipient.loginIdentifier
    );
    const recipientVariables = {
      ...variables,
      userName: recipient.displayName
    };
    const rendered = renderEmailTemplate(
      template,
      recipientVariables,
      templateKey,
      locale
    );

    await tx`
      INSERT INTO awcms_email_messages
        (tenant_id, correlation_id, category, template_key, to_address,
         to_address_hash, to_address_masked, subject, variables, priority)
      VALUES (
        ${tenantId}, ${correlationId}, ${templateKey}, ${templateKey},
        ${normalized}, ${hashIdentifierValue(normalized)},
        ${maskIdentifierValue(normalized)}, ${rendered.subject},
        ${recipientVariables}, ${priority}
      )
    `;
  }

  log("info", "email.message.queued", {
    correlationId,
    tenantId,
    moduleKey: MODULE_KEY,
    category: templateKey,
    count: recipients.length
  });

  return { recipientCount: recipients.length, correlationId };
}
