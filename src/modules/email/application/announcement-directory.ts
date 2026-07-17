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

/**
 * Hard cap on how many recipients one announcement resolves to (Issue
 * #153). `target.type: "users"` is already bounded to 500 by
 * `announcement-validation.ts`; `tenant`/`role` were unbounded, so a
 * tenant-wide announcement on a 50k-user tenant resolved 50k rows inside
 * one HTTP request's transaction.
 *
 * This is a safety bound, not a product decision: enqueue stays synchronous
 * and bounded rather than silently degrading into a request timeout that
 * enqueues *nobody*. When the cap bites, the recipients that were resolved
 * are still enqueued, `truncated: true` is returned, and
 * `email.announcement.recipients_truncated` is logged at `warning` so it is
 * visible rather than silent. Sending to a tenant larger than this cap
 * needs the async enqueue job #153 lists as the alternative fix — that is
 * deliberately out of scope here.
 */
export const ANNOUNCEMENT_MAX_RECIPIENTS = 5000;

/**
 * Rows per multi-row INSERT. Postgres binds parameters per statement; with
 * `unnest` the row count does not multiply the parameter count (one array
 * parameter per column), but chunking still keeps each statement's payload
 * and memory bounded. 500 matches the `MAX_EXPLICIT_USER_IDS` order of
 * magnitude already used by the validation layer.
 */
const INSERT_BATCH_SIZE = 500;

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

export type BoundedTargets = {
  recipients: ResolvedRecipient[];
  /** `true` when the target query hit `ANNOUNCEMENT_MAX_RECIPIENTS` and more matching users exist than were resolved. */
  truncated: boolean;
};

/**
 * Active tenant_user + active identity only (skips deactivated accounts),
 * and always excludes anyone on `awcms_email_suppression_list`
 * (bounce/complaint/manual/unsubscribe — built in #494, this is its first
 * real consumer).
 *
 * Bounded by `ANNOUNCEMENT_MAX_RECIPIENTS` (Issue #153). The `ORDER BY
 * tu.created_at, tu.id` on the capped queries makes the truncation
 * deterministic (oldest accounts first) instead of leaving it to whatever
 * order the planner happens to produce — the same set is previewed and
 * enqueued, and a re-run of the same announcement does not resolve a
 * different arbitrary slice.
 */
export async function resolveBoundedAnnouncementTargets(
  tx: Bun.SQL,
  tenantId: string,
  target: AnnouncementTarget
): Promise<BoundedTargets> {
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
      ORDER BY tu.created_at, tu.id
      LIMIT ${ANNOUNCEMENT_MAX_RECIPIENTS}
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
      ORDER BY tu.created_at, tu.id
      LIMIT ${ANNOUNCEMENT_MAX_RECIPIENTS}
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

  // `truncated` is decided on the *pre-suppression* row count: the cap is a
  // property of the target query, and suppression filtering happens after it
  // in application code. A resolve that came back exactly at the cap is
  // reported as truncated even in the rare case the tenant has exactly that
  // many active users — over-reporting a bound is safe, under-reporting a
  // silently dropped recipient is not.
  const truncated = rows.length >= ANNOUNCEMENT_MAX_RECIPIENTS;

  if (rows.length === 0) {
    return { recipients: [], truncated };
  }

  const suppressedHashes = await fetchSuppressedRecipientHashes(tx, tenantId);

  const recipients = rows
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

  return { recipients, truncated };
}

/** Unchanged signature kept for existing callers (and derived apps) that only need the list. */
export async function resolveAnnouncementTargets(
  tx: Bun.SQL,
  tenantId: string,
  target: AnnouncementTarget
): Promise<ResolvedRecipient[]> {
  const resolved = await resolveBoundedAnnouncementTargets(
    tx,
    tenantId,
    target
  );

  return resolved.recipients;
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
  /** `true` when `ANNOUNCEMENT_MAX_RECIPIENTS` capped the audience — the enqueued recipients were sent, but not every matching user was reached (Issue #153). Additive field; the HTTP layer's response shape is unchanged. */
  truncated: boolean;
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

  const { recipients, truncated } = await resolveBoundedAnnouncementTargets(
    tx,
    tenantId,
    target
  );
  const priority = target.type === "tenant" ? "normal" : "high";

  // Rendering is pure and in-process (`renderEmailTemplate`), so every row is
  // materialized first and the database is touched only by the batched
  // INSERTs below. No provider call happens here at all — enqueue only
  // (ADR-0006); the dispatcher sends later, outside any transaction.
  const rows = recipients.map((recipient) => {
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

    return {
      toAddress: normalized,
      toAddressHash: hashIdentifierValue(normalized),
      toAddressMasked: maskIdentifierValue(normalized),
      subject: rendered.subject,
      variables: JSON.stringify(recipientVariables)
    };
  });

  // Batched (one round trip per `INSERT_BATCH_SIZE` rows, via `unnest`)
  // instead of one INSERT per recipient — Issue #153, same shape as the
  // `awcms_object_sync_queue` batch insert in
  // `src/pages/api/v1/sync/objects/index.ts` (Issue #435's N+1 audit).
  // A tenant-wide announcement to 5000 recipients drops from 5000
  // sequential round trips to 10.
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_BATCH_SIZE);

    await tx`
      INSERT INTO awcms_email_messages
        (tenant_id, correlation_id, category, template_key, to_address,
         to_address_hash, to_address_masked, subject, variables, priority)
      SELECT ${tenantId}, ${correlationId}, ${templateKey}, ${templateKey},
             t.to_address, t.to_address_hash, t.to_address_masked, t.subject,
             t.variables::jsonb, ${priority}
      FROM unnest(
        ${tx.array(
          chunk.map((row) => row.toAddress),
          "text"
        )},
        ${tx.array(
          chunk.map((row) => row.toAddressHash),
          "text"
        )},
        ${tx.array(
          chunk.map((row) => row.toAddressMasked),
          "text"
        )},
        ${tx.array(
          chunk.map((row) => row.subject),
          "text"
        )},
        ${tx.array(
          chunk.map((row) => row.variables),
          "text"
        )}
      ) AS t(to_address, to_address_hash, to_address_masked, subject, variables)
    `;
  }

  if (truncated) {
    log("warning", "email.announcement.recipients_truncated", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY,
      category: templateKey,
      count: recipients.length,
      limit: ANNOUNCEMENT_MAX_RECIPIENTS
    });
  }

  log("info", "email.message.queued", {
    correlationId,
    tenantId,
    moduleKey: MODULE_KEY,
    category: templateKey,
    count: recipients.length
  });

  return { recipientCount: recipients.length, correlationId, truncated };
}
