/**
 * Service offerings for the booking ADMIN surface (Issue #1030, prerequisite of
 * #942; docs/awcms/booking.md sections 4 and 6). An offering holds no price and
 * no product id (section 10.2): it is a duration with buffers, or a night range,
 * and a party range.
 *
 * `code` and `granularity` are fixed at creation. Every other field can be
 * edited, and the merged row is validated against the shape the database
 * CHECK holds (a time offering has duration, buffers and a step; a stay offering
 * has night bounds; neither has the other's fields). Editing or deleting an
 * offering changes FUTURE bookings only: a reservation item keeps the snapshot
 * it was made with, which is why delete needs no in-use guard here.
 */
import {
  decodeKeysetCursor,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { BOOKING_AUDIT_EVENTS } from "../domain/booking-audit";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import {
  validateOfferingShape,
  type CreateOfferingInput,
  type OfferingFields,
  type OfferingPatchInput
} from "../domain/booking-admin-validation";
import {
  cursorParts,
  guarded,
  refuse,
  toPage,
  ADMIN_PAGE_SIZE,
  type AdminActor,
  type AdminRefusal,
  type DeletedFilter,
  type Sql
} from "./booking-admin-support";

export type OfferingDto = OfferingFields & {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type OfferingRow = {
  id: string;
  code: string;
  name: string;
  granularity: "time" | "stay";
  duration_seconds: number | null;
  setup_seconds: number | null;
  cleanup_seconds: number | null;
  slot_step_seconds: number | null;
  min_nights: number | null;
  max_nights: number | null;
  min_party: number;
  max_party: number;
  confirmation_mode: "immediate" | "hold_then_confirm";
  cancellation_cutoff_seconds: number | null;
  min_lead_seconds: number | null;
  max_horizon_days: number | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const OFFERING_COLUMNS = `
  o.id, o.code, o.name, o.granularity, o.duration_seconds, o.setup_seconds,
  o.cleanup_seconds, o.slot_step_seconds, o.min_nights, o.max_nights,
  o.min_party, o.max_party, o.confirmation_mode, o.cancellation_cutoff_seconds,
  o.min_lead_seconds, o.max_horizon_days, o.status,
  ${utcMicrosecondTextSql("o.created_at")} AS created_at,
  ${utcMicrosecondTextSql("o.updated_at")} AS updated_at,
  ${utcMicrosecondTextSql("o.deleted_at")} AS deleted_at`;

function toOffering(row: OfferingRow): OfferingDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    granularity: row.granularity,
    durationSeconds: row.duration_seconds,
    setupSeconds: row.setup_seconds,
    cleanupSeconds: row.cleanup_seconds,
    slotStepSeconds: row.slot_step_seconds,
    minNights: row.min_nights,
    maxNights: row.max_nights,
    minParty: row.min_party,
    maxParty: row.max_party,
    confirmationMode: row.confirmation_mode,
    cancellationCutoffSeconds: row.cancellation_cutoff_seconds,
    minLeadSeconds: row.min_lead_seconds,
    maxHorizonDays: row.max_horizon_days,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

export type OfferingListFilters = {
  granularity?: "time" | "stay";
  status?: "active" | "inactive";
  deleted: DeletedFilter;
};

export async function listOfferings(
  tx: Sql,
  tenantId: string,
  filters: OfferingListFilters,
  cursor?: KeysetCursor
): Promise<{ offerings: OfferingDto[]; nextCursor: string | null }> {
  const { createdAt, id } = cursorParts(cursor);
  const rows = (await tx`
    SELECT ${tx.unsafe(OFFERING_COLUMNS)}
    FROM awcms_booking_service_offerings o
    WHERE o.tenant_id = ${tenantId}
      AND (${filters.granularity ?? null}::text IS NULL OR o.granularity = ${filters.granularity ?? null})
      AND (${filters.status ?? null}::text IS NULL OR o.status = ${filters.status ?? null})
      AND (${filters.deleted}::text = 'include'
           OR (${filters.deleted}::text = 'exclude' AND o.deleted_at IS NULL)
           OR (${filters.deleted}::text = 'only' AND o.deleted_at IS NOT NULL))
      AND (
        ${createdAt}::timestamptz IS NULL
        OR (o.created_at, o.id) < (${createdAt}::timestamptz, ${id}::uuid)
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ${ADMIN_PAGE_SIZE}
  `) as OfferingRow[];
  const page = toPage(rows, toOffering);

  return { offerings: page.items, nextCursor: page.nextCursor };
}

export async function getOffering(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<OfferingDto | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(OFFERING_COLUMNS)}
    FROM awcms_booking_service_offerings o
    WHERE o.tenant_id = ${tenantId} AND o.id = ${id}
  `) as OfferingRow[];

  return rows[0] ? toOffering(rows[0]) : null;
}

export type OfferingWrite =
  { outcome: "ok"; offering: OfferingDto; replayed: boolean } | AdminRefusal;

export function offeringNotFound(): AdminRefusal {
  return refuse(404, "OFFERING_NOT_FOUND", "Offering not found.");
}

export async function createOffering(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  input: CreateOfferingInput
): Promise<OfferingWrite> {
  const result = await guarded(
    tx,
    "awcms_booking_offering_create",
    async () => {
      const rows = (await tx`
      INSERT INTO awcms_booking_service_offerings
        (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
         cleanup_seconds, slot_step_seconds, min_nights, max_nights, min_party,
         max_party, confirmation_mode, cancellation_cutoff_seconds,
         min_lead_seconds, max_horizon_days, status, created_by, updated_by)
      VALUES (
        ${tenantId}, ${input.code}, ${input.name}, ${input.granularity},
        ${input.durationSeconds}, ${input.setupSeconds}, ${input.cleanupSeconds},
        ${input.slotStepSeconds}, ${input.minNights}, ${input.maxNights},
        ${input.minParty}, ${input.maxParty}, ${input.confirmationMode},
        ${input.cancellationCutoffSeconds}, ${input.minLeadSeconds},
        ${input.maxHorizonDays}, ${input.status},
        ${actor.actorTenantUserId}, ${actor.actorTenantUserId}
      )
      RETURNING id
    `) as { id: string }[];

      return rows[0]!.id;
    }
  );

  if (!result.ok) {
    return result.refusal;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.offeringCreated.action,
    resourceType: "booking_offering",
    resourceId: result.value,
    severity: BOOKING_AUDIT_EVENTS.offeringCreated.severity,
    message: "Booking offering created.",
    attributes: { code: input.code, granularity: input.granularity },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    offering: (await getOffering(tx, tenantId, result.value))!,
    replayed: false
  };
}

async function lockOffering(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<(OfferingRow & { deleted_at: string | null }) | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(OFFERING_COLUMNS)}
    FROM awcms_booking_service_offerings o
    WHERE o.tenant_id = ${tenantId} AND o.id = ${id}
    FOR UPDATE OF o
  `) as OfferingRow[];

  return rows[0] ?? null;
}

export async function patchOffering(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string,
  patch: OfferingPatchInput,
  canSeeDeleted: () => Promise<boolean>
): Promise<OfferingWrite> {
  const row = await lockOffering(tx, tenantId, id);

  if (!row) {
    return offeringNotFound();
  }

  if (row.deleted_at !== null) {
    // A deleted row is invisible without `.restore` (booking.md section 6).
    if (!(await canSeeDeleted())) {
      return offeringNotFound();
    }

    return refuse(
      409,
      "OFFERING_DELETED",
      "A deleted offering cannot be edited; restore it first."
    );
  }

  const current = toOffering(row);
  const merged: OfferingDto = {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    )
  };
  const shape = validateOfferingShape(merged);

  if (shape.length > 0) {
    return refuse(400, "VALIDATION_ERROR", "Request is invalid.", shape);
  }

  const result = await guarded(tx, "awcms_booking_offering_patch", async () => {
    await tx`
      UPDATE awcms_booking_service_offerings
      SET name = ${merged.name}, duration_seconds = ${merged.durationSeconds},
          setup_seconds = ${merged.setupSeconds},
          cleanup_seconds = ${merged.cleanupSeconds},
          slot_step_seconds = ${merged.slotStepSeconds},
          min_nights = ${merged.minNights}, max_nights = ${merged.maxNights},
          min_party = ${merged.minParty}, max_party = ${merged.maxParty},
          confirmation_mode = ${merged.confirmationMode},
          cancellation_cutoff_seconds = ${merged.cancellationCutoffSeconds},
          min_lead_seconds = ${merged.minLeadSeconds},
          max_horizon_days = ${merged.maxHorizonDays}, status = ${merged.status},
          updated_at = now(), updated_by = ${actor.actorTenantUserId}
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `;
  });

  if (!result.ok) {
    return result.refusal;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.offeringUpdated.action,
    resourceType: "booking_offering",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.offeringUpdated.severity,
    message: "Booking offering updated.",
    attributes: { code: current.code, changed: Object.keys(patch) },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    offering: (await getOffering(tx, tenantId, id))!,
    replayed: false
  };
}

