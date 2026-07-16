import type {
  CreateEmailTemplateInput,
  UpdateEmailTemplateInput
} from "../domain/email-template-validation";
import type { DefaultEmailTemplate } from "../domain/email-default-templates";
import type { EmailTemplateSource } from "../domain/email-template-render";

export type EmailTemplateView = {
  id: string;
  tenantId: string;
  templateKey: string;
  name: string;
  subjectTemplate: Record<string, string>;
  textBodyTemplate: Record<string, string> | null;
  htmlBodyTemplate: Record<string, string> | null;
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  restoredAt: string | null;
  restoredBy: string | null;
};

type EmailTemplateRow = {
  id: string;
  tenant_id: string;
  template_key: string;
  name: string;
  subject_template: Record<string, string>;
  text_body_template: Record<string, string> | null;
  html_body_template: Record<string, string> | null;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  restored_at: string | null;
  restored_by: string | null;
};

function toView(row: EmailTemplateRow): EmailTemplateView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    templateKey: row.template_key,
    name: row.name,
    subjectTemplate: row.subject_template,
    textBodyTemplate: row.text_body_template,
    htmlBodyTemplate: row.html_body_template,
    isActive: row.is_active,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason,
    restoredAt: row.restored_at,
    restoredBy: row.restored_by
  };
}

export async function createEmailTemplate(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateEmailTemplateInput
): Promise<EmailTemplateView> {
  const rows = (await tx`
    INSERT INTO awcms_email_templates
      (tenant_id, template_key, name, subject_template, text_body_template,
       html_body_template, is_active, created_by, updated_by)
    VALUES (
      ${tenantId}, ${input.templateKey}, ${input.name}, ${input.subjectTemplate},
      ${input.textBodyTemplate ?? null}, ${input.htmlBodyTemplate ?? null},
      ${input.isActive ?? true}, ${actorTenantUserId}, ${actorTenantUserId}
    )
    RETURNING id, tenant_id, template_key, name, subject_template, text_body_template,
      html_body_template, is_active, created_by, updated_by, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as EmailTemplateRow[];

  return toView(rows[0]!);
}

/** Only non-deleted rows are readable — matches the base soft-delete convention. */
export async function fetchActiveEmailTemplate(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<EmailTemplateView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, template_key, name, subject_template, text_body_template,
      html_body_template, is_active, created_by, updated_by, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
    FROM awcms_email_templates
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as EmailTemplateRow[];

  return rows[0] ? toView(rows[0]) : null;
}

/** Used by the dispatcher (Issue #495) to resolve a message's `template_key` at send time — active, non-deleted templates only. Returns the raw locale-map shape `email-template-render.ts` expects, not the full view. */
export async function fetchActiveEmailTemplateByKey(
  tx: Bun.SQL,
  tenantId: string,
  templateKey: string
): Promise<EmailTemplateSource | null> {
  const rows = (await tx`
    SELECT subject_template, text_body_template, html_body_template
    FROM awcms_email_templates
    WHERE tenant_id = ${tenantId} AND template_key = ${templateKey}
      AND is_active = true AND deleted_at IS NULL
  `) as {
    subject_template: Record<string, string>;
    text_body_template: Record<string, string> | null;
    html_body_template: Record<string, string> | null;
  }[];

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    subjectTemplate: row.subject_template,
    textBodyTemplate: row.text_body_template,
    htmlBodyTemplate: row.html_body_template
  };
}

export type ListEmailTemplatesFilter = {
  includeInactive?: boolean;
};

/** `LIMIT 100`, newest first — templates are low-cardinality config, same bounded-list convention as `form_drafts`/`sync_storage` (no pagination cursor needed). */
export async function listEmailTemplates(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListEmailTemplatesFilter = {}
): Promise<EmailTemplateView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, template_key, name, subject_template, text_body_template,
      html_body_template, is_active, created_by, updated_by, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
    FROM awcms_email_templates
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${filter.includeInactive ?? false} OR is_active = true)
    ORDER BY updated_at DESC
    LIMIT 100
  `) as EmailTemplateRow[];

  return rows.map(toView);
}

export async function updateEmailTemplate(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  input: UpdateEmailTemplateInput
): Promise<EmailTemplateView | null> {
  const rows = (await tx`
    UPDATE awcms_email_templates
    SET name = COALESCE(${input.name ?? null}, name),
        subject_template = COALESCE(${input.subjectTemplate ?? null}, subject_template),
        text_body_template = CASE
          WHEN ${input.textBodyTemplate === undefined} THEN text_body_template
          ELSE ${input.textBodyTemplate ?? null}
        END,
        html_body_template = CASE
          WHEN ${input.htmlBodyTemplate === undefined} THEN html_body_template
          ELSE ${input.htmlBodyTemplate ?? null}
        END,
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        updated_by = ${actorTenantUserId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, template_key, name, subject_template, text_body_template,
      html_body_template, is_active, created_by, updated_by, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as EmailTemplateRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteEmailTemplate(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_email_templates
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/** `null` if the template doesn't exist or isn't currently soft-deleted (nothing to restore). */
export async function restoreEmailTemplate(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string
): Promise<EmailTemplateView | null> {
  const rows = (await tx`
    UPDATE awcms_email_templates
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
    RETURNING id, tenant_id, template_key, name, subject_template, text_body_template,
      html_body_template, is_active, created_by, updated_by, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as EmailTemplateRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type SeedDefaultEmailTemplatesResult = {
  created: number;
  skipped: number;
};

/**
 * Inserts `DEFAULT_EMAIL_TEMPLATES` for one tenant, skipping any
 * `template_key` that already has an active (non-deleted) row — never
 * overwrites a tenant's customized copy. Not run automatically by any
 * migration (a tenant doesn't exist yet at migration time); called
 * explicitly, e.g. `bun run email:templates:seed-defaults --tenant=<id>`.
 */
export async function seedDefaultEmailTemplates(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  templates: readonly DefaultEmailTemplate[]
): Promise<SeedDefaultEmailTemplatesResult> {
  let created = 0;
  let skipped = 0;

  for (const template of templates) {
    const rows = await tx`
      INSERT INTO awcms_email_templates
        (tenant_id, template_key, name, subject_template, text_body_template, created_by, updated_by)
      VALUES (
        ${tenantId}, ${template.templateKey}, ${template.name}, ${template.subjectTemplate},
        ${template.textBodyTemplate}, ${actorTenantUserId}, ${actorTenantUserId}
      )
      ON CONFLICT (tenant_id, template_key) WHERE deleted_at IS NULL DO NOTHING
      RETURNING id
    `;

    if (rows.length > 0) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  return { created, skipped };
}
