/**
 * Resources, their capacity units and resource pools, for the booking ADMIN
 * surface (Issue #1030, prerequisite of #942; docs/awcms/booking.md sections 4
 * and 6). Tenant-scoped under RLS FORCE; every query also names `tenant_id`.
 *
 * ## What the database already holds, and what this adds
 *
 * The database refuses a `booking_mode` change while the resource has live
 * allocations or active blocks (`BOOKING_MODE_IN_USE`), a timezone change while
 * it has them or an active schedule (`TIMEZONE_IN_USE`,
 * `SCHEDULE_TIMEZONE_MISMATCH`), an unknown zone, a duplicate code and a
 * malformed row. Those refusals reach the caller as 409/400/422 through
 * {@link guarded}; the pure validator states the same shape rules first so the
 * common mistake is a 400 with a field name.
 *
 * ## Units are never removed
 *
 * A unit is the anchor of the exclusion constraints and `awcms_app` is denied
 * DELETE on it, so capacity can GROW (new units, which a resource-wide block
 * covers through the `sql/240` trigger) and a unit can be DEACTIVATED or
 * relabelled, but capacity never shrinks (`409 CAPACITY_REDUCTION_NOT_ALLOWED`).
 *
 * ## Delete is soft, and refused while the resource is in use
 *
 * A resource with a held, confirmed or checked-in reservation, or an active
 * block, is `409 RESOURCE_IN_USE`: deleting it would leave a promise nobody can
 * serve. Take it out of sale with `status: "inactive"` instead. A pool with a
 * live member is `409 POOL_NOT_EMPTY`. Repeating a delete or a restore is a
 * replay (`replayed: true`), writing nothing.
 *
 * Audit rows record ids, codes and the NAMES of changed fields, never a label.
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
  validateResourceShape,
  type CreatePoolInput,
  type CreateResourceInput,
  type PoolPatchInput,
  type ResourcePatchInput
} from "../domain/booking-admin-validation";
import {
  cursorParts,
  guarded,
  refuse,
  RefusalSignal,
  toPage,
  ADMIN_PAGE_SIZE,
  type AdminActor,
  type AdminRefusal,
  type DeletedFilter,
  type Sql
} from "./booking-admin-support";

export type UnitDto = {
  id: string;
  ordinal: number;
  label: string | null;
  status: "active" | "inactive";
};

export type ResourceDto = {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: "active" | "inactive";
  capacity: number;
  activeUnits: number;
  poolId: string | null;
  timezone: string;
  bookingMode: "slot" | "stay";
  stayCheckInTime: string | null;
  stayCheckOutTime: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Present on a read of one resource, absent in a list. */
  units?: UnitDto[];
};

export type PoolDto = {
  id: string;
  code: string;
  name: string;
  allocationPolicy: "first_free";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Present on a read of one pool: its live members. */
  members?: { id: string; code: string; name: string; status: string }[];
};

type ResourceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: "active" | "inactive";
  capacity: number;
  active_units: number;
  pool_id: string | null;
  timezone: string;
  booking_mode: "slot" | "stay";
  stay_check_in_time: string | null;
  stay_check_out_time: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type PoolRow = {
  id: string;
  code: string;
  name: string;
  allocation_policy: "first_free";
  member_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const RESOURCE_COLUMNS = `
  r.id, r.code, r.name, r.kind, r.status, r.capacity, r.pool_id, r.timezone,
  r.booking_mode, r.sort_order,
  to_char(r.stay_check_in_time, 'HH24:MI:SS') AS stay_check_in_time,
  to_char(r.stay_check_out_time, 'HH24:MI:SS') AS stay_check_out_time,
  (SELECT count(*)::int FROM awcms_booking_resource_units u
    WHERE u.tenant_id = r.tenant_id AND u.resource_id = r.id
      AND u.status = 'active') AS active_units,
  ${utcMicrosecondTextSql("r.created_at")} AS created_at,
  ${utcMicrosecondTextSql("r.updated_at")} AS updated_at,
  ${utcMicrosecondTextSql("r.deleted_at")} AS deleted_at`;

const POOL_COLUMNS = `
  p.id, p.code, p.name, p.allocation_policy,
  (SELECT count(*)::int FROM awcms_booking_resources r
    WHERE r.tenant_id = p.tenant_id AND r.pool_id = p.id
      AND r.deleted_at IS NULL) AS member_count,
  ${utcMicrosecondTextSql("p.created_at")} AS created_at,
  ${utcMicrosecondTextSql("p.updated_at")} AS updated_at,
  ${utcMicrosecondTextSql("p.deleted_at")} AS deleted_at`;

function toResource(row: ResourceRow): ResourceDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    status: row.status,
    capacity: row.capacity,
    activeUnits: row.active_units,
    poolId: row.pool_id,
    timezone: row.timezone,
    bookingMode: row.booking_mode,
    stayCheckInTime: row.stay_check_in_time,
    stayCheckOutTime: row.stay_check_out_time,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function toPool(row: PoolRow): PoolDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    allocationPolicy: row.allocation_policy,
    memberCount: row.member_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

// -- Reads ---------------------------------------------------------------------

export type ResourceListFilters = {
  status?: "active" | "inactive";
  bookingMode?: "slot" | "stay";
  poolId?: string;
  deleted: DeletedFilter;
};

export async function listResources(
  tx: Sql,
  tenantId: string,
  filters: ResourceListFilters,
  cursor?: KeysetCursor
): Promise<{ resources: ResourceDto[]; nextCursor: string | null }> {
  const { createdAt, id } = cursorParts(cursor);
  const rows = (await tx`
    SELECT ${tx.unsafe(RESOURCE_COLUMNS)}
    FROM awcms_booking_resources r
    WHERE r.tenant_id = ${tenantId}
      AND (${filters.status ?? null}::text IS NULL OR r.status = ${filters.status ?? null})
      AND (${filters.bookingMode ?? null}::text IS NULL OR r.booking_mode = ${filters.bookingMode ?? null})
      AND (${filters.poolId ?? null}::uuid IS NULL OR r.pool_id = ${filters.poolId ?? null}::uuid)
      AND (${filters.deleted}::text = 'include'
           OR (${filters.deleted}::text = 'exclude' AND r.deleted_at IS NULL)
           OR (${filters.deleted}::text = 'only' AND r.deleted_at IS NOT NULL))
      AND (
        ${createdAt}::timestamptz IS NULL
        OR (r.created_at, r.id) < (${createdAt}::timestamptz, ${id}::uuid)
      )
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${ADMIN_PAGE_SIZE}
  `) as ResourceRow[];
  const page = toPage(rows, toResource);

  return { resources: page.items, nextCursor: page.nextCursor };
}

export async function listUnits(
  tx: Sql,
  tenantId: string,
  resourceId: string
): Promise<UnitDto[]> {
  const rows = (await tx`
    SELECT id, ordinal, label, status
    FROM awcms_booking_resource_units
    WHERE tenant_id = ${tenantId} AND resource_id = ${resourceId}
    ORDER BY ordinal
  `) as UnitDto[];

  return rows.map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    label: row.label,
    status: row.status
  }));
}

