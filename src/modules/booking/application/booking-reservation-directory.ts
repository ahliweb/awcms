/**
 * Reads of reservations for the HTTP surface (Issue #941, ADR-0131; docs/awcms/
 * booking.md sections 4 and 6): the detail with its items and history, and a
 * keyset-paginated list. Tenant-scoped twice (every query names `tenant_id` AND
 * runs under RLS FORCE), so another tenant's id is simply "not found".
 *
 * ## What a reservation view says, and what it does not
 *
 * `reservations.read` covers "list, detail, events (note excluded)" (booking.md
 * section 6): **the customer note is never read here**; it is behind
 * `reservation_notes.read`, an audited read that arrives with its own route. The
 * opaque `externalCustomerRef` IS returned to a holder of `reservations.read`
 * (a front desk needs it to find the customer at the authority); it is a token
 * and not a name or a contact, and it never appears in an event or an audit row.
 * No price, deposit or payment state exists to return.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

type Sql = Bun.SQL;

export const RESERVATION_PAGE_SIZE = 50;

/** A UTC RFC 3339 instant, rendered by the database (never through a JS Date, which drops microseconds). The one sanctioned renderer. */
function isoUtc(column: string): string {
  return utcMicrosecondTextSql(column, "Z");
}

export type ReservationItemView = {
  lineNo: number;
  offeringId: string;
  offeringCode: string;
  offeringName: string;
  granularity: "time" | "stay";
  startsAt: string;
  endsAt: string;
  quantity: number;
  stay: {
    checkInDate: string;
    checkOutDate: string;
    nights: number;
    timezone: string;
  } | null;
};

export type ReservationEventView = {
  seq: number;
  kind: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string | null;
  reasonCode: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
};

export type ReservationView = {
  id: string;
  reservationNo: string;
  lineageId: string;
  rescheduledFromId: string | null;
  supersededById: string | null;
  status: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  holdExpiresAt: string | null;
  source: string;
  externalRefType: string | null;
  externalRef: string | null;
  externalCustomerRef: string | null;
  lateCancellation: boolean;
  cancelReasonCode: string | null;
  statusChangedAt: string;
  createdAt: string;
  resourceIds: string[];
  items: ReservationItemView[];
};

type ReservationRow = {
  id: string;
  reservation_no: string;
  lineage_id: string;
  rescheduled_from_id: string | null;
  superseded_by_id: string | null;
  status: string;
  party_size: number;
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
  source: string;
  external_ref_type: string | null;
  external_ref: string | null;
  external_customer_ref: string | null;
  late_cancellation: boolean;
  cancel_reason_code: string | null;
  status_changed_at: string;
  created_at: string;
  resource_ids: string | null;
};

const RESERVATION_COLUMNS = `
  r.id, r.reservation_no, r.lineage_id, r.rescheduled_from_id,
  r.superseded_by_id, r.status, r.party_size,
  ${isoUtc("r.starts_at")} AS starts_at,
  ${isoUtc("r.ends_at")} AS ends_at,
  ${isoUtc("r.hold_expires_at")} AS hold_expires_at,
  r.source, r.external_ref_type, r.external_ref, r.external_customer_ref,
  r.late_cancellation, r.cancel_reason_code,
  ${isoUtc("r.status_changed_at")} AS status_changed_at,
  ${keysetCursorCreatedAtSql("r")} AS created_at,
  (SELECT string_agg(x.rid, ',' ORDER BY x.rid)
   FROM (
     SELECT DISTINCT a.resource_id::text AS rid
     FROM awcms_booking_reservation_items i
     JOIN awcms_booking_resource_allocations a
       ON a.tenant_id = i.tenant_id AND a.item_id = i.id
     WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
   ) x) AS resource_ids`;

const ITEM_COLUMNS = `
  i.reservation_id, i.line_no, i.offering_id, i.offering_code,
  i.offering_name, i.granularity, i.quantity,
  ${isoUtc("i.starts_at")} AS starts_at,
  ${isoUtc("i.ends_at")} AS ends_at,
  to_char(i.check_in_date, 'YYYY-MM-DD') AS check_in_date,
  to_char(i.check_out_date, 'YYYY-MM-DD') AS check_out_date,
  i.nights, i.timezone`;

function toView(
  row: ReservationRow,
  items: ReservationItemView[]
): ReservationView {
  return {
    id: row.id,
    reservationNo: row.reservation_no,
    lineageId: row.lineage_id,
    rescheduledFromId: row.rescheduled_from_id,
    supersededById: row.superseded_by_id,
    status: row.status,
    partySize: Number(row.party_size),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    holdExpiresAt: row.hold_expires_at,
    source: row.source,
    externalRefType: row.external_ref_type,
    externalRef: row.external_ref,
    externalCustomerRef: row.external_customer_ref,
    lateCancellation: row.late_cancellation,
    cancelReasonCode: row.cancel_reason_code,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
    resourceIds: row.resource_ids ? row.resource_ids.split(",") : [],
    items
  };
}

