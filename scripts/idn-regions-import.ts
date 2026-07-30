/**
 * idn-regions-import.ts — `bun run idn-regions:import`.
 *
 * ADR-0046 §5 — imports the vendored Indonesia administrative region dump
 * (`data/idn-admin-regions/upstream/cahyadsn-wilayah/db/wilayah.sql`) as a NEW
 * dataset version. Runs as the least-privilege `awcms_worker` role (grants in
 * `sql/080`), reads a repo file, and touches no network — safe on an
 * offline/LAN deployment.
 *
 * ```bash
 * bun run idn-regions:import             # dry run: parse, validate, report, write nothing
 * bun run idn-regions:import --commit    # write one new dataset version
 * ```
 *
 * ## Dry run is the default, and it is not a different code path
 *
 * `--commit` runs the same plan the dry run printed, then writes it. There is no
 * faster, looser validation path that could disagree with the real one.
 *
 * ## The import never activates what it imports
 *
 * A new dataset lands `validated`. Deciding which version the platform SERVES is
 * an audited admin action (`POST /api/v1/idn-regions/datasets/{id}/activate`),
 * because it changes what every address form in the product returns and someone
 * has to own that.
 *
 * NOT tenant-scoped: this is global reference data, so the write runs on a plain
 * transaction rather than `withTenant` — there is no tenant to scope it to (and
 * the tables have no `tenant_id` for RLS to key on).
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  commitDatasetImport,
  planDatasetImport
} from "../src/modules/idn-admin-regions/application/dataset-import";

function formatCounts(counts: Record<string, number>): string {
  return (["province", "regency", "district", "village"] as const)
    .map((type) => `${type}=${counts[type] ?? 0}`)
    .join(" ");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commit = argv.includes("--commit");

  const plan = await planDatasetImport({});

  console.log(`source        : ${plan.sourceFile}`);
  console.log(`upstream commit: ${plan.sourceCommitSha}`);
  console.log(`file sha256   : ${plan.sourceFileSha256}`);
  console.log(`decree        : ${plan.decreeReference}`);
  console.log(`dataset code  : ${plan.datasetCode}`);
  console.log(
    `rows          : ${plan.rowCount} (${formatCounts(plan.countsByType)})`
  );

  if (plan.errors.length > 0) {
    console.error(
      `idn-regions:import FAILED — ${plan.errors.length} problem(s):`
    );
    for (const problem of plan.errors) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  if (!commit) {
    console.log(
      "dry run OK — nothing written. Re-run with --commit to import this dataset (it will land as `validated`, not active)."
    );
    return;
  }

  const sql = getWorkerDatabaseClient();

  try {
    const result = await sql.begin(async (tx) => {
      return commitDatasetImport(tx as Bun.TransactionSQL, plan);
    });

    console.log(
      `imported dataset ${result.datasetCode} (${result.datasetId}) with ${result.rowCount} regions — status ${result.status}.`
    );
    console.log(
      "Activate it explicitly (admin screen or POST /api/v1/idn-regions/datasets/{id}/activate) — importing never changes which dataset is served."
    );
  } catch (error) {
    // A second import of identical bytes collides on the deterministic dataset
    // code. That is the intended outcome, not a failure worth a stack trace:
    // the dataset is already there.
    if (
      error instanceof Error &&
      /awcms_idn_region_datasets_dataset_code_key/.test(error.message)
    ) {
      console.log(
        `dataset ${plan.datasetCode} is already imported — nothing to do (re-importing identical bytes is a no-op by design).`
      );
      return;
    }

    logScriptFailure("idn-regions:import", error);
  }
}

if (import.meta.main) {
  await main();
}