/** One resource with its units, a soft-deleted one included (so it can be restored); `null` when absent or another tenant's. */
export async function getResource(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<ResourceDto | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(RESOURCE_COLUMNS)}
    FROM awcms_booking_resources r
    WHERE r.tenant_id = ${tenantId} AND r.id = ${id}
  `) as ResourceRow[];

  if (!rows[0]) {
    return null;
  }

  return { ...toResource(rows[0]), units: await listUnits(tx, tenantId, id) };
}

export async function listPools(
  tx: Sql,
  tenantId: string,
  filters: { deleted: DeletedFilter },
  cursor?: KeysetCursor
): Promise<{ pools: PoolDto[]; nextCursor: string | null }> {
  const { createdAt, id } = cursorParts(cursor);
  const rows = (await tx`
    SELECT ${tx.unsafe(POOL_COLUMNS)}
    FROM awcms_booking_resource_pools p
    WHERE p.tenant_id = ${tenantId}
      AND (${filters.deleted}::text = 'include'
           OR (${filters.deleted}::text = 'exclude' AND p.deleted_at IS NULL)
           OR (${filters.deleted}::text = 'only' AND p.deleted_at IS NOT NULL))
      AND (
        ${createdAt}::timestamptz IS NULL
        OR (p.created_at, p.id) < (${createdAt}::timestamptz, ${id}::uuid)
      )
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ${ADMIN_PAGE_SIZE}
  `) as PoolRow[];
  const page = toPage(rows, toPool);

  return { pools: page.items, nextCursor: page.nextCursor };
}

export async function getPool(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<PoolDto | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(POOL_COLUMNS)}
    FROM awcms_booking_resource_pools p
    WHERE p.tenant_id = ${tenantId} AND p.id = ${id}
  `) as PoolRow[];

  if (!rows[0]) {
    return null;
  }

  const members = (await tx`
    SELECT id, code, name, status
    FROM awcms_booking_resources
    WHERE tenant_id = ${tenantId} AND pool_id = ${id} AND deleted_at IS NULL
    ORDER BY sort_order, id
    LIMIT 500
  `) as { id: string; code: string; name: string; status: string }[];

  return { ...toPool(rows[0]), members };
}

// -- Writes --------------------------------------------------------------------

export function resourceNotFound(): AdminRefusal {
  return refuse(404, "RESOURCE_NOT_FOUND", "Resource not found.");
}

export function poolNotFound(): AdminRefusal {
  return refuse(404, "POOL_NOT_FOUND", "Resource pool not found.");
}

