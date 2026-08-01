/**
 * idn-regions-rollback.ts — `bun run idn-regions:rollback`.
 *
 * ADR-0052 — returns the platform to the PREVIOUSLY active Indonesia region
 * dataset version. Runs as the least-privilege `awcms_worker` role (grants in
 * `sql/080`), touches no network — safe on an offline/LAN deployment.
 *
 * ```bash
 * bun run idn-regions:rollback            # dry run
 * bun run idn-regions:rollback --commit   # rolls back
 * ```
 *
 * ## The destination is never supplied by the caller
 *
 * `rollbackActiveDataset` resolves the target from `activated_at` history
 * itself. That was true of the endpoint this replaces and it stays true here,
 * for the reason its OpenAPI description gave: letting the caller name the
 * destination would make this an activation wearing a safer-sounding name.
 * So this command takes no `--dataset` flag — to serve a specific version, use
 * `bun run idn-regions:activate`.
 *
 * ## Why this is a job and not an endpoint
 *
 * See `idn-regions-activate.ts` and ADR-0052: the permission it used to require
 * (`idn_admin_regions.dataset.restore`) was seeded into the global catalog and
 * granted to every tenant's `owner`, so a tenant owner could roll back the
 * dataset served to every OTHER tenant. The data is global, with no `tenant_id`
 * and no RLS; there is no tenant this action belongs to.
 *
 * As with activation, no `awcms_audit_events` row is written — that table is
 * tenant-scoped and this action is not. Evidence lives on
 * `awcms_idn_region_datasets` (`status`, `activated_at`) and in this command's
 * output. ADR-0052 §Konsekuensi records that cost explicitly.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  DatasetLifecycleError,
  getActiveDataset,
  rollbackActiveDataset
} from "../src/modules/idn-admin-regions/application/dataset-lifecycle";

async function main(): Promise<void> {
  const commit = process.argv.slice(2).includes("--commit");
  const sql = getWorkerDatabaseClient();

  try {
    const active = await sql.begin(async (tx) =>
      getActiveDataset(tx as Bun.TransactionSQL)
    );

    console.log(
      `currently active: ${
        active ? `${active.datasetCode} (${active.id})` : "none"
      }`
    );

    if (!active) {
      console.error(
        "idn-regions:rollback FAILED — no dataset is active, so there is nothing to roll back from."
      );
      process.exitCode = 1;
      return;
    }

    if (!commit) {
      console.log(
        "dry run OK — nothing written. Re-run with --commit to roll back to the previously active version."
      );
      console.log(
        "The destination is resolved from activation history, not chosen here."
      );
      return;
    }

    const result = await sql.begin(async (tx) =>
      rollbackActiveDataset(tx as Bun.TransactionSQL, { activatedBy: null })
    );

    console.log(
      `rolled back to ${result.dataset.datasetCode} (${result.dataset.id})` +
        (result.rolledBackFromId
          ? ` — was ${result.rolledBackFromId}`
          : " — no prior active version recorded")
    );
  } catch (error) {
    if (error instanceof DatasetLifecycleError) {
      // NO_PREVIOUS_DATASET is the common one: a deployment that has only ever
      // activated a single version has nowhere to roll back to.
      console.error(`idn-regions:rollback FAILED — ${safeErrorDetail(error)}`);
      process.exitCode = 1;
      return;
    }
    logScriptFailure("idn-regions:rollback", error);
  }
}

if (import.meta.main) {
  await main();
}