async function loadItems(
  tx: Sql,
  tenantId: string,
  reservationIds: readonly string[]
): Promise<Map<string, ReservationItemView[]>> {
  const byReservation = new Map<string, ReservationItemView[]>();

  if (reservationIds.length === 0) {
    return byReservation;
  }

  // Bun.SQL does not bind a JS array as a Postgres array: one text, unpacked in SQL.
  const ids = reservationIds.join(",");
  const rows = (await tx`
    SELECT ${tx.unsafe(ITEM_COLUMNS)}
    FROM awcms_booking_reservation_items i
    WHERE i.tenant_id = ${tenantId}
      AND i.reservation_id = ANY(string_to_array(${ids}::text, ',')::uuid[])
    ORDER BY i.reservation_id, i.line_no
  `) as {
    reservation_id: string;
    line_no: number;
    offering_id: string;
    offering_code: string;
    offering_name: string;
    granularity: "time" | "stay";
    quantity: number;
    starts_at: string;
    ends_at: string;
    check_in_date: string | null;
    check_out_date: string | null;
    nights: number | null;
    timezone: string | null;
  }[];

  for (const row of rows) {
    const items = byReservation.get(row.reservation_id) ?? [];

    items.push({
      lineNo: Number(row.line_no),
      offeringId: row.offering_id,
      offeringCode: row.offering_code,
      offeringName: row.offering_name,
      granularity: row.granularity,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      quantity: Number(row.quantity),
      stay:
        row.granularity === "stay"
          ? {
              checkInDate: row.check_in_date!,
              checkOutDate: row.check_out_date!,
              nights: Number(row.nights),
              timezone: row.timezone!
            }
          : null
    });
    byReservation.set(row.reservation_id, items);
  }

  return byReservation;
}

export async function getReservation(
  tx: Sql,
  tenantId: string,
  reservationId: string
): Promise<ReservationView | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(RESERVATION_COLUMNS)}
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId} AND r.id = ${reservationId}
  `) as ReservationRow[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  const items = await loadItems(tx, tenantId, [row.id]);

  return toView(row, items.get(row.id) ?? []);
}

/**
 * The append-only transition history of one reservation, oldest first. `detail`
 * holds closed keys (ids, instants, counts) and never free text or personal data
 * by construction (booking.md section 4).
 */
export async function listReservationEvents(
  tx: Sql,
  tenantId: string,
  reservationId: string
): Promise<ReservationEventView[]> {
  const rows = (await tx`
    SELECT seq, kind, from_status, to_status, actor_user_id, reason_code,
           detail, ${tx.unsafe(isoUtc("occurred_at"))} AS occurred_at
    FROM awcms_booking_reservation_events
    WHERE tenant_id = ${tenantId} AND reservation_id = ${reservationId}
    ORDER BY seq
  `) as {
    seq: number;
    kind: string;
    from_status: string | null;
    to_status: string;
    actor_user_id: string | null;
    reason_code: string | null;
    detail: unknown;
    occurred_at: string;
  }[];

  return rows.map((row) => ({
    seq: Number(row.seq),
    kind: row.kind,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    reasonCode: row.reason_code,
    detail: (typeof row.detail === "string"
      ? JSON.parse(row.detail)
      : (row.detail ?? {})) as Record<string, unknown>,
    occurredAt: row.occurred_at
  }));
}

export type ReservationListFilters = {
  status?: string;
  lineageId?: string;
  /** The adapter's natural key: both or neither. */
  externalRefType?: string;
  externalRef?: string;
};

export function parseReservationCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

/** This tenant's reservations, newest first, keyset paginated. */
export async function listReservations(
  tx: Sql,
  tenantId: string,
  filters: ReservationListFilters,
  cursor?: KeysetCursor
): Promise<{ reservations: ReservationView[]; nextCursor: string | null }> {
  const status = filters.status ?? null;
  const lineageId = filters.lineageId ?? null;
  const refType = filters.externalRefType ?? null;
  const ref = filters.externalRef ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;
  const rows = (await tx`
    SELECT ${tx.unsafe(RESERVATION_COLUMNS)}
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR r.status = ${status}::text)
      AND (${lineageId}::uuid IS NULL OR r.lineage_id = ${lineageId}::uuid)
      AND (${refType}::text IS NULL OR r.external_ref_type = ${refType}::text)
      AND (${ref}::text IS NULL OR r.external_ref = ${ref}::text)
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (r.created_at, r.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${RESERVATION_PAGE_SIZE}
  `) as ReservationRow[];
  const items = await loadItems(
    tx,
    tenantId,
    rows.map((row) => row.id)
  );
  const last = rows[rows.length - 1];

  return {
    reservations: rows.map((row) => toView(row, items.get(row.id) ?? [])),
    nextCursor:
      rows.length === RESERVATION_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at, last.id)
        : null
  };
}

/**
 * Which of these reservations are HELD with a hold that has run out on the
 * DATABASE clock (`hold_expires_at <= clock_timestamp()`, the rule of
 * `booking-hold-expiry.ts`). The sweep has not released them yet, and the
 * allocator will reclaim them on the next claim, so an operator must not read
 * them as live promises. The clock is the database's, never the web server's.
 */
export async function overdueHoldIds(
  tx: Sql,
  tenantId: string,
  reservationIds: readonly string[]
): Promise<Set<string>> {
  if (reservationIds.length === 0) {
    return new Set();
  }

  const rows = (await tx`
    SELECT id FROM awcms_booking_reservations
    WHERE tenant_id = ${tenantId}
      AND id = ANY(${tx.array([...new Set(reservationIds)], "uuid")})
      AND status = 'held'
      AND hold_expires_at <= clock_timestamp()
  `) as { id: string }[];

  return new Set(rows.map((row) => row.id));
}
