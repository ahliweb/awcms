/**
 * Theme config data access (Issue #269, ADR-0029 §4) over
 * `awcms_theming_config_versions` (draft + immutable published versions)
 * and `awcms_theming_tenant_state` (the active pointer). Every query runs
 * inside a caller-provided tenant transaction (`withTenant`, RLS FORCE'd on both
 * tables), so tenant isolation holds twice: the explicit `tenant_id` filter here
 * and RLS.
 *
 * This module holds ONLY plain reads/writes — the orchestration (validate →
 * draft → publish → rollback → retire, with audit) lives in `theme-service.ts`.
 * Published versions are never UPDATEd here (a change inserts a new version); the
 * sql/033 trigger is the DB-level backstop for that invariant.
 */
import type { ThemeConfig } from "../domain/theme-config";
import type { ThemeVersionStatus } from "../domain/theme-lifecycle";

export type ThemeTenantState = {
  activeThemeKey: string | null;
  activeVersionId: string | null;
  draftThemeKey: string | null;
};

export const EMPTY_THEME_TENANT_STATE: ThemeTenantState = {
  activeThemeKey: null,
  activeVersionId: null,
  draftThemeKey: null
};

export type ThemeConfigVersion = {
  id: string;
  themeKey: string;
  themeVersion: string;
  status: ThemeVersionStatus;
  versionNumber: number | null;
  config: ThemeConfig;
  configHash: string;
  createdAt: Date;
  publishedAt: Date | null;
};

type VersionRow = {
  id: string;
  theme_key: string;
  theme_version: string;
  status: ThemeVersionStatus;
  version_number: number | null;
  config: ThemeConfig;
  config_hash: string;
  created_at: Date;
  published_at: Date | null;
};

const VERSION_COLUMNS =
  "id, theme_key, theme_version, status, version_number, config, config_hash, created_at, published_at";

function toVersion(row: VersionRow): ThemeConfigVersion {
  return {
    id: row.id,
    themeKey: row.theme_key,
    themeVersion: row.theme_version,
    status: row.status,
    versionNumber:
      row.version_number === null ? null : Number(row.version_number),
    config: row.config,
    configHash: row.config_hash,
    createdAt: row.created_at,
    publishedAt: row.published_at
  };
}

// --- tenant state --------------------------------------------------------

export async function fetchThemeTenantState(
  tx: Bun.SQL,
  tenantId: string
): Promise<ThemeTenantState> {
  const rows = (await tx`
    SELECT active_theme_key, active_version_id, draft_theme_key
    FROM awcms_theming_tenant_state
    WHERE tenant_id = ${tenantId}
  `) as {
    active_theme_key: string | null;
    active_version_id: string | null;
    draft_theme_key: string | null;
  }[];
  const row = rows[0];
  if (!row) return { ...EMPTY_THEME_TENANT_STATE };
  return {
    activeThemeKey: row.active_theme_key,
    activeVersionId: row.active_version_id,
    draftThemeKey: row.draft_theme_key
  };
}

/** Upsert the active pointer (publish/rollback set it; retire clears it to null). */
export async function setActiveThemeVersion(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  activeThemeKey: string | null,
  activeVersionId: string | null
): Promise<void> {
  await tx`
    INSERT INTO awcms_theming_tenant_state
      (tenant_id, active_theme_key, active_version_id, created_by, updated_by)
    VALUES (${tenantId}, ${activeThemeKey}, ${activeVersionId}, ${actorTenantUserId}, ${actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE SET
      active_theme_key = EXCLUDED.active_theme_key,
      active_version_id = EXCLUDED.active_version_id,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;
}

/** Record the draft's theme key on the state row (denormalized convenience). */
export async function setDraftThemeKey(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  draftThemeKey: string | null
): Promise<void> {
  await tx`
    INSERT INTO awcms_theming_tenant_state
      (tenant_id, draft_theme_key, created_by, updated_by)
    VALUES (${tenantId}, ${draftThemeKey}, ${actorTenantUserId}, ${actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE SET
      draft_theme_key = EXCLUDED.draft_theme_key,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;
}

// --- versions ------------------------------------------------------------

export async function fetchDraftVersion(
  tx: Bun.SQL,
  tenantId: string
): Promise<ThemeConfigVersion | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(VERSION_COLUMNS)}
    FROM awcms_theming_config_versions
    WHERE tenant_id = ${tenantId} AND status = 'draft'
  `) as VersionRow[];
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function fetchVersionById(
  tx: Bun.SQL,
  tenantId: string,
  versionId: string
): Promise<ThemeConfigVersion | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(VERSION_COLUMNS)}
    FROM awcms_theming_config_versions
    WHERE tenant_id = ${tenantId} AND id = ${versionId}
  `) as VersionRow[];
  return rows[0] ? toVersion(rows[0]) : null;
}

