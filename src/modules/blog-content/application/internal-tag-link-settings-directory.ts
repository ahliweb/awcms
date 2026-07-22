/**
 * `awcms_blog_internal_tag_link_settings` read/write (Issue #641) —
 * one row per tenant, same upsert convention `theme-settings-directory.ts`
 * uses for `awcms_blog_theme_settings`. A tenant that never
 * configured this reads back the table's own column defaults (`enabled =
 * true`, `caseInsensitive = false`, `disabledTagIds = []`) — same
 * "missing row = default" convention `fetchBlogSettings` uses.
 */
import type { UpdateInternalTagLinkingSettingsInput } from "../domain/internal-tag-linking-policy";

export type InternalTagLinkingSettingsView = {
  tenantId: string;
  enabled: boolean;
  caseInsensitive: boolean;
  disabledTagIds: string[];
  updatedAt: string | null;
};

type InternalTagLinkingSettingsRow = {
  tenant_id: string;
  enabled: boolean;
  case_insensitive: boolean;
  /** Bun's Postgres driver returns an array column as its raw `{a,b,c}` wire-format text, NOT a parsed JS array — see `parsePostgresUuidArray` below. */
  disabled_tag_ids: string | string[] | null;
  updated_at: Date;
};

const DEFAULT_SETTINGS = {
  enabled: true,
  caseInsensitive: false,
  disabledTagIds: [] as string[]
};

/**
 * Bun.SQL does not auto-deserialize a Postgres array column into a JS
 * array (verified empirically: a `uuid[]` column round-trips as the literal
 * wire-format string `"{uuid1,uuid2}"`, `typeof === "string"`) — this
 * parses that format. Safe for UUIDs specifically (no commas/braces/quotes
 * to escape within an element), which is the only element type this column
 * ever holds. Defensively also accepts an already-parsed array in case a
 * future Bun version changes this behavior.
 */
function parsePostgresUuidArray(value: string | string[] | null): string[] {
  if (value === null) return [];
  if (Array.isArray(value)) return [...value];
  const trimmed = value.trim();
  if (trimmed === "{}" || trimmed.length === 0) return [];
  return trimmed.replace(/^\{/, "").replace(/\}$/, "").split(",");
}

function toView(
  tenantId: string,
  row: InternalTagLinkingSettingsRow | null
): InternalTagLinkingSettingsView {
  if (!row) {
    return {
      tenantId,
      enabled: DEFAULT_SETTINGS.enabled,
      caseInsensitive: DEFAULT_SETTINGS.caseInsensitive,
      disabledTagIds: [...DEFAULT_SETTINGS.disabledTagIds],
      updatedAt: null
    };
  }

  return {
    tenantId,
    enabled: row.enabled,
    caseInsensitive: row.case_insensitive,
    disabledTagIds: parsePostgresUuidArray(row.disabled_tag_ids),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function fetchInternalTagLinkingSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<InternalTagLinkingSettingsView> {
  const rows = (await tx`
    SELECT tenant_id, enabled, case_insensitive, disabled_tag_ids, updated_at
    FROM awcms_blog_internal_tag_link_settings
    WHERE tenant_id = ${tenantId}
  `) as InternalTagLinkingSettingsRow[];

  return toView(tenantId, rows[0] ?? null);
}

/** Upsert — merges `patch` onto the existing row (or the defaults, for a tenant's first write). */
export async function upsertInternalTagLinkingSettings(
  tx: Bun.SQL,
  tenantId: string,
  patch: UpdateInternalTagLinkingSettingsInput
): Promise<InternalTagLinkingSettingsView> {
  const existing = await fetchInternalTagLinkingSettings(tx, tenantId);

  const enabled = patch.enabled ?? existing.enabled;
  const caseInsensitive = patch.caseInsensitive ?? existing.caseInsensitive;
  const disabledTagIds = patch.disabledTagIds ?? existing.disabledTagIds;

  const rows = (await tx`
    INSERT INTO awcms_blog_internal_tag_link_settings
      (tenant_id, enabled, case_insensitive, disabled_tag_ids, updated_at)
    VALUES
      (${tenantId}, ${enabled}, ${caseInsensitive}, ${tx.array(disabledTagIds, "uuid")}, now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      case_insensitive = EXCLUDED.case_insensitive,
      disabled_tag_ids = EXCLUDED.disabled_tag_ids,
      updated_at = now()
    RETURNING tenant_id, enabled, case_insensitive, disabled_tag_ids, updated_at
  `) as InternalTagLinkingSettingsRow[];

  return toView(tenantId, rows[0] ?? null);
}

/**
 * Counts how many of `tagIds` are real, same-tenant, non-deleted,
 * `taxonomy_type = 'tag'` terms — used to reject a `disabledTagIds` entry
 * that doesn't exist / belongs to another tenant / is actually a category,
 * same "verify existence before accepting an id list" convention
 * `countExistingTerms` (`blog-taxonomy-directory.ts`) already established
 * for `termIds`.
 */
export async function countExistingTagTermIds(
  tx: Bun.SQL,
  tenantId: string,
  tagIds: readonly string[]
): Promise<number> {
  if (tagIds.length === 0) {
    return 0;
  }

  const rows = (await tx`
    SELECT count(*)::int AS count FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND taxonomy_type = 'tag'
      AND id = ANY(${tx.array([...tagIds], "uuid")})
  `) as { count: number }[];

  return rows[0]?.count ?? 0;
}
