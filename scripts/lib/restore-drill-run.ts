/**
 * One dump -> restore -> verify cycle of the restore drill (Issue #968), shared
 * by the CLI (`scripts/restore-drill.ts`, two clusters) and the integration
 * test (`tests/integration/restore-drill.integration.test.ts`, which tampers
 * with the restored database afterwards).
 */
import { stat } from "node:fs/promises";

import {
  collectCatalogFacts,
  collectSequences,
  collectTableDigests,
  dumpDatabase,
  provisionRoles,
  restoreDatabase,
  type ConnectionParts,
  type Sql
} from "./restore-drill";
import {
  countWitness,
  writeAfterSnapshot,
  type SeededDrill
} from "./restore-drill-seed";
import { verifyRestore, type RestoreWitness } from "./restore-drill-verify";
import type { DrillCheck } from "./restore-drill";

export type CycleInput = {
  source: ConnectionParts;
  /** Superuser on the source CLUSTER (roles are read from it). */
  sourceRoot: Sql;
  /** Superuser on the source DATABASE. */
  sourceAdmin: Sql;
  /** Login as `awcms_app` on the source database. */
  sourceApp: Sql;
  /** A dedicated single connection that holds the snapshot transaction open. */
  snapshotConnection: Sql;
  seeded: SeededDrill;
  target: ConnectionParts;
  /** Superuser on the target CLUSTER. */
  targetRoot: Sql;
  /** Sets the runtime roles' passwords on the target (what a deployment does with a real secret). */
  activateTargetRoles: () => Promise<void>;
  openTargetAdmin: () => Sql;
  openTargetApp: () => Sql;
  dumpFile: string;
  /** Reservations to commit after the snapshot. */
  postSnapshotWrites?: number;
};

export type CycleResult = {
  witness: RestoreWitness;
  phasesMs: Record<string, number>;
  dumpBytes: number;
  checks: DrillCheck[];
  targetAdmin: Sql;
  targetApp: Sql;
};

async function timed<T>(
  phases: Record<string, number>,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = performance.now();

  try {
    return await fn();
  } finally {
    phases[name] = Math.round(performance.now() - started);
  }
}

export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const phasesMs: Record<string, number> = {};
  const witness: RestoreWitness = {
    digests: {},
    sequences: {},
    facts: await collectCatalogFacts(input.sourceAdmin),
    tenants: await countWitness(input.sourceApp, input.seeded.tenants),
    postSnapshotReservationIds: []
  };

  // The snapshot transaction stays open while the writes land and the dump runs.
  await input.snapshotConnection.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");

    const exported = (await tx.unsafe("SELECT pg_export_snapshot() AS id")) as {
      id: string;
    }[];

    witness.digests = await collectTableDigests(tx as unknown as Sql);
    witness.sequences = await collectSequences(tx as unknown as Sql);

    const after = await writeAfterSnapshot(
      input.sourceApp,
      input.seeded.tenants[0]!,
      input.postSnapshotWrites ?? 3
    );

    witness.postSnapshotReservationIds = after.reservationIds;

    await timed(phasesMs, "dumpMs", () =>
      dumpDatabase(input.source, input.dumpFile, exported[0]!.id)
    );
  });

  const dumpBytes = (await stat(input.dumpFile)).size;

  await timed(phasesMs, "provisionRolesMs", async () => {
    await provisionRoles(input.sourceRoot, input.targetRoot);
    await input.activateTargetRoles();
  });
  await timed(phasesMs, "restoreMs", () =>
    restoreDatabase(input.target, input.dumpFile)
  );

  const targetAdmin = input.openTargetAdmin();
  const targetApp = input.openTargetApp();
  const checks = await timed(phasesMs, "verifyMs", () =>
    verifyRestore(targetAdmin, targetApp, witness)
  );

  return { witness, phasesMs, dumpBytes, checks, targetAdmin, targetApp };
}
