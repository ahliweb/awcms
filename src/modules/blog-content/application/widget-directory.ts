import type { WidgetPosition } from "../domain/widget-policy";
import type {
  CreateWidgetInput,
  UpdateWidgetInput
} from "../domain/widget-policy";

/** Read/write query module for `awcms_blog_widgets` (Issue #542) — same "one directory, reads and writes" convention as `blog-taxonomy-directory.ts`. */
export type BlogWidgetView = {
  id: string;
  tenantId: string;
  position: WidgetPosition;
  title: string;
  bodyText: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type BlogWidgetRow = {
  id: string;
  tenant_id: string;
  position: WidgetPosition;
  title: string;
  body_text: string;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toView(row: BlogWidgetRow): BlogWidgetView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    position: row.position,
    title: row.title,
    bodyText: row.body_text,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

export async function createWidget(
  tx: Bun.SQL,
  tenantId: string,
  input: CreateWidgetInput
): Promise<BlogWidgetView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_widgets
      (tenant_id, position, title, body_text, is_active, sort_order)
    VALUES (
      ${tenantId}, ${input.position}, ${input.title}, ${input.bodyText},
      ${input.isActive}, ${input.sortOrder}
    )
    RETURNING id, tenant_id, position, title, body_text, is_active, sort_order,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogWidgetRow[];

  return toView(rows[0]!);
}

export async function fetchWidgetById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<BlogWidgetView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, position, title, body_text, is_active, sort_order,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_widgets
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as BlogWidgetRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

export type ListWidgetsFilter = {
  position?: WidgetPosition;
  activeOnly?: boolean;
};

/** `?position=` optional filter; `activeOnly` used by public rendering to only ever surface `is_active = true` widgets. Sorted by `sort_order` — placement order within a position matters for rendering. */
export async function listWidgets(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListWidgetsFilter = {}
): Promise<BlogWidgetView[]> {
  const rows = (
    filter.activeOnly
      ? await tx`
        SELECT id, tenant_id, position, title, body_text, is_active, sort_order,
          created_at, updated_at, deleted_at, deleted_by, delete_reason
        FROM awcms_blog_widgets
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND is_active = true
          AND (${filter.position ?? null}::text IS NULL OR position = ${filter.position ?? null})
        ORDER BY position ASC, sort_order ASC
        LIMIT 100
      `
      : await tx`
        SELECT id, tenant_id, position, title, body_text, is_active, sort_order,
          created_at, updated_at, deleted_at, deleted_by, delete_reason
        FROM awcms_blog_widgets
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
          AND (${filter.position ?? null}::text IS NULL OR position = ${filter.position ?? null})
        ORDER BY position ASC, sort_order ASC
        LIMIT 100
      `
  ) as BlogWidgetRow[];

  return rows.map(toView);
}

export async function updateWidget(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateWidgetInput
): Promise<BlogWidgetView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_widgets
    SET position = COALESCE(${input.position ?? null}, position),
        title = COALESCE(${input.title ?? null}, title),
        body_text = COALESCE(${input.bodyText ?? null}, body_text),
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        sort_order = COALESCE(${input.sortOrder ?? null}, sort_order),
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, position, title, body_text, is_active, sort_order,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogWidgetRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteWidget(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_widgets
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}
