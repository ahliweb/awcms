/**
 * idn-regions-activate.ts — `bun run idn-regions:activate`.
 *
 * ADR-0052 — chooses which imported Indonesia region dataset version the
 * platform SERVES. Runs as the least-privilege `awcms_worker` role (grants in
 * `sql/080`), touches no network — safe on an offline/LAN deployment.
 *
 * ```bash
 * bun run idn-regions:activate -- --dataset <code|uuid>            # dry run
 * bun run idn-regions:activate -- --dataset <code|uuid> --commit   # activates
 * ```
 *
 * ## Why this is a job and not an endpoint
 *
 * It was `POST /api/v1/idn-regions/datasets/{id}/activate`, gated on
 * `idn_admin_regions.dataset.configure`. That permission sat in the GLOBAL ABAC
 * catalog, and `setup/initialize` grants the whole catalog to every new tenant's
 * `owner` — so an ordinary tenant owner could swap the dataset served to EVERY
 * other tenant. `awcms_idn_region_datasets` has no `tenant_id` and no RLS; there
 * is no tenant this action belongs to, which is exactly why no tenant permission
 * can express it.
 *
 * ADR-0046 §5 had already reached this conclusion for `idn-regions:import`
 * ("never an HTTP action, so there is no request-time subject for an ABAC guard
 * to evaluate"). Activation is the same class of operation, so it now lives in
 * the same place. See ADR-0052 for the alternatives that were rejected —
 * notably machine credentials, which are read-only by construction (ADR-0049).
 *
 * NOT tenant-scoped: global reference data, so a plain transaction rather than
 * `withTenant` — there is no tenant to scope it to.
 *
 * ## No audit row, and that is a deliberate, documented cost
 *
 * `recordAuditEvent` writes to the tenant-scoped `awcms_audit_events`. The old
 * endpoint wrote its audit row into whichever tenant's log the clicking owner
 * belonged to, which misrepresented a global action as that tenant's and was
 * invisible to every other affected tenant. The durable evidence is on the data
 * itself — `status`, `activated_at`, `activated_by` on
 * `awcms_idn_region_datasets` — plus this command's own output in the operator's
 * shell or CI log. A correct cross-tenant audit needs a global log this base
 * does not have yet (ADR-0052 §Konsekuensi).
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  activateDataset,
  DatasetLifecycleError,
  getActiveDataset,
  listDatasets
} from "../src/modules/idn-admin-regions/application/dataset-lifecycle";

function readFlagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commit = argv.includes("--commit");
  const selector = readFlagValue(argv, "--dataset");

  if (!selector) {
    console.error(
      "idn-regions:activate FAILED — --dataset <code|uuid> is required."
    );
    console.error(
      "  bun run idn-regions:activate -- --dataset <code|uuid> [--commit]"
    );
    process.exitCode = 1;
    return;
  }

  const sql = getWorkerDatabaseClient();

  try {
    // Resolve the selector and print the transition BEFORE writing anything, so
    // the dry run and the commit describe the same decision from the same data.
    const resolved = await sql.begin(async (tx) => {
      const datasets = await listDatasets(tx as Bun.TransactionSQL);
      const active = await getActiveDataset(tx as Bun.TransactionSQL);
      const target =
        datasets.find((dataset) => dataset.id === selector) ??
        datasets.find((dataset) => dataset.datasetCode === selector) ??
        null;
      return { target, active };
    });

    if (!resolved.target) {
      console.error(
        `idn-regions:activate FAILED — no dataset matches "${selector}".`
      );
      process.exitCode = 1;
      return;
    }

    console.log(`target dataset : ${resolved.target.datasetCode}`);
    console.log(`  id           : ${resolved.target.id}`);
    console.log(`  status       : ${resolved.target.status}`);
    console.log(`  rows         : ${resolved.target.rowCount}`);
    console.log(
      `currently active: ${
        resolved.active
          ? `${resolved.active.datasetCode} (${resolved.active.id})`
          : "none"
      }`
    );

    if (resolved.active?.id === resolved.target.id) {
      console.log(
        "already active — nothing to do (activation is idempotent by design)."
      );
      return;
    }

    if (!commit) {
      console.log(
        "dry run OK — nothing written. Re-run with --commit to serve this dataset to every tenant."
      );
      return;
    }

    const result = await sql.begin(async (tx) =>
      // `activatedBy` is null: there is no request-time subject here. The column
      // is nullable precisely because this path has no human to attribute.
      activateDataset(tx as Bun.TransactionSQL, resolved.target!.id, {
        activatedBy: null
      })
    );

    console.log(
      result.changed
        ? `activated ${result.dataset.datasetCode} (${result.dataset.id})` +
            (result.supersededId
              ? ` — superseded ${result.supersededId}`
              : " — no previous active version")
        : `no-op — ${result.dataset.datasetCode} was already active.`
    );
  } catch (error) {
    if (error instanceof DatasetLifecycleError) {
      console.error(`idn-regions:activate FAILED — ${safeErrorDetail(error)}`);
      process.exitCode = 1;
      return;
    }
    logScriptFailure("idn-regions:activate", error);
  }
}

if (import.meta.main) {
  await main();
}
