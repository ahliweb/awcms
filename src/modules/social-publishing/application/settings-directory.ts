/**
 * Per-tenant switches and publish rules (Issue #1145, ADR-0157 sections 1, 2).
 * Plain SQL in the caller's tenant transaction; no provider call.
 */
import type { SettingsPatch } from "../domain/social-publishing-validation";
import type { SocialPublishTrigger } from "../domain/social-publishing-constants";

export type SocialPublishingSettings = {
  autoPublishEnabled: boolean;
  approvalRequired: boolean;
  updatedAt: Date | null;
};

type SettingsRow = {
  auto_publish_enabled: boolean;
  approval_required: boolean;
  updated_at: Date;
};

/** A tenant with no row is the DEFAULT: nothing is published automatically and approval is required. */
export const DEFAULT_SETTINGS: SocialPublishingSettings = {
  autoPublishEnabled: false,
  approvalRequired: true,
  updatedAt: null
};

export async function fetchSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<SocialPublishingSettings> {
  const rows = (await tx`
    SELECT auto_publish_enabled, approval_required, updated_at
    FROM awcms_social_publishing_settings
    WHERE tenant_id = ${tenantId}
  `) as SettingsRow[];
  const row = rows[0];

  return row
    ? {
        autoPublishEnabled: row.auto_publish_enabled,
        approvalRequired: row.approval_required,
        updatedAt: row.updated_at
      }
    : DEFAULT_SETTINGS;
}

export async function updateSettings(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  patch: SettingsPatch
): Promise<{
  previous: SocialPublishingSettings;
  current: SocialPublishingSettings;
}> {
  const previous = await fetchSettings(tx, tenantId);
  const next = {
    autoPublishEnabled: patch.autoPublishEnabled ?? previous.autoPublishEnabled,
    approvalRequired: patch.approvalRequired ?? previous.approvalRequired
  };

  const rows = (await tx`
    INSERT INTO awcms_social_publishing_settings
      (tenant_id, auto_publish_enabled, approval_required, updated_by)
    VALUES (${tenantId}, ${next.autoPublishEnabled},
            ${next.approvalRequired}, ${actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE SET
      auto_publish_enabled = EXCLUDED.auto_publish_enabled,
      approval_required = EXCLUDED.approval_required,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING auto_publish_enabled, approval_required, updated_at
  `) as SettingsRow[];
  const row = rows[0]!;

  return {
    previous,
    current: {
      autoPublishEnabled: row.auto_publish_enabled,
      approvalRequired: row.approval_required,
      updatedAt: row.updated_at
    }
  };
}

export type PublishRuleView = {
  id: string;
  trigger: SocialPublishTrigger;
  accountId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type RuleRow = {
  id: string;
  trigger_event: SocialPublishTrigger;
  channel_account_id: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

function toRule(row: RuleRow): PublishRuleView {
  return {
    id: row.id,
    trigger: row.trigger_event,
    accountId: row.channel_account_id,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export const MAX_RULES_PER_TENANT = 200;

/** Bounded by the unique key (trigger x account) and a hard cap, so the list is a complete answer, not a first page. */
export async function listRules(
  tx: Bun.SQL,
  tenantId: string
): Promise<PublishRuleView[]> {
  const rows = (await tx`
    SELECT id, trigger_event, channel_account_id, enabled, created_at, updated_at
    FROM awcms_social_publish_rules
    WHERE tenant_id = ${tenantId}
    ORDER BY trigger_event, created_at, id
    LIMIT ${MAX_RULES_PER_TENANT}
  `) as RuleRow[];

  return rows.map(toRule);
}

export async function countRules(
  tx: Bun.SQL,
  tenantId: string
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS total FROM awcms_social_publish_rules
    WHERE tenant_id = ${tenantId}
  `) as { total: number }[];

  return rows[0]?.total ?? 0;
}

/** Adds a rule, or re-enables a disabled one (the unique key makes it one row per trigger and account). */
export async function upsertRule(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  trigger: SocialPublishTrigger,
  accountId: string
): Promise<{ rule: PublishRuleView; created: boolean }> {
  const rows = (await tx`
    INSERT INTO awcms_social_publish_rules
      (tenant_id, trigger_event, channel_account_id, enabled, created_by, updated_by)
    VALUES (${tenantId}, ${trigger}, ${accountId}, true,
            ${actorTenantUserId}, ${actorTenantUserId})
    ON CONFLICT (tenant_id, trigger_event, channel_account_id) DO UPDATE SET
      enabled = true, updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING id, trigger_event, channel_account_id, enabled, created_at,
              updated_at, (xmax = 0) AS inserted
  `) as (RuleRow & { inserted: boolean })[];
  const row = rows[0]!;

  return { rule: toRule(row), created: row.inserted };
}

export async function setRuleEnabled(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  ruleId: string,
  enabled: boolean
): Promise<PublishRuleView | null> {
  const rows = (await tx`
    UPDATE awcms_social_publish_rules
    SET enabled = ${enabled}, updated_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${ruleId}
    RETURNING id, trigger_event, channel_account_id, enabled, created_at, updated_at
  `) as RuleRow[];

  return rows[0] ? toRule(rows[0]) : null;
}

/** The accounts an article event publishes to: every ENABLED rule of the trigger, one entry per account. */
export async function listEnabledRuleAccountIds(
  tx: Bun.SQL,
  tenantId: string,
  trigger: SocialPublishTrigger
): Promise<string[]> {
  const rows = (await tx`
    SELECT channel_account_id FROM awcms_social_publish_rules
    WHERE tenant_id = ${tenantId} AND trigger_event = ${trigger} AND enabled
    ORDER BY created_at, id
    LIMIT ${MAX_RULES_PER_TENANT}
  `) as { channel_account_id: string }[];

  return rows.map((row) => row.channel_account_id);
}
