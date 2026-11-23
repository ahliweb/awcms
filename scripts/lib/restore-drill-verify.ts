/**
 * The verification half of the restore drill: everything that is checked AFTER
 * `pg_restore`, as one function so the integration test can tamper with a
 * restored database and watch the right check go red (Issue #968).
 */
import { runReconciliation } from "../../src/modules/booking/application/booking-reconciliation";
import {
  collectCatalogFacts,
  collectSequences,
  collectTableDigests,
  compareCatalogFacts,
  compareRowChecksums,
  compareRowCounts,
  compareSequences,
  compareTableSets,
  runBehaviourProbes,
  tenantTx,
  type CatalogFacts,
  type DrillCheck,
  type SequenceValues,
  type Sql,
  type TableDigests,
  type TenantWitness
} from "./restore-drill";

export type RestoreWitness = {
  /** Per-table digests read inside the snapshot the dump was pinned to. */
  digests: TableDigests;
  sequences: SequenceValues;
  /** Catalog facts of the source database. */
  facts: CatalogFacts;
  /** Per-tenant counts as the runtime role saw them at the snapshot. */
  tenants: TenantWitness[];
  /** Reservations committed AFTER the snapshot: they must not be in the restore. */
  postSnapshotReservationIds: string[];
};

export async function verifyRestore(
  restoredAdmin: Sql,
  restoredApp: Sql,
  witness: RestoreWitness
): Promise<DrillCheck[]> {
  const checks: DrillCheck[] = [];
  const digests = await collectTableDigests(restoredAdmin);

  checks.push(
    compareTableSets(witness.digests, digests),
    compareRowCounts(witness.digests, digests),
    compareRowChecksums(witness.digests, digests),
    compareSequences(witness.sequences, await collectSequences(restoredAdmin)),
    ...compareCatalogFacts(
      witness.facts,
      await collectCatalogFacts(restoredAdmin)
    ),
    ...(await runBehaviourProbes(restoredApp, witness.tenants))
  );

  // The reservation and allocation rules of booking.md 7.1, run after the
  // restore exactly as the runbook says; a copy that was not one instant would
  // show an allocation without its reservation (or the reverse) as drift.
  const reconciliation: string[] = [];

  for (const tenant of witness.tenants) {
    try {
      const report = await tenantTx(restoredApp, tenant.tenantId, (tx) =>
        runReconciliation(tx, tenant.tenantId)
      );

      if (report.drift !== 0) {
        reconciliation.push(
          `tenant ${tenant.tenantId.slice(0, 8)} drift ${report.drift}: ${report.findings
            .filter((finding) => finding.count > 0)
            .map((finding) => `${finding.check}=${finding.count}`)
            .join(",")}`
        );
      }
    } catch (error) {
      // A reconciliation that cannot run is a failed one, not a skipped one.
      reconciliation.push(
        `tenant ${tenant.tenantId.slice(0, 8)} reconciliation could not run: ${(error as Error).message}`
      );
    }
  }

  checks.push({
    id: "booking_reconciliation_clean",
    ok: reconciliation.length === 0 && witness.tenants.length > 0,
    detail:
      reconciliation.length === 0
        ? `reconciliation drift 0 for ${witness.tenants.length} tenants`
        : reconciliation.join("; ")
  });

  const leaked = (await restoredAdmin.unsafe(
    `SELECT count(*)::int AS n FROM awcms_booking_reservations
     WHERE id = ANY($1::uuid[])`,
    [`{${witness.postSnapshotReservationIds.join(",")}}`]
  )) as { n: number }[];
  const vacuous = witness.postSnapshotReservationIds.length === 0;

  checks.push({
    id: "booking_point_in_time",
    ok: !vacuous && leaked[0]!.n === 0,
    detail: vacuous
      ? "vacuous: no post-snapshot reservation was written, so nothing proves the cut"
      : `${witness.postSnapshotReservationIds.length} reservations committed after the snapshot, ${leaked[0]!.n} of them present in the restore`
  });

  return checks;
}
