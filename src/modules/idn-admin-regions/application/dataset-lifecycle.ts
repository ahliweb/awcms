/**
 * Dataset activation and rollback (ADR-0046 §4/§5) — which imported version of
 * Indonesia's administrative hierarchy the platform actually serves.
 *
 * ## The single-active rule lives in the DATABASE
 *
 * `awcms_idn_region_datasets_single_active` (a partial unique index over
 * `status = 'active'`) is what makes "only one dataset is active" true. The code
 * below still supersedes the outgoing dataset FIRST and inside the same
 * transaction — not because the index is optional, but because doing it in the
 * other order makes the index reject the legitimate swap. Two concurrent
 * activations therefore end with one committed and one failed on the unique
 * violation, never with two active datasets.
 *
 * ## Rollback is not "undo the last write"
 *
 * It reactivates the dataset that was active BEFORE the current one — resolved
 * from `activated_at`, the recorded history, not from a client-supplied id. The
 * previous dataset's region rows were never deleted (import writes a new set
 * alongside), so rollback is a status flip rather than a re-import.
 */

import { utcMicrosecondTextSql } from "../../_shared/keyset-pagination";

export type DatasetStatus = "validated" | "active" | "superseded" | "rejected";

export type DatasetSummary = {
  id: string;
  datasetCode: string;
  status: DatasetStatus;
  rowCount: number;
  sourceRepository: string;
  sourceCommitSha: string;
  sourceLicense: string;
  sourceReference: string | null;
  sourceFileSha256: string;
  createdAt: string;
  activatedAt: string | null;
};

export class DatasetLifecycleError extends Error {
  constructor(
    message: string,
    readonly code:
      "DATASET_NOT_FOUND" | "DATASET_NOT_ACTIVATABLE" | "NO_PREVIOUS_DATASET"
  ) {
    super(message);
    this.name = "DatasetLifecycleError";
  }
}

type DatasetRow = {
  id: string;
  dataset_code: string;
  status: DatasetStatus;
  row_count: number;
  source_repository: string;
  source_commit_sha: string;
  source_license: string;
  source_reference: string | null;
  source_file_sha256: string;
  created_at: string;
  activated_at: string | null;
};

/**
 * `created_at`/`activated_at` are rendered as TEXT in the query, never re-parsed
 * into a JS `Date`: `timestamptz` carries microseconds and `Date` truncates to
 * milliseconds, which is exactly how keyset cursors in this repo have lost rows
 * before. Callers get full precision or nothing.
 */
const DATASET_COLUMNS = `
  id,
  dataset_code,
  status,
  row_count,
  source_repository,
  source_commit_sha,
  source_license,
  source_reference,
  source_file_sha256,
  ${utcMicrosecondTextSql("created_at", "Z")} AS created_at,
  ${utcMicrosecondTextSql("activated_at", "Z")} AS activated_at
`;

function toSummary(row: DatasetRow): DatasetSummary {
  return {
    id: row.id,
    datasetCode: row.dataset_code,
    status: row.status,
    rowCount: row.row_count,
    sourceRepository: row.source_repository,
    sourceCommitSha: row.source_commit_sha,
    sourceLicense: row.source_license,
    sourceReference: row.source_reference,
    sourceFileSha256: row.source_file_sha256,
    createdAt: row.created_at,
    activatedAt: row.activated_at
  };
}

/** Every dataset version, newest import first. */
export async function listDatasets(
  sql: Bun.SQL | Bun.TransactionSQL
): Promise<DatasetSummary[]> {
  const rows = (await sql.unsafe(`
    SELECT ${DATASET_COLUMNS}
    FROM awcms_idn_region_datasets
    ORDER BY created_at DESC
  `)) as DatasetRow[];

  return rows.map(toSummary);
}

/** The dataset currently being served, or null when none has been activated. */
export async function getActiveDataset(
  sql: Bun.SQL | Bun.TransactionSQL
): Promise<DatasetSummary | null> {
  const rows = (await sql.unsafe(`
    SELECT ${DATASET_COLUMNS}
    FROM awcms_idn_region_datasets
    WHERE status = 'active'
    LIMIT 1
  `)) as DatasetRow[];

  return rows[0] ? toSummary(rows[0]) : null;
}