async function poolIsUsable(
  tx: Sql,
  tenantId: string,
  poolId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_booking_resource_pools
    WHERE tenant_id = ${tenantId} AND id = ${poolId} AND deleted_at IS NULL
    FOR SHARE
  `) as unknown[];

  return rows.length > 0;
}

export type ResourceWrite =
  { outcome: "ok"; resource: ResourceDto; replayed: boolean } | AdminRefusal;

export async function createResource(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  input: CreateResourceInput
): Promise<ResourceWrite> {
  if (input.poolId && !(await poolIsUsable(tx, tenantId, input.poolId))) {
    return poolNotFound();
  }

  const result = await guarded(
    tx,
    "awcms_booking_resource_create",
    async () => {
      const inserted = (await tx`
      INSERT INTO awcms_booking_resources
        (tenant_id, code, name, kind, status, capacity, pool_id, timezone,
         booking_mode, stay_check_in_time, stay_check_out_time, sort_order,
         created_by, updated_by)
      VALUES (
        ${tenantId}, ${input.code}, ${input.name}, ${input.kind}, ${input.status},
        ${input.capacity}, ${input.poolId}, ${input.timezone}, ${input.bookingMode},
        ${input.stayCheckInTime}::time, ${input.stayCheckOutTime}::time,
        ${input.sortOrder}, ${actor.actorTenantUserId}, ${actor.actorTenantUserId}
      )
      RETURNING id
    `) as { id: string }[];
      const resourceId = inserted[0]!.id;

      await tx`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal, label)
      SELECT ${tenantId}, ${resourceId}, g,
             (${input.unitLabels as unknown as object}::jsonb ->> (g - 1))
      FROM generate_series(1, ${input.capacity}::int) AS g
    `;

      return resourceId;
    }
  );

  if (!result.ok) {
    return result.refusal;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.resourceCreated.action,
    resourceType: "booking_resource",
    resourceId: result.value,
    severity: BOOKING_AUDIT_EVENTS.resourceCreated.severity,
    message: "Booking resource created.",
    attributes: {
      code: input.code,
      bookingMode: input.bookingMode,
      capacity: input.capacity,
      poolId: input.poolId
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    resource: (await getResource(tx, tenantId, result.value))!,
    replayed: false
  };
}

type LockedResource = {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: "active" | "inactive";
  capacity: number;
  pool_id: string | null;
  timezone: string;
  booking_mode: "slot" | "stay";
  stay_check_in_time: string | null;
  stay_check_out_time: string | null;
  sort_order: number;
  deleted_at: string | null;
};

async function lockResource(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<LockedResource | null> {
  const rows = (await tx`
    SELECT id, code, name, kind, status, capacity, pool_id, timezone,
           booking_mode,
           to_char(stay_check_in_time, 'HH24:MI:SS') AS stay_check_in_time,
           to_char(stay_check_out_time, 'HH24:MI:SS') AS stay_check_out_time,
           sort_order, deleted_at::text AS deleted_at
    FROM awcms_booking_resources
    WHERE tenant_id = ${tenantId} AND id = ${id}
    FOR NO KEY UPDATE
  `) as LockedResource[];

  return rows[0] ?? null;
}

export async function patchResource(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string,
  patch: ResourcePatchInput,
  canSeeDeleted: () => Promise<boolean>
): Promise<ResourceWrite> {
  const current = await lockResource(tx, tenantId, id);

  if (!current) {
    return resourceNotFound();
  }

  if (current.deleted_at !== null) {
    // A deleted row is invisible without `.restore` (booking.md section 6).
    if (!(await canSeeDeleted())) {
      return resourceNotFound();
    }

    return refuse(
      409,
      "RESOURCE_DELETED",
      "A deleted resource cannot be edited; restore it first."
    );
  }

  const next = {
    name: patch.name ?? current.name,
    kind: patch.kind ?? current.kind,
    status: patch.status ?? current.status,
    poolId: patch.poolId === undefined ? current.pool_id : patch.poolId,
    timezone: patch.timezone ?? current.timezone,
    bookingMode: patch.bookingMode ?? current.booking_mode,
    stayCheckInTime:
      patch.stayCheckInTime === undefined
        ? current.stay_check_in_time
        : patch.stayCheckInTime,
    stayCheckOutTime:
      patch.stayCheckOutTime === undefined
        ? current.stay_check_out_time
        : patch.stayCheckOutTime,
    sortOrder: patch.sortOrder ?? current.sort_order,
    capacity: patch.capacity ?? current.capacity
  };

  // Changing the mode to `slot` clears the stay times unless the caller says
  // otherwise, so "make it a slot resource" is one field, not three.
  if (
    patch.bookingMode === "slot" &&
    patch.stayCheckInTime === undefined &&
    patch.stayCheckOutTime === undefined
  ) {
    next.stayCheckInTime = null;
    next.stayCheckOutTime = null;
  }

  const shape = validateResourceShape(next);

  if (shape.length > 0) {
    return refuse(400, "VALIDATION_ERROR", "Request is invalid.", shape);
  }

  if (next.capacity < current.capacity) {
    return refuse(
      409,
      "CAPACITY_REDUCTION_NOT_ALLOWED",
      "Units are never removed; deactivate a unit instead of lowering capacity."
    );
  }

  if (
    next.poolId &&
    next.poolId !== current.pool_id &&
    !(await poolIsUsable(tx, tenantId, next.poolId))
  ) {
    return poolNotFound();
  }

  const result = await guarded(tx, "awcms_booking_resource_patch", async () => {
    await tx`
      UPDATE awcms_booking_resources
      SET name = ${next.name}, kind = ${next.kind}, status = ${next.status},
          pool_id = ${next.poolId}, timezone = ${next.timezone},
          booking_mode = ${next.bookingMode},
          stay_check_in_time = ${next.stayCheckInTime}::time,
          stay_check_out_time = ${next.stayCheckOutTime}::time,
          sort_order = ${next.sortOrder}, capacity = ${next.capacity},
          updated_at = now(), updated_by = ${actor.actorTenantUserId}
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `;

    if (next.capacity > current.capacity) {
      await tx`
        INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
        SELECT ${tenantId}, ${id}, g
        FROM generate_series(${current.capacity + 1}::int, ${next.capacity}::int) AS g
      `;
    }

    for (const unit of patch.units ?? []) {
      const labelGiven = unit.label !== undefined;
      const updated = (await tx`
        UPDATE awcms_booking_resource_units
        SET label = CASE WHEN ${labelGiven} THEN ${unit.label ?? null} ELSE label END,
            status = COALESCE(${unit.status ?? null}, status),
            updated_at = now()
        WHERE tenant_id = ${tenantId} AND resource_id = ${id} AND id = ${unit.id}
        RETURNING id
      `) as { id: string }[];

      if (updated.length === 0) {
        throw new RefusalSignal(
          refuse(404, "UNIT_NOT_FOUND", "Unit not found on this resource.")
        );
      }
    }
  });

  if (!result.ok) {
    return result.refusal;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.resourceUpdated.action,
    resourceType: "booking_resource",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.resourceUpdated.severity,
    message: "Booking resource updated.",
    attributes: {
      code: current.code,
      changed: Object.keys(patch),
      capacityBefore: current.capacity,
      capacityAfter: next.capacity,
      unitsChanged: patch.units?.length ?? 0
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    resource: (await getResource(tx, tenantId, id))!,
    replayed: false
  };
}

async function resourceInUse(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT (
      EXISTS (
        SELECT 1
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_reservation_items i
          ON i.tenant_id = a.tenant_id AND i.id = a.item_id
        JOIN awcms_booking_reservations r
          ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
        WHERE a.tenant_id = ${tenantId} AND a.resource_id = ${id}
          AND a.released_at IS NULL
          AND r.status IN ('held', 'confirmed', 'checked_in')
          -- A hold past its expiry (on the database clock) is about to be
          -- reclaimed and promises nothing, whether or not the sweep has run.
          AND (r.status <> 'held' OR r.hold_expires_at > clock_timestamp())
      )
      OR EXISTS (
        SELECT 1 FROM awcms_booking_resource_blocks
        WHERE tenant_id = ${tenantId} AND resource_id = ${id}
          AND status = 'active'
      )
    ) AS in_use
  `) as { in_use: boolean }[];

  return rows[0]?.in_use === true;
}

