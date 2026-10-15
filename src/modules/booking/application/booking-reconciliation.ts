/**
 * Read-only reconciliation of `booking` reservations against their allocations
 * (Issue #939, docs/awcms/booking.md section 7.1). It PROVES the claim, it never
 * repairs it: a defect is corrected by a compensating transition, never an edit.
 *
 * ## Why it exists when the database already forbids double-booking
 *
 * The exclusion constraint proves no unit is held twice. It cannot prove that a
 * held reservation still HAS its units, that a cancelled one let them go, that an
 * expired hold was swept, or that every transition left its history row. Those
 * are invariants between tables, held by the application and the transition
 * triggers, and this is the query that shows they hold: on a healthy tenant
 * `drift` is zero.
 *
 * ## The reaper's health is read here
 *
 * Correctness never depends on the hold-expiry job (`booking-hold-expiry.ts`:
 * lazy reclaim covers every claim). So a stopped reaper does not corrupt
 * anything; it is visible as `hold_overdue_unswept` -- a `held` reservation more
 * than `REAPER_GRACE_SECONDS` past its expiry -- and as `reaper.oldestOverdueSeconds`,
 * the lag an operator alerts on.
 *
 * ## Scope
 *
 * Every query names `tenant_id` and runs under RLS FORCE. Each check returns its
 * exact count and up to `SAMPLE_SIZE` ids, so a report stays small however large
 * the drift. The checks scan the tenant's rows; this is an on-demand operator
 * read (permission `booking.reservations.reconcile`, wired by Issue #941), not a
 * hot path.
 *
 * ## Stays and blocks (Issue #940, ADR-0135)
 *
 * A stay allocation is checked against its item by the same queries as a slot
 * (`allocation_item_mismatch` compares `[stay_from, stay_to)` with the item's
 * `[check_in_date, check_out_date)`; `allocation_granularity_mismatch` compares
 * an allocation's granularity with its resource's `booking_mode`). A block has
 * rows of its own: three checks prove them -- a live block row whose block is
 * released (`block_allocation_orphan`), an active block that does not own
 * exactly the rows its units call for (`block_missing_allocation`), and a row
 * whose resource, unit or dates differ from its block's
 * (`block_allocation_mismatch`). `sql/204` makes the first impossible through
 * the application role (the block's release trigger), so a finding there means
 * a writer that bypassed it.
 */
import { REAPER_GRACE_SECONDS } from "../domain/booking-allocation";

type Sql = Bun.SQL;

export const RECONCILIATION_SAMPLE_SIZE = 20;

export const RECONCILIATION_CHECKS = [
  "live_allocation_on_released_reservation",
  "reservation_missing_allocation",
  "allocation_release_reason_mismatch",
  "hold_overdue_unswept",
  "allocation_buffer_mismatch",
  "allocation_item_mismatch",
  "allocation_granularity_mismatch",
  "reservation_envelope_mismatch",
  "lineage_broken",
  "missing_created_event",
  "missing_status_event",
  "block_allocation_orphan",
  "block_missing_allocation",
  "block_allocation_mismatch"
] as const;
export type ReconciliationCheck = (typeof RECONCILIATION_CHECKS)[number];

export type ReconciliationFinding = {
  check: ReconciliationCheck;
  /** Exact number of offending rows. */
  count: number;
  /** Up to `RECONCILIATION_SAMPLE_SIZE` ids of the offending rows (reservation or allocation ids, per check). */
  sampleIds: string[];
};

export type ReconciliationReport = {
  /** Total offending rows across every check. Zero on a healthy tenant. */
  drift: number;
  findings: ReconciliationFinding[];
  /** The hold-expiry job as the data shows it (correctness does not depend on it). */
  reaper: {
    /** `held` reservations whose expiry has passed (the next sweep will take them). */
    dueHolds: number;
    /** Of those, how many are more than the grace past expiry: a stuck job. */
    overdueHolds: number;
    /** Seconds the oldest elapsed hold has waited; `0` when none. */
    oldestOverdueSeconds: number;
    graceSeconds: number;
  };
};

type IdRow = { id: string; total: number | string };

async function runCheck(
  check: ReconciliationCheck,
  rows: IdRow[]
): Promise<ReconciliationFinding> {
  return {
    check,
    count: rows.length === 0 ? 0 : Number(rows[0]!.total),
    sampleIds: rows.map((row) => row.id)
  };
}