/**
 * Activates one dataset by id.
 *
 * Already-active is reported as `changed: false` rather than an error: the route
 * is idempotency-keyed, and a retried activation that lands on the state it
 * asked for succeeded, whatever the network did in between.
 */
export async function activateDataset(
  tx: Bun.TransactionSQL,
  datasetId: string,
  options: { activatedBy?: string | null } = {}
): Promise<{
  dataset: DatasetSummary;
  changed: boolean;
  supersededId: string | null;
}> {
  // FOR UPDATE: the read that decides the transition must hold the row, or two
  // concurrent activations can both read `validated` and both try to write.
  const target = (await tx`
    SELECT id, status FROM awcms_idn_region_datasets
    WHERE id = ${datasetId}
    FOR UPDATE
  `) as { id: string; status: DatasetStatus }[];

  const current = target[0];

  if (!current) {
    throw new DatasetLifecycleError("Dataset not found.", "DATASET_NOT_FOUND");
  }

  if (current.status === "active") {
    const dataset = await getDatasetById(tx, datasetId);
    return { dataset, changed: false, supersededId: null };
  }

  if (current.status !== "validated" && current.status !== "superseded") {
    throw new DatasetLifecycleError(
      `Dataset is ${current.status}; only a validated or superseded dataset can be activated.`,
      "DATASET_NOT_ACTIVATABLE"
    );
  }

  // Vacate the single-active slot BEFORE claiming it — the partial unique index
  // would reject the claim otherwise, turning a legitimate swap into an error.
  const superseded = (await tx`
    UPDATE awcms_idn_region_datasets
    SET status = 'superseded'
    WHERE status = 'active'
    RETURNING id
  `) as { id: string }[];

  await tx`
    UPDATE awcms_idn_region_datasets
    SET status = 'active',
        activated_at = now(),
        activated_by = ${options.activatedBy ?? null}
    WHERE id = ${datasetId}
  `;

  return {
    dataset: await getDatasetById(tx, datasetId),
    changed: true,
    supersededId: superseded[0]?.id ?? null
  };
}

/**
 * Rolls back to the dataset that was active before the current one, resolved
 * from `activated_at` history.
 */
export async function rollbackActiveDataset(
  tx: Bun.TransactionSQL,
  options: { activatedBy?: string | null } = {}
): Promise<{ dataset: DatasetSummary; rolledBackFromId: string | null }> {
  const activeRows = (await tx`
    SELECT id, activated_at FROM awcms_idn_region_datasets
    WHERE status = 'active'
    FOR UPDATE
  `) as { id: string; activated_at: string | null }[];

  const active = activeRows[0];

  const previousRows = (await tx`
    SELECT id
    FROM awcms_idn_region_datasets
    WHERE status = 'superseded'
      AND activated_at IS NOT NULL
      AND (${active?.activated_at ?? null}::timestamptz IS NULL
           OR activated_at < ${active?.activated_at ?? null}::timestamptz)
    ORDER BY activated_at DESC
    LIMIT 1
    FOR UPDATE
  `) as { id: string }[];

  const previousId = previousRows[0]?.id;

  if (!previousId) {
    throw new DatasetLifecycleError(
      "There is no previously activated dataset to roll back to.",
      "NO_PREVIOUS_DATASET"
    );
  }

  if (active) {
    await tx`
      UPDATE awcms_idn_region_datasets
      SET status = 'superseded'
      WHERE id = ${active.id}
    `;
  }

  await tx`
    UPDATE awcms_idn_region_datasets
    SET status = 'active',
        activated_at = now(),
        activated_by = ${options.activatedBy ?? null}
    WHERE id = ${previousId}
  `;

  return {
    dataset: await getDatasetById(tx, previousId),
    rolledBackFromId: active?.id ?? null
  };
}

/** One dataset by id. Throws `DATASET_NOT_FOUND` rather than returning null — every caller here has already established it exists. */
export async function getDatasetById(
  sql: Bun.SQL | Bun.TransactionSQL,
  datasetId: string
): Promise<DatasetSummary> {
  const rows = (await sql.unsafe(
    `SELECT ${DATASET_COLUMNS} FROM awcms_idn_region_datasets WHERE id = $1`,
    [datasetId]
  )) as DatasetRow[];

  const row = rows[0];

  if (!row) {
    throw new DatasetLifecycleError("Dataset not found.", "DATASET_NOT_FOUND");
  }

  return toSummary(row);
}
