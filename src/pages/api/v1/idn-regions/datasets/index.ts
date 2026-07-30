import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../modules/_shared/api-response";
import {
  IDN_ADMIN_REGIONS_MODULE_KEY,
  IDN_DATASET_ACTIVITY_CODE
} from "../../../../../modules/idn-admin-regions/domain/idn-admin-regions-permissions";
import { listDatasets } from "../../../../../modules/idn-admin-regions/application/dataset-lifecycle";
import { IDN_ADMIN_REGIONS_PROVENANCE } from "../../../../../modules/idn-admin-regions/domain/source-provenance";

/**
 * `GET /api/v1/idn-regions/datasets` (ADR-0046) — every imported dataset
 * version, newest first, with the provenance an operator needs to answer "where
 * did this data come from and which decree does it reflect": upstream
 * repository, commit SHA, file checksum, decree reference, row count, and which
 * one is currently `active`.
 *
 * The official-reference caveat travels WITH the data, in the same response
 * body. It is not decoration: anyone reading this endpoint is deciding whether
 * to trust these rows for something official, and the honest answer — this is a
 * community packaging of the decree, not a Kemendagri feed — has to arrive at
 * the same time as the rows, not live only in a document nobody opens.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
    activityCode: IDN_DATASET_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx }) => {
    const datasets = await listDatasets(tx);

    return ok({
      items: datasets,
      activeDatasetCode:
        datasets.find((dataset) => dataset.status === "active")?.datasetCode ??
        null,
      provenance: IDN_ADMIN_REGIONS_PROVENANCE
    });
  }
});
