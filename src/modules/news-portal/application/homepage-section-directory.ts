import type {
  CreateHomepageSectionInput,
  HomepageSectionType,
  UpdateHomepageSectionInput
} from "../domain/homepage-section-policy";

/**
 * Read/write query module for `awcms_news_portal_homepage_sections`
 * (Issue #637) — same "one directory, reads and writes" convention as
 * `ads-directory.ts`/`blog-taxonomy-directory.ts`. The column list is
 * repeated literally at each query site (not factored into a shared
 * fragment) — same convention every other directory module in this repo
 * uses (see `tenant-domain-directory.ts`'s own header comment), so every
 * query stays a single self-contained tagged template.
 */
export type HomepageSectionView = {
  id: string;
  tenantId: string;
  sectionKey: string;
  sectionType: HomepageSectionType;
  title: string | null;
  config: Record<string, unknown>;
  sortOrder: number;
  isEnabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type HomepageSectionRow = {
  id: string;
  tenant_id: string;
  section_key: string;
  section_type: HomepageSectionType;
  title: string | null;
  config_json: Record<string, unknown>;
  sort_order: number;
  is_enabled: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toView(row: HomepageSectionRow): HomepageSectionView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sectionKey: row.section_key,
    sectionType: row.section_type,
    title: row.title,
    config: row.config_json,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

export async function createHomepageSection(
  tx: Bun.SQL,
  tenantId: string,
  input: CreateHomepageSectionInput
): Promise<HomepageSectionView> {
  const rows = (await tx`
    INSERT INTO awcms_news_portal_homepage_sections
      (tenant_id, section_key, section_type, title, config_json, sort_order,
       is_enabled, starts_at, ends_at)
    VALUES (
      ${tenantId}, ${input.sectionKey}, ${input.sectionType}, ${input.title},
      ${input.config}, ${input.sortOrder}, ${input.isEnabled}, ${input.startsAt},
      ${input.endsAt}
    )
    RETURNING id, tenant_id, section_key, section_type, title, config_json,
      sort_order, is_enabled, starts_at, ends_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason
  `) as HomepageSectionRow[];

  return toView(rows[0]!);
}

export async function fetchHomepageSectionById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<HomepageSectionView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, section_key, section_type, title, config_json,
      sort_order, is_enabled, starts_at, ends_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason
    FROM awcms_news_portal_homepage_sections
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as HomepageSectionRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

/** Admin listing — every non-deleted section (enabled or not, in/out of schedule window), ordered for the reorder UI. */
export async function listHomepageSections(
  tx: Bun.SQL,
  tenantId: string
): Promise<HomepageSectionView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, section_key, section_type, title, config_json,
      sort_order, is_enabled, starts_at, ends_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason
    FROM awcms_news_portal_homepage_sections
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 200
  `) as HomepageSectionRow[];

  return rows.map(toView);
}

export async function updateHomepageSection(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateHomepageSectionInput
): Promise<HomepageSectionView | null> {
  const rows = (await tx`
    UPDATE awcms_news_portal_homepage_sections
    SET title = CASE WHEN ${input.title === undefined} THEN title ELSE ${input.title ?? null} END,
        config_json = COALESCE(${input.config ?? null}, config_json),
        sort_order = COALESCE(${input.sortOrder ?? null}, sort_order),
        is_enabled = COALESCE(${input.isEnabled ?? null}, is_enabled),
        starts_at = CASE WHEN ${input.startsAt === undefined} THEN starts_at ELSE ${input.startsAt ?? null} END,
        ends_at = CASE WHEN ${input.endsAt === undefined} THEN ends_at ELSE ${input.endsAt ?? null} END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, section_key, section_type, title, config_json,
      sort_order, is_enabled, starts_at, ends_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason
  `) as HomepageSectionRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteHomepageSection(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_news_portal_homepage_sections
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/**
 * Public-safe query for `/news` rendering — enabled, non-deleted, and
 * within its schedule window (`starts_at`/`ends_at`, both optional bounds)
 * as of `now`, ordered for display. Callers still MUST resolve/validate
 * every reference in `config` (post ids, category slugs, media object ids)
 * at render time via `homepage-section-rendering.ts` — a section existing
 * and being "active" does not by itself mean everything it references is
 * still public/verified (e.g. a curated post could have been unpublished
 * since the section was configured).
 */
export async function listActiveHomepageSectionsForRendering(
  tx: Bun.SQL,
  tenantId: string,
  now: Date = new Date()
): Promise<HomepageSectionView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, section_key, section_type, title, config_json,
      sort_order, is_enabled, starts_at, ends_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason
    FROM awcms_news_portal_homepage_sections
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND is_enabled = true
      AND (starts_at IS NULL OR starts_at <= ${now})
      AND (ends_at IS NULL OR ends_at > ${now})
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 50
  `) as HomepageSectionRow[];

  return rows.map(toView);
}
