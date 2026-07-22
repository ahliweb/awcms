import type { TemplateLayout } from "../domain/template-policy";
import type {
  CreateTemplateInput,
  UpdateTemplateInput
} from "../domain/template-policy";

/** Read/write query module for `awcms_blog_templates` (Issue #542) — same "one directory, reads and writes" convention as `blog-taxonomy-directory.ts`. */
export type BlogTemplateView = {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  layoutJson: TemplateLayout;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type BlogTemplateRow = {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  layout_json: TemplateLayout;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toView(row: BlogTemplateRow): BlogTemplateView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    key: row.key,
    name: row.name,
    layoutJson: row.layout_json,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

export async function createTemplate(
  tx: Bun.SQL,
  tenantId: string,
  input: CreateTemplateInput
): Promise<BlogTemplateView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_templates
      (tenant_id, key, name, layout_json, is_active)
    VALUES (${tenantId}, ${input.key}, ${input.name}, ${input.layoutJson}, ${input.isActive})
    RETURNING id, tenant_id, key, name, layout_json, is_active,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogTemplateRow[];

  return toView(rows[0]!);
}

export async function fetchTemplateById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<BlogTemplateView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, key, name, layout_json, is_active,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_templates
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as BlogTemplateRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

/** `LIMIT 100`, name ascending — templates are low-cardinality config, same bounded-list convention as terms. */
export async function listTemplates(
  tx: Bun.SQL,
  tenantId: string
): Promise<BlogTemplateView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, key, name, layout_json, is_active,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_templates
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY name ASC
    LIMIT 100
  `) as BlogTemplateRow[];

  return rows.map(toView);
}

export async function updateTemplate(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateTemplateInput
): Promise<BlogTemplateView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_templates
    SET name = COALESCE(${input.name ?? null}, name),
        layout_json = COALESCE(${input.layoutJson ?? null}, layout_json),
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, key, name, layout_json, is_active,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogTemplateRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteTemplate(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_templates
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}
