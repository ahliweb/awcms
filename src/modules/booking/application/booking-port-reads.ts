/**
 * The reads behind `BookingPort.get`, `getOffering` and `listOfferings`
 * (Issue #1108, contract 1.1.0 of the `booking` capability; ADR-0011).
 *
 * ## Why these are not the admin directories
 *
 * `booking-reservation-directory.ts` returns a `ReservationView` that includes
 * the opaque `externalCustomerRef` (a front desk needs it) and the admin offering
 * read returns edit-oriented fields. A port consumer is an adapter, not a front
 * desk: it must learn the schedule and the state of a reservation, never a
 * person, even an opaque one. So these queries select an explicit allow-list of
 * columns and the customer-reference column is never named here. A test pins the
 * absence (`tests/booking-port-additions.test.ts`), because a `SELECT *` or a widened
 * list is exactly how personal data leaks into a read that was meant to be
 * neutral.
 *
 * Every query names `tenant_id` AND runs under RLS FORCE, so another tenant's id
 * is the same neutral "not found" as an unknown one.
 */
import type {
  BookingOfferingRecord,
  BookingReservationRecord,
  BookingStayRecord
} from "../../_shared/ports/booking-port";
import {
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

type Sql = Bun.SQL;

export const PORT_OFFERINGS_DEFAULT_LIMIT = 50;
export const PORT_OFFERINGS_MAX_LIMIT = 100;

const isoUtc = (column: string) => utcMicrosecondTextSql(column, "Z");

type ReservationRow = {
  id: string;
  reservation_no: string;
  status: string;
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
  lineage_id: string;
  superseded_by_id: string | null;
  external_ref_type: string | null;
  external_ref: string | null;
};

/** The allow-list. `external_customer_ref`, `cancel_reason_code`, `party_size` and the actor columns are deliberately absent. */
const RESERVATION_COLUMNS = `
  r.id, r.reservation_no, r.status,
  ${isoUtc("r.starts_at")} AS starts_at,
  ${isoUtc("r.ends_at")} AS ends_at,
  ${isoUtc("r.hold_expires_at")} AS hold_expires_at,
  r.lineage_id, r.superseded_by_id, r.external_ref_type, r.external_ref`;

export type PortReservationKey =
  { reservationId: string } | { reservationNo: string };

export async function readReservationForPort(
  tx: Sql,
  tenantId: string,
  key: PortReservationKey
): Promise<BookingReservationRecord | null> {
  const id = "reservationId" in key ? key.reservationId : null;
  const no = "reservationNo" in key ? key.reservationNo : null;
  const rows = (await tx`
    SELECT ${tx.unsafe(RESERVATION_COLUMNS)}
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId}
      AND (${id}::uuid IS NULL OR r.id = ${id}::uuid)
      AND (${no}::text IS NULL OR r.reservation_no = ${no}::text)
  `) as ReservationRow[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  const items = (await tx`
    SELECT i.offering_id,
           to_char(i.check_in_date, 'YYYY-MM-DD') AS check_in_date,
           to_char(i.check_out_date, 'YYYY-MM-DD') AS check_out_date,
           i.nights, i.timezone
    FROM awcms_booking_reservation_items i
    WHERE i.tenant_id = ${tenantId} AND i.reservation_id = ${row.id}
      AND i.granularity = 'stay'
    ORDER BY i.line_no
  `) as {
    offering_id: string;
    check_in_date: string;
    check_out_date: string;
    nights: number;
    timezone: string;
  }[];
  const stays: BookingStayRecord[] = items.map((item) => ({
    offeringId: item.offering_id,
    checkInDate: item.check_in_date,
    checkOutDate: item.check_out_date,
    nights: Number(item.nights),
    timezone: item.timezone
  }));

  return {
    reservationId: row.id,
    reservationNo: row.reservation_no,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    holdExpiresAt: row.hold_expires_at,
    lineageId: row.lineage_id,
    supersededById: row.superseded_by_id,
    stays,
    externalRef:
      row.external_ref_type !== null && row.external_ref !== null
        ? { type: row.external_ref_type, id: row.external_ref }
        : null
  };
}

type OfferingRow = {
  id: string;
  code: string;
  name: string;
  granularity: "time" | "stay";
  confirmation_mode: "immediate" | "hold_then_confirm";
  status: "active" | "inactive";
  min_party: number;
  max_party: number;
  duration_seconds: number | null;
  min_nights: number | null;
  max_nights: number | null;
  created_at: string;
};

const OFFERING_COLUMNS = `
  o.id, o.code, o.name, o.granularity, o.confirmation_mode, o.status,
  o.min_party, o.max_party, o.duration_seconds, o.min_nights, o.max_nights,
  ${keysetCursorCreatedAtSql("o")} AS created_at`;

function toOffering(row: OfferingRow): BookingOfferingRecord {
  return {
    offeringId: row.id,
    code: row.code,
    name: row.name,
    granularity: row.granularity,
    confirmationMode: row.confirmation_mode,
    status: row.status,
    minParty: Number(row.min_party),
    maxParty: Number(row.max_party),
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    minNights: row.min_nights === null ? null : Number(row.min_nights),
    maxNights: row.max_nights === null ? null : Number(row.max_nights)
  };
}

export async function readOfferingForPort(
  tx: Sql,
  tenantId: string,
  offeringId: string
): Promise<BookingOfferingRecord | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(OFFERING_COLUMNS)}
    FROM awcms_booking_service_offerings o
    WHERE o.tenant_id = ${tenantId} AND o.id = ${offeringId}::uuid
      AND o.deleted_at IS NULL
  `) as OfferingRow[];

  return rows[0] ? toOffering(rows[0]) : null;
}

export async function listOfferingsForPort(
  tx: Sql,
  tenantId: string,
  options: {
    limit: number;
    status: "active" | "inactive" | null;
    cursor: KeysetCursor | null;
  }
): Promise<{ offerings: BookingOfferingRecord[]; nextCursor: string | null }> {
  const cursorCreatedAt = options.cursor ? options.cursor.createdAt : null;
  const cursorId = options.cursor ? options.cursor.id : null;
  // One more than asked, so "is there a next page" is a fact, not a guess from a full page.
  const rows = (await tx`
    SELECT ${tx.unsafe(OFFERING_COLUMNS)}
    FROM awcms_booking_service_offerings o
    WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
      AND (${options.status}::text IS NULL OR o.status = ${options.status}::text)
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (o.created_at, o.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ${options.limit + 1}
  `) as OfferingRow[];
  const page = rows.slice(0, options.limit);
  const last = page[page.length - 1];

  return {
    offerings: page.map(toOffering),
    nextCursor:
      rows.length > options.limit && last
        ? encodeKeysetCursor(last.created_at, last.id)
        : null
  };
}
