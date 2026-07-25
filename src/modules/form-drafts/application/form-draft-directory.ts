import type {
  CreateFormDraftInput,
  UpdateFormDraftInput
} from "../domain/form-draft-validation";

export type FormDraftView = {
  id: string;
  tenantId: string;
  moduleKey: string;
  wizardKey: string;
  resourceType: string;
  resourceId: string | null;
  currentStep: string;
  payload: Record<string, unknown>;
  status: "draft" | "submitted" | "abandoned" | "expired";
  createdBy: string;
  updatedBy: string;
  submittedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
};

type FormDraftRow = {
  id: string;
  tenant_id: string;
  module_key: string;
  wizard_key: string;
  resource_type: string;
  resource_id: string | null;
  current_step: string;
  payload: Record<string, unknown>;
  status: "draft" | "submitted" | "abandoned" | "expired";
  created_by: string;
  updated_by: string;
  submitted_by: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
};

function toView(row: FormDraftRow): FormDraftView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    moduleKey: row.module_key,
    wizardKey: row.wizard_key,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    currentStep: row.current_step,
    payload: row.payload,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    submittedBy: row.submitted_by,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at
  };
}

export async function createFormDraft(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateFormDraftInput
): Promise<FormDraftView> {
  const rows = (await tx`
    INSERT INTO awcms_form_drafts
      (tenant_id, module_key, wizard_key, resource_type, resource_id,
       current_step, payload, created_by, updated_by, expires_at)
    VALUES (
      ${tenantId}, ${input.moduleKey}, ${input.wizardKey}, ${input.resourceType},
      ${input.resourceId ?? null}, ${input.currentStep}, ${input.payload},
      ${actorTenantUserId}, ${actorTenantUserId}, ${input.expiresAt ?? null}
    )
    RETURNING id, tenant_id, module_key, wizard_key, resource_type, resource_id,
      current_step, payload, status, created_by, updated_by, submitted_by,
      expires_at, created_at, updated_at, submitted_at
  `) as FormDraftRow[];

  return toView(rows[0]!);
}

/** Only non-deleted rows are readable — a soft-deleted draft is gone from every read path, matching the base soft-delete convention (default filter `deleted_at IS NULL`). */
export async function fetchActiveFormDraft(
  tx: Bun.SQL,
  tenantId: string,
  draftId: string
): Promise<FormDraftView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, module_key, wizard_key, resource_type, resource_id,
      current_step, payload, status, created_by, updated_by, submitted_by,
      expires_at, created_at, updated_at, submitted_at
    FROM awcms_form_drafts
    WHERE tenant_id = ${tenantId} AND id = ${draftId} AND deleted_at IS NULL
  `) as FormDraftRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type ListFormDraftsFilter = {
  moduleKey?: string;
  wizardKey?: string;
  status?: "draft" | "submitted" | "abandoned" | "expired";
};

/** `LIMIT 100`, newest first — mirrors `workflows/tasks`'s bounded-list convention (no pagination cursor for a generic scratch-data table). */
export async function listFormDrafts(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListFormDraftsFilter = {}
): Promise<FormDraftView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, module_key, wizard_key, resource_type, resource_id,
      current_step, payload, status, created_by, updated_by, submitted_by,
      expires_at, created_at, updated_at, submitted_at
    FROM awcms_form_drafts
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${filter.moduleKey ?? null}::text IS NULL OR module_key = ${filter.moduleKey ?? null})
      AND (${filter.wizardKey ?? null}::text IS NULL OR wizard_key = ${filter.wizardKey ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY updated_at DESC
    LIMIT 100
  `) as FormDraftRow[];

  return rows.map(toView);
}

export async function updateFormDraft(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  draftId: string,
  input: UpdateFormDraftInput
): Promise<FormDraftView | null> {
  const existing = await fetchActiveFormDraft(tx, tenantId, draftId);

  if (!existing || existing.status !== "draft") {
    return null;
  }

  const rows = (await tx`
    UPDATE awcms_form_drafts
    SET current_step = COALESCE(${input.currentStep ?? null}, current_step),
        payload = COALESCE(${input.payload ?? null}, payload),
        expires_at = CASE
          WHEN ${input.expiresAt === undefined} THEN expires_at
          ELSE ${input.expiresAt ?? null}
        END,
        updated_by = ${actorTenantUserId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${draftId} AND deleted_at IS NULL
    RETURNING id, tenant_id, module_key, wizard_key, resource_type, resource_id,
      current_step, payload, status, created_by, updated_by, submitted_by,
      expires_at, created_at, updated_at, submitted_at
  `) as FormDraftRow[];

  return rows[0] ? toView(rows[0]) : null;
}

/** Transitions a `draft` to `submitted`. Returns `null` if the draft doesn't exist, is already deleted, or isn't in `draft` status (already submitted — the caller's idempotency check is expected to have already handled the replay case before reaching here). */
export async function submitFormDraft(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  draftId: string
): Promise<FormDraftView | null> {
  const rows = (await tx`
    UPDATE awcms_form_drafts
    SET status = 'submitted',
        submitted_by = ${actorTenantUserId},
        submitted_at = now(),
        updated_by = ${actorTenantUserId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${draftId}
      AND deleted_at IS NULL AND status = 'draft'
    RETURNING id, tenant_id, module_key, wizard_key, resource_type, resource_id,
      current_step, payload, status, created_by, updated_by, submitted_by,
      expires_at, created_at, updated_at, submitted_at
  `) as FormDraftRow[];

  return rows[0] ? toView(rows[0]) : null;
}

/** Soft-deletes ("abandons") a draft. Idempotent by construction — the `deleted_at IS NULL` guard means calling this twice is a safe no-op the second time, no `Idempotency-Key` needed. */
export async function deleteFormDraft(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  draftId: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_form_drafts
    SET deleted_at = now(),
        deleted_by = ${actorTenantUserId},
        delete_reason = ${reason},
        status = CASE WHEN status = 'draft' THEN 'abandoned' ELSE status END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${draftId} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}