/** Soft-deletes a resource; a second delete is a replay. Refused while a reservation or block needs it. */
export async function deleteResource(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string,
  canSeeDeleted: () => Promise<boolean>
): Promise<ResourceWrite> {
  const current = await lockResource(tx, tenantId, id);

  if (!current) {
    return resourceNotFound();
  }

  if (current.deleted_at !== null) {
    if (!(await canSeeDeleted())) {
      return resourceNotFound();
    }

    return {
      outcome: "ok",
      resource: (await getResource(tx, tenantId, id))!,
      replayed: true
    };
  }

  if (await resourceInUse(tx, tenantId, id)) {
    return refuse(
      409,
      "RESOURCE_IN_USE",
      "The resource has a held, confirmed or checked-in reservation or an active block; cancel or release them, or set status to inactive."
    );
  }

  await tx`
    UPDATE awcms_booking_resources
    SET deleted_at = now(), deleted_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.resourceDeleted.action,
    resourceType: "booking_resource",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.resourceDeleted.severity,
    message: "Booking resource soft-deleted.",
    attributes: { code: current.code },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    resource: (await getResource(tx, tenantId, id))!,
    replayed: false
  };
}

export async function restoreResource(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string
): Promise<ResourceWrite> {
  const current = await lockResource(tx, tenantId, id);

  if (!current) {
    return resourceNotFound();
  }

  if (current.deleted_at === null) {
    return {
      outcome: "ok",
      resource: (await getResource(tx, tenantId, id))!,
      replayed: true
    };
  }

  if (current.pool_id !== null) {
    // Refuse rather than silently clear the membership; FOR SHARE so a pool
    // delete racing this restore waits for the verdict.
    const pool = (await tx`
      SELECT deleted_at IS NOT NULL AS deleted
      FROM awcms_booking_resource_pools
      WHERE tenant_id = ${tenantId} AND id = ${current.pool_id}
      FOR SHARE
    `) as { deleted: boolean }[];

    if (pool[0]?.deleted !== false) {
      return refuse(
        409,
        "POOL_DELETED",
        "The resource's pool is deleted; restore the pool first, or move the resource to another pool."
      );
    }
  }

  await tx`
    UPDATE awcms_booking_resources
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.resourceRestored.action,
    resourceType: "booking_resource",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.resourceRestored.severity,
    message: "Booking resource restored.",
    attributes: { code: current.code },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    resource: (await getResource(tx, tenantId, id))!,
    replayed: false
  };
}