export async function runReconciliation(
  tx: Sql,
  tenantId: string
): Promise<ReconciliationReport> {
  const sample = RECONCILIATION_SAMPLE_SIZE;
  const findings: ReconciliationFinding[] = [];

  // 1. A live allocation under a reservation that released its units.
  findings.push(
    await runCheck(
      "live_allocation_on_released_reservation",
      (await tx`
        SELECT a.id, count(*) OVER () AS total
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_reservation_items i
          ON i.tenant_id = a.tenant_id AND i.id = a.item_id
        JOIN awcms_booking_reservations r
          ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
        WHERE a.tenant_id = ${tenantId}
          AND a.released_at IS NULL
          AND r.status IN ('cancelled', 'expired', 'rescheduled')
        ORDER BY a.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 2. A reservation that keeps its units but an item has not exactly `quantity`
  //    live allocations (a lost unit, or a claim that was never completed).
  findings.push(
    await runCheck(
      "reservation_missing_allocation",
      (await tx`
        SELECT r.id, count(*) OVER () AS total
        FROM awcms_booking_reservations r
        WHERE r.tenant_id = ${tenantId}
          AND r.status IN ('held', 'confirmed', 'checked_in', 'completed', 'no_show')
          AND (
            NOT EXISTS (
              SELECT 1 FROM awcms_booking_reservation_items i
              WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
            )
            OR EXISTS (
              SELECT 1 FROM awcms_booking_reservation_items i
              WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
                AND i.quantity <> (
                  SELECT count(*) FROM awcms_booking_resource_allocations a
                  WHERE a.tenant_id = i.tenant_id AND a.item_id = i.id
                    AND a.released_at IS NULL
                )
            )
          )
        ORDER BY r.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 3. A released allocation whose reason contradicts its reservation's status.
  //    'cancelled', 'expired' and 'rescheduled' are the three release reasons and
  //    the three statuses that release: the reason is the status.
  findings.push(
    await runCheck(
      "allocation_release_reason_mismatch",
      (await tx`
        SELECT a.id, count(*) OVER () AS total
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_reservation_items i
          ON i.tenant_id = a.tenant_id AND i.id = a.item_id
        JOIN awcms_booking_reservations r
          ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
        WHERE a.tenant_id = ${tenantId}
          AND a.released_at IS NOT NULL
          AND r.status IN ('cancelled', 'expired', 'rescheduled')
          AND a.released_reason <> r.status::text
        ORDER BY a.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 4. A hold far past its expiry that nobody swept: the reaper is stuck.
  findings.push(
    await runCheck(
      "hold_overdue_unswept",
      (await tx`
        SELECT r.id, count(*) OVER () AS total
        FROM awcms_booking_reservations r
        WHERE r.tenant_id = ${tenantId}
          AND r.status = 'held'
          AND r.hold_expires_at
              < clock_timestamp() - make_interval(secs => ${REAPER_GRACE_SECONDS})
        ORDER BY r.hold_expires_at, r.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 5. A time allocation whose buffer disagrees with its item's snapshot.
  findings.push(
    await runCheck(
      "allocation_buffer_mismatch",
      (await tx`
        SELECT a.id, count(*) OVER () AS total
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_reservation_items i
          ON i.tenant_id = a.tenant_id AND i.id = a.item_id
        WHERE a.tenant_id = ${tenantId}
          AND a.granularity = 'time'
          AND (
            a.occupied_from <> i.starts_at - make_interval(secs => i.setup_seconds)
            OR a.occupied_to <> i.ends_at + make_interval(secs => i.cleanup_seconds)
          )
        ORDER BY a.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 6. An allocation whose instants, or (stay) dates, differ from its item's.
  findings.push(
    await runCheck(
      "allocation_item_mismatch",
      (await tx`
        SELECT a.id, count(*) OVER () AS total
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_reservation_items i
          ON i.tenant_id = a.tenant_id AND i.id = a.item_id
        WHERE a.tenant_id = ${tenantId}
          AND (
            a.starts_at <> i.starts_at
            OR a.ends_at <> i.ends_at
            OR a.granularity <> i.granularity
            OR (a.granularity = 'stay'
                AND (a.stay_from <> i.check_in_date OR a.stay_to <> i.check_out_date))
          )
        ORDER BY a.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 7. An allocation whose granularity is not its resource's booking mode.
  findings.push(
    await runCheck(
      "allocation_granularity_mismatch",
      (await tx`
        SELECT a.id, count(*) OVER () AS total
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_resources res
          ON res.tenant_id = a.tenant_id AND res.id = a.resource_id
        WHERE a.tenant_id = ${tenantId}
          AND a.granularity <> CASE res.booking_mode WHEN 'slot' THEN 'time' ELSE res.booking_mode END
        ORDER BY a.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 8. A reservation whose envelope is not the span of its items.
  findings.push(
    await runCheck(
      "reservation_envelope_mismatch",
      (await tx`
        SELECT r.id, count(*) OVER () AS total
        FROM awcms_booking_reservations r
        JOIN LATERAL (
          SELECT min(i.starts_at) AS first_start, max(i.ends_at) AS last_end
          FROM awcms_booking_reservation_items i
          WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
        ) span ON true
        WHERE r.tenant_id = ${tenantId}
          AND span.first_start IS NOT NULL
          AND (r.starts_at <> span.first_start OR r.ends_at <> span.last_end)
        ORDER BY r.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 9. A broken lineage: a reschedule whose lineage differs from its parent's,
  //    or a lineage whose root reservation is missing.
  findings.push(
    await runCheck(
      "lineage_broken",
      (await tx`
        SELECT r.id, count(*) OVER () AS total
        FROM awcms_booking_reservations r
        LEFT JOIN awcms_booking_reservations parent
          ON parent.tenant_id = r.tenant_id AND parent.id = r.rescheduled_from_id
        WHERE r.tenant_id = ${tenantId}
          AND (
            (r.rescheduled_from_id IS NOT NULL
              AND (parent.id IS NULL OR parent.lineage_id <> r.lineage_id
                   OR parent.superseded_by_id IS DISTINCT FROM r.id))
            OR (r.rescheduled_from_id IS NULL AND r.lineage_id <> r.id)
            OR NOT EXISTS (
              SELECT 1 FROM awcms_booking_reservations root
              WHERE root.tenant_id = r.tenant_id AND root.id = r.lineage_id
            )
          )
        ORDER BY r.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 10. A reservation with no `created` event.
  findings.push(
    await runCheck(
      "missing_created_event",
      (await tx`
        SELECT r.id, count(*) OVER () AS total
        FROM awcms_booking_reservations r
        WHERE r.tenant_id = ${tenantId}
          AND NOT EXISTS (
            SELECT 1 FROM awcms_booking_reservation_events e
            WHERE e.tenant_id = r.tenant_id AND e.reservation_id = r.id
              AND e.kind = 'created'
          )
        ORDER BY r.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 11. A reservation in a state its history never recorded reaching. Each kind
  //     happens once (a unique key), and every transition appends its row in the
  //     same transaction, so the current status always has an event of that kind.
  findings.push(
    await runCheck(
      "missing_status_event",
      (await tx`
        SELECT r.id, count(*) OVER () AS total
        FROM awcms_booking_reservations r
        WHERE r.tenant_id = ${tenantId}
          AND NOT EXISTS (
            SELECT 1 FROM awcms_booking_reservation_events e
            WHERE e.tenant_id = r.tenant_id AND e.reservation_id = r.id
              AND e.kind = r.status
          )
        ORDER BY r.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 12. A live blocked night whose block has been released: the nights were
  //     never returned to sale.
  findings.push(
    await runCheck(
      "block_allocation_orphan",
      (await tx`
        SELECT a.id, count(*) OVER () AS total
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_resource_blocks b
          ON b.tenant_id = a.tenant_id AND b.id = a.block_id
        WHERE a.tenant_id = ${tenantId}
          AND a.released_at IS NULL
          AND b.status <> 'active'
        ORDER BY a.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 13. An active block that does not own exactly one live row per unit it
  //     covers: the named unit, or every unit of the resource. A resource that
  //     gained a unit after the block was placed shows here too -- the block
  //     does not cover it.
  findings.push(
    await runCheck(
      "block_missing_allocation",
      (await tx`
        SELECT b.id, count(*) OVER () AS total
        FROM awcms_booking_resource_blocks b
        WHERE b.tenant_id = ${tenantId}
          AND b.status = 'active'
          AND (
            SELECT count(*) FROM awcms_booking_resource_allocations a
            WHERE a.tenant_id = b.tenant_id AND a.block_id = b.id
              AND a.released_at IS NULL
          ) <> CASE WHEN b.resource_unit_id IS NULL
                    THEN (SELECT count(*) FROM awcms_booking_resource_units u
                          WHERE u.tenant_id = b.tenant_id
                            AND u.resource_id = b.resource_id)
                    ELSE 1 END
        ORDER BY b.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  // 14. A blocked night whose resource, unit or dates differ from its block's.
  findings.push(
    await runCheck(
      "block_allocation_mismatch",
      (await tx`
        SELECT a.id, count(*) OVER () AS total
        FROM awcms_booking_resource_allocations a
        JOIN awcms_booking_resource_blocks b
          ON b.tenant_id = a.tenant_id AND b.id = a.block_id
        WHERE a.tenant_id = ${tenantId}
          AND (
            a.resource_id <> b.resource_id
            OR (b.resource_unit_id IS NOT NULL
                AND a.resource_unit_id <> b.resource_unit_id)
            OR a.stay_from <> b.block_from
            OR a.stay_to <> b.block_to
          )
        ORDER BY a.id
        LIMIT ${sample}
      `) as IdRow[]
    )
  );

  const reaperRows = (await tx`
    SELECT count(*)::int AS due,
           (count(*) FILTER (
             WHERE hold_expires_at
                   < clock_timestamp() - make_interval(secs => ${REAPER_GRACE_SECONDS})
           ))::int AS overdue,
           coalesce(
             floor(extract(epoch FROM clock_timestamp() - min(hold_expires_at))), 0
           )::int AS oldest
    FROM awcms_booking_reservations
    WHERE tenant_id = ${tenantId}
      AND status = 'held'
      AND hold_expires_at <= clock_timestamp()
  `) as { due: number; overdue: number; oldest: number }[];
  const reaper = reaperRows[0]!;

  return {
    drift: findings.reduce((sum, finding) => sum + finding.count, 0),
    findings,
    reaper: {
      dueHolds: Number(reaper.due),
      overdueHolds: Number(reaper.overdue),
      oldestOverdueSeconds: Math.max(0, Number(reaper.oldest)),
      graceSeconds: REAPER_GRACE_SECONDS
    }
  };
}
