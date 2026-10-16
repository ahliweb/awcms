/**
 * The staff half of a slot claim (Issue #949; `sql/305`; booking.md section
 * 10.3). Runs in the SAME savepoint as `claimUnits`, after the units are won.
 *
 * For each resource the claim won a unit of that NAMES people to serve it, the
 * port-eligible candidates are tried in order with
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING`: the staff exclusion constraint,
 * not a read, decides who is free, exactly as the unit allocator does for units
 * (two concurrent claims for the last free person cannot both win; the loser
 * waits for the winner's verdict and then sees the conflict). If no candidate can
 * be won the function returns `false` and the caller throws, so the savepoint
 * rolls back the units and the reservation too: nothing is allocated partially.
 *
 * A resource that names nobody (the default), a stay, or a consumer that is the
 * no-op, costs no query.
 */
import type { StaffAvailabilityConsumer } from "../domain/booking-staff-availability";
import { reclaimExpiredHoldsForStaff } from "./booking-hold-expiry";

type Sql = Bun.SQL;

export type StaffClaim = {
  tenantId: string;
  itemId: string;
  /** The distinct resources the units were won on. */
  resourceIds: readonly string[];
  /** The service interval (not the setup/cleanup-widened range), ISO instants. */
  startsIso: string;
  endsIso: string;
  correlationId?: string;
};

/** `true` when every resource that needs a person got one (or none needed one). */
export async function claimStaff(
  tx: Sql,
  staff: StaffAvailabilityConsumer,
  claim: StaffClaim
): Promise<boolean> {
  const fromMs = Date.parse(claim.startsIso);
  const toMs = Date.parse(claim.endsIso);

  for (const resourceId of claim.resourceIds) {
    const eligible = await staff.eligibleStaff(tx, {
      tenantId: claim.tenantId,
      resourceId,
      fromMs,
      toMs
    });

    if (!eligible.required) {
      continue;
    }

    // An elapsed-but-unreaped hold on ANOTHER resource must not keep a person
    // busy: reclaim by staff reference first (the occupancy is correct without
    // the reaper), then race for whoever is left.
    await reclaimExpiredHoldsForStaff(
      tx,
      claim.tenantId,
      eligible.staffRefs,
      fromMs,
      toMs,
      undefined,
      claim.correlationId
    );

    let won = false;

    for (const staffRef of eligible.staffRefs) {
      const rows = (await tx`
        INSERT INTO awcms_booking_staff_assignments
          (tenant_id, item_id, resource_id, staff_ref, occupied_from, occupied_to)
        VALUES (
          ${claim.tenantId}, ${claim.itemId}, ${resourceId}, ${staffRef},
          ${claim.startsIso}::timestamptz, ${claim.endsIso}::timestamptz
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `) as { id: string }[];

      if (rows.length > 0) {
        won = true;
        break;
      }
    }

    if (!won) {
      return false;
    }
  }

  return true;
}
