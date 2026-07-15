import { recordAuditEvent } from "../../logging/application/audit-log";
import type {
  CreateOfficeInput,
  UpdateOfficeInput
} from "../domain/office-validation";

const AUDIT_MODULE_KEY = "tenant_admin";
const AUDIT_RESOURCE_TYPE = "office";

export type OfficeRecord = {
  id: string;
  officeCode: string;
  officeName: string;
  officeType: string;
  parentOfficeId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type OfficeRow = {
  id: string;
  office_code: string;
  office_name: string;
  office_type: string;
  parent_office_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: OfficeRow): OfficeRecord {
  return {
    id: row.id,
    officeCode: row.office_code,
    officeName: row.office_name,
    officeType: row.office_type,
    parentOfficeId: row.parent_office_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listOffices(
  tx: Bun.SQL,
  tenantId: string
): Promise<OfficeRecord[]> {
  const rows = (await tx`
    SELECT id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
    FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY created_at ASC
  `) as OfficeRow[];

  return rows.map(toRecord);
}

export async function fetchOfficeById(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string
): Promise<OfficeRecord | null> {
  const rows = (await tx`
    SELECT id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
    FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
  `) as OfficeRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

export async function createOffice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateOfficeInput,
  correlationId?: string
): Promise<OfficeRecord> {
  const rows = (await tx`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name, office_type, parent_office_id, created_by, updated_by)
    VALUES (
      ${tenantId}, ${input.officeCode}, ${input.officeName}, ${input.officeType},
      ${input.parentOfficeId}, ${actorTenantUserId}, ${actorTenantUserId}
    )
    RETURNING id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
  `) as OfficeRow[];

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "create",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: record.id,
    message: `Office created: ${record.officeCode}.`,
    attributes: { officeType: record.officeType },
    correlationId
  });

  return record;
}

export async function updateOffice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  officeId: string,
  input: UpdateOfficeInput,
  correlationId?: string
): Promise<OfficeRecord | null> {
  const existing = await fetchOfficeById(tx, tenantId, officeId);
  if (!existing) return null;

  const rows = (await tx`
    UPDATE awcms_offices
    SET
      office_name = ${input.officeName ?? existing.officeName},
      office_type = ${input.officeType ?? existing.officeType},
      status = ${input.status ?? existing.status},
      updated_by = ${actorTenantUserId},
      updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
    RETURNING id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
  `) as OfficeRow[];

  if (rows.length === 0) return null;

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "update",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: record.id,
    message: "Office updated.",
    attributes: { fields: Object.keys(input) },
    correlationId
  });

  return record;
}