export async function deleteOffering(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string,
  canSeeDeleted: () => Promise<boolean>
): Promise<OfferingWrite> {
  const row = await lockOffering(tx, tenantId, id);

  if (!row) {
    return offeringNotFound();
  }

  if (row.deleted_at !== null) {
    if (!(await canSeeDeleted())) {
      return offeringNotFound();
    }

    return { outcome: "ok", offering: toOffering(row), replayed: true };
  }

  await tx`
    UPDATE awcms_booking_service_offerings
    SET deleted_at = now(), deleted_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.offeringDeleted.action,
    resourceType: "booking_offering",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.offeringDeleted.severity,
    message: "Booking offering soft-deleted.",
    attributes: { code: row.code },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    offering: (await getOffering(tx, tenantId, id))!,
    replayed: false
  };
}

export async function restoreOffering(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string
): Promise<OfferingWrite> {
  const row = await lockOffering(tx, tenantId, id);

  if (!row) {
    return offeringNotFound();
  }

  if (row.deleted_at === null) {
    return { outcome: "ok", offering: toOffering(row), replayed: true };
  }

  await tx`
    UPDATE awcms_booking_service_offerings
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.offeringRestored.action,
    resourceType: "booking_offering",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.offeringRestored.severity,
    message: "Booking offering restored.",
    attributes: { code: row.code },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    offering: (await getOffering(tx, tenantId, id))!,
    replayed: false
  };
}

/** Every offering matching the filters, page after page (bounded at 50 pages), for a list that must not silently stop at one page. */
export async function listAllOfferings(
  tx: Sql,
  tenantId: string,
  filters: OfferingListFilters
): Promise<OfferingDto[]> {
  const all: OfferingDto[] = [];
  let cursor: KeysetCursor | undefined;

  for (let page = 0; page < 50; page += 1) {
    const result = await listOfferings(tx, tenantId, filters, cursor);

    all.push(...result.offerings);

    const next = result.nextCursor
      ? decodeKeysetCursor(result.nextCursor)
      : null;

    if (!next) break;

    cursor = next;
  }

  return all;
}