// -- Pools ---------------------------------------------------------------------

export type PoolWrite =
  { outcome: "ok"; pool: PoolDto; replayed: boolean } | AdminRefusal;

export async function createPool(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  input: CreatePoolInput
): Promise<PoolWrite> {
  const result = await guarded(tx, "awcms_booking_pool_create", async () => {
    const rows = (await tx`
      INSERT INTO awcms_booking_resource_pools
        (tenant_id, code, name, allocation_policy, created_by, updated_by)
      VALUES (${tenantId}, ${input.code}, ${input.name}, ${input.allocationPolicy},
              ${actor.actorTenantUserId}, ${actor.actorTenantUserId})
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  });

  if (!result.ok) {
    return result.refusal;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.poolCreated.action,
    resourceType: "booking_resource_pool",
    resourceId: result.value,
    severity: BOOKING_AUDIT_EVENTS.poolCreated.severity,
    message: "Booking resource pool created.",
    attributes: { code: input.code },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    pool: (await getPool(tx, tenantId, result.value))!,
    replayed: false
  };
}

async function lockPool(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<{
  id: string;
  code: string;
  name: string;
  allocation_policy: "first_free";
  deleted_at: string | null;
} | null> {
  const rows = (await tx`
    SELECT id, code, name, allocation_policy, deleted_at::text AS deleted_at
    FROM awcms_booking_resource_pools
    WHERE tenant_id = ${tenantId} AND id = ${id}
    FOR UPDATE
  `) as {
    id: string;
    code: string;
    name: string;
    allocation_policy: "first_free";
    deleted_at: string | null;
  }[];

  return rows[0] ?? null;
}

export async function patchPool(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string,
  patch: PoolPatchInput,
  canSeeDeleted: () => Promise<boolean>
): Promise<PoolWrite> {
  const current = await lockPool(tx, tenantId, id);

  if (!current) {
    return poolNotFound();
  }

  if (current.deleted_at !== null) {
    // A deleted row is invisible without `.restore` (booking.md section 6).
    if (!(await canSeeDeleted())) {
      return poolNotFound();
    }

    return refuse(
      409,
      "POOL_DELETED",
      "A deleted pool cannot be edited; restore it first."
    );
  }

  await tx`
    UPDATE awcms_booking_resource_pools
    SET name = ${patch.name ?? current.name},
        allocation_policy = ${patch.allocationPolicy ?? current.allocation_policy},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.poolUpdated.action,
    resourceType: "booking_resource_pool",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.poolUpdated.severity,
    message: "Booking resource pool updated.",
    attributes: { code: current.code, changed: Object.keys(patch) },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    pool: (await getPool(tx, tenantId, id))!,
    replayed: false
  };
}

export async function deletePool(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string,
  canSeeDeleted: () => Promise<boolean>
): Promise<PoolWrite> {
  const current = await lockPool(tx, tenantId, id);

  if (!current) {
    return poolNotFound();
  }

  if (current.deleted_at !== null) {
    if (!(await canSeeDeleted())) {
      return poolNotFound();
    }

    return {
      outcome: "ok",
      pool: (await getPool(tx, tenantId, id))!,
      replayed: true
    };
  }

  const members = (await tx`
    SELECT count(*)::int AS n FROM awcms_booking_resources
    WHERE tenant_id = ${tenantId} AND pool_id = ${id} AND deleted_at IS NULL
  `) as { n: number }[];

  if ((members[0]?.n ?? 0) > 0) {
    return refuse(
      409,
      "POOL_NOT_EMPTY",
      "The pool still has resources; move them to another pool or none first."
    );
  }

  await tx`
    UPDATE awcms_booking_resource_pools
    SET deleted_at = now(), deleted_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.poolDeleted.action,
    resourceType: "booking_resource_pool",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.poolDeleted.severity,
    message: "Booking resource pool soft-deleted.",
    attributes: { code: current.code },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    pool: (await getPool(tx, tenantId, id))!,
    replayed: false
  };
}

export async function restorePool(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  id: string
): Promise<PoolWrite> {
  const current = await lockPool(tx, tenantId, id);

  if (!current) {
    return poolNotFound();
  }

  if (current.deleted_at === null) {
    return {
      outcome: "ok",
      pool: (await getPool(tx, tenantId, id))!,
      replayed: true
    };
  }

  await tx`
    UPDATE awcms_booking_resource_pools
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.poolRestored.action,
    resourceType: "booking_resource_pool",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.poolRestored.severity,
    message: "Booking resource pool restored.",
    attributes: { code: current.code },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    pool: (await getPool(tx, tenantId, id))!,
    replayed: false
  };
}

/** Upper bound of the lookup helpers below: 50 pages of {@link ADMIN_PAGE_SIZE}. A tenant past it is a design question, not a silent cut. */
const LOOKUP_PAGES = 50;

/** Every resource of the tenant, page after page (bounded), for a screen's name lookup or picker. */
export async function listAllResources(
  tx: Sql,
  tenantId: string,
  filters: ResourceListFilters
): Promise<ResourceDto[]> {
  const all: ResourceDto[] = [];
  let cursor: KeysetCursor | undefined;

  for (let page = 0; page < LOOKUP_PAGES; page += 1) {
    const result = await listResources(tx, tenantId, filters, cursor);

    all.push(...result.resources);

    const next = result.nextCursor
      ? decodeKeysetCursor(result.nextCursor)
      : null;

    if (!next) break;

    cursor = next;
  }

  return all;
}

/** Every pool of the tenant, page after page (bounded). */
export async function listAllPools(
  tx: Sql,
  tenantId: string,
  filters: { deleted: DeletedFilter }
): Promise<PoolDto[]> {
  const all: PoolDto[] = [];
  let cursor: KeysetCursor | undefined;

  for (let page = 0; page < LOOKUP_PAGES; page += 1) {
    const result = await listPools(tx, tenantId, filters, cursor);

    all.push(...result.pools);

    const next = result.nextCursor
      ? decodeKeysetCursor(result.nextCursor)
      : null;

    if (!next) break;

    cursor = next;
  }

  return all;
}

/** The units of every live STAY resource in one read (a picker's options), bounded at 5,000 rows. */
export async function listStayUnits(
  tx: Sql,
  tenantId: string
): Promise<{ resourceId: string; unit: UnitDto }[]> {
  const rows = (await tx`
    SELECT u.resource_id, u.id, u.ordinal, u.label, u.status
    FROM awcms_booking_resource_units u
    JOIN awcms_booking_resources r
      ON r.tenant_id = u.tenant_id AND r.id = u.resource_id
    WHERE u.tenant_id = ${tenantId}
      AND r.booking_mode = 'stay' AND r.deleted_at IS NULL
    ORDER BY u.resource_id, u.ordinal
    LIMIT 5000
  `) as {
    resource_id: string;
    id: string;
    ordinal: number;
    label: string | null;
    status: "active" | "inactive";
  }[];

  return rows.map((row) => ({
    resourceId: row.resource_id,
    unit: {
      id: row.id,
      ordinal: row.ordinal,
      label: row.label,
      status: row.status
    }
  }));
}
