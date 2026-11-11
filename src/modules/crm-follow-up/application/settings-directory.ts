/**
 * The tenant switch and pacing cap of `crm_follow_up` (Issue #1165,
 * ADR-0159 sections 1 and 6), and the one question every unattended path asks
 * first: is the module ACTIVE for this tenant?
 *
 * Active means all three levels are on: the deployment switch
 * (`CRM_FOLLOW_UP_ENABLED=true`), Module Management's per-tenant enable (no row
 * means "never toggled", the platform convention) and this module's own tenant
 * switch (no row means OFF). The consumer and the dispatch job do nothing for a
 * tenant that is not active: no task, no stop record, no notice.
 */
import {
  CRM_FOLLOW_UP_MODULE_KEY,
  isCrmFollowUpEnabled
} from "../domain/crm-follow-up-constants";

type Sql = Bun.SQL;

export type CrmFollowUpSettings = {
  enabled: boolean;
  maxNoticesPerRecipientHour: number;
  updatedAt: string | null;
};

const DEFAULT_SETTINGS: CrmFollowUpSettings = {
  enabled: false,
  maxNoticesPerRecipientHour: 20,
  updatedAt: null
};

export async function fetchSettings(
  tx: Sql,
  tenantId: string
): Promise<CrmFollowUpSettings> {
  const rows = (await tx`
    SELECT enabled, max_notices_per_recipient_hour, updated_at
    FROM awcms_crm_follow_up_settings
    WHERE tenant_id = ${tenantId}
  `) as {
    enabled: boolean;
    max_notices_per_recipient_hour: number;
    updated_at: Date;
  }[];
  const row = rows[0];

  return row
    ? {
        enabled: row.enabled,
        maxNoticesPerRecipientHour: Number(row.max_notices_per_recipient_hour),
        updatedAt: row.updated_at.toISOString()
      }
    : DEFAULT_SETTINGS;
}

export async function updateSettings(
  tx: Sql,
  tenantId: string,
  actor: string,
  patch: { enabled?: boolean; maxNoticesPerRecipientHour?: number }
): Promise<{ previous: CrmFollowUpSettings; current: CrmFollowUpSettings }> {
  const previous = await fetchSettings(tx, tenantId);
  const enabled = patch.enabled ?? previous.enabled;
  const cap =
    patch.maxNoticesPerRecipientHour ?? previous.maxNoticesPerRecipientHour;

  await tx`
    INSERT INTO awcms_crm_follow_up_settings
      (tenant_id, enabled, max_notices_per_recipient_hour, updated_at, updated_by)
    VALUES (${tenantId}, ${enabled}, ${cap}, now(), ${actor})
    ON CONFLICT (tenant_id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          max_notices_per_recipient_hour = EXCLUDED.max_notices_per_recipient_hour,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by
  `;

  return { previous, current: await fetchSettings(tx, tenantId) };
}

/** Module Management's per-tenant enable. No row = never toggled = enabled. */
async function moduleEnabledForTenant(
  tx: Sql,
  tenantId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT enabled FROM awcms_tenant_modules
    WHERE tenant_id = ${tenantId} AND module_key = ${CRM_FOLLOW_UP_MODULE_KEY}
  `) as { enabled: boolean }[];

  return rows[0]?.enabled ?? true;
}

/** All three levels on (see the file header). */
export async function isActiveForTenant(
  tx: Sql,
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!isCrmFollowUpEnabled(env)) return false;
  if (!(await moduleEnabledForTenant(tx, tenantId))) return false;

  return (await fetchSettings(tx, tenantId)).enabled;
}