/** Newest published versions first (version history listing), bounded. */
export async function listPublishedVersions(
  tx: Bun.SQL,
  tenantId: string,
  limit = 50
): Promise<ThemeConfigVersion[]> {
  const rows = (await tx`
    SELECT ${tx.unsafe(VERSION_COLUMNS)}
    FROM awcms_theming_config_versions
    WHERE tenant_id = ${tenantId} AND status = 'published'
    ORDER BY version_number DESC
    LIMIT ${limit}
  `) as VersionRow[];
  return rows.map(toVersion);
}

/** The set of this tenant's published version ids — the valid rollback targets. */
export async function listPublishedVersionIds(
  tx: Bun.SQL,
  tenantId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT id
    FROM awcms_theming_config_versions
    WHERE tenant_id = ${tenantId} AND status = 'published'
  `) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Upsert the tenant's single draft version. The one-draft-per-tenant partial
 * unique index (sql/033) is the conflict target; the sql/033 trigger permits
 * updating a draft (it only forbids mutating a `published` row).
 */
export async function upsertDraftVersion(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  themeKey: string,
  themeVersion: string,
  config: ThemeConfig,
  configHash: string
): Promise<ThemeConfigVersion> {
  const rows = (await tx`
    INSERT INTO awcms_theming_config_versions
      (tenant_id, theme_key, theme_version, status, config, config_hash, created_by)
    VALUES (${tenantId}, ${themeKey}, ${themeVersion}, 'draft', ${config}::jsonb, ${configHash}, ${actorTenantUserId})
    ON CONFLICT (tenant_id) WHERE status = 'draft'
    DO UPDATE SET
      theme_key = EXCLUDED.theme_key,
      theme_version = EXCLUDED.theme_version,
      config = EXCLUDED.config,
      config_hash = EXCLUDED.config_hash,
      updated_at = now()
    RETURNING ${tx.unsafe(VERSION_COLUMNS)}
  `) as VersionRow[];
  return toVersion(rows[0]!);
}

/**
 * The next per-tenant published version number (max + 1, or 1). The partial
 * unique index on (tenant_id, version_number) WHERE status='published' turns a
 * concurrent double-publish into a unique-violation on one of them, so the
 * caller never has to lock.
 */
export async function nextPublishedVersionNumber(
  tx: Bun.SQL,
  tenantId: string
): Promise<number> {
  const rows = (await tx`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next
    FROM awcms_theming_config_versions
    WHERE tenant_id = ${tenantId} AND status = 'published'
  `) as { next: number }[];
  return Number(rows[0]?.next ?? 1);
}

/** Insert a new immutable published version (never mutates an existing one). */
export async function insertPublishedVersion(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  themeKey: string,
  themeVersion: string,
  config: ThemeConfig,
  configHash: string,
  versionNumber: number
): Promise<ThemeConfigVersion> {
  const rows = (await tx`
    INSERT INTO awcms_theming_config_versions
      (tenant_id, theme_key, theme_version, status, version_number, config,
       config_hash, created_by, published_at, published_by)
    VALUES (${tenantId}, ${themeKey}, ${themeVersion}, 'published', ${versionNumber},
       ${config}::jsonb, ${configHash}, ${actorTenantUserId}, now(), ${actorTenantUserId})
    RETURNING ${tx.unsafe(VERSION_COLUMNS)}
  `) as VersionRow[];
  return toVersion(rows[0]!);
}
