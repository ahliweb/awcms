/**
 * Import pipeline for the vendored Indonesia administrative region dataset
 * (ADR-0046 §5). Runs as the `awcms_worker` role from
 * `bun run idn-regions:import` — never from a request: 91,599 rows behind an
 * HTTP call would be a timeout and abuse surface bought for nothing, since the
 * source file ships inside the image rather than being uploaded.
 *
 * ## Dry run is the DEFAULT, and it is the same code path
 *
 * `plan…` parses, normalizes, validates, and reports; `commit…` runs the exact
 * same planning function and only then writes. There is no second, "quick"
 * validation path that could disagree with the real one — the report an operator
 * approves is produced by the code that does the work.
 *
 * ## Everything or nothing
 *
 * One transaction inserts the dataset row and all of its regions. A half-written
 * hierarchy is worse than no hierarchy: it looks like data and answers queries.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeRegionRows,
  type NormalizedRegion
} from "../domain/region-normalization";
import {
  IDN_ADMIN_REGIONS_DUMP_DECREE_REFERENCE,
  IDN_ADMIN_REGIONS_DUMP_PATH,
  IDN_ADMIN_REGIONS_SOURCE_LICENSE,
  IDN_ADMIN_REGIONS_SOURCE_PATH,
  IDN_ADMIN_REGIONS_SOURCE_REPOSITORY
} from "../domain/source-provenance";
import { parseWilayahDump } from "../domain/wilayah-dump-parser";

/**
 * Rows per `INSERT … SELECT FROM unnest(...)` round trip. 91,599 rows at 5,000
 * per batch is 19 round trips instead of 91,599 — the same batching shape
 * `announcement-directory.ts` uses, for the same reason.
 */
const INSERT_BATCH_SIZE = 5000;

export type DatasetImportPlan = {
  datasetCode: string;
  sourceFile: string;
  sourceFileSha256: string;
  sourceCommitSha: string;
  decreeReference: string;
  rowCount: number;
  countsByType: Record<string, number>;
  /** Blocking problems. A non-empty list means this dataset must NOT be written. */
  errors: string[];
  regions: NormalizedRegion[];
};

/** What lands in `awcms_idn_region_datasets.validation_summary`. */
export type DatasetValidationSummary = {
  rowCount: number;
  countsByType: Record<string, number>;
  sourceFile: string;
  decreeReference: string;
  parsedAt: string;
};

export type DatasetImportResult = {
  datasetId: string;
  datasetCode: string;
  rowCount: number;
  status: "validated";
};

export class DatasetImportError extends Error {
  constructor(
    message: string,
    readonly problems: string[]
  ) {
    super(message);
    this.name = "DatasetImportError";
  }
}

/** sha256 of the exact bytes imported — recorded on the dataset row. */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Dataset code: upstream commit + file checksum prefix. Deterministic on
 * purpose — re-importing the same bytes collides on the unique index instead of
 * quietly creating a second, identical dataset an operator would then have to
 * choose between.
 */
export function deriveDatasetCode(
  commitSha: string,
  fileSha256: string
): string {
  return `wilayah-${commitSha.slice(0, 12)}-${fileSha256.slice(0, 8)}`;
}

/**
 * Parses + normalizes + validates the vendored dump. Pure enough to run in a
 * dry run: reads files, touches no database.
 */
export async function planDatasetImport(options: {
  rootDir?: string;
  dumpPath?: string;
  manifestPath?: string;
}): Promise<DatasetImportPlan> {
  const rootDir = options.rootDir ?? process.cwd();
  const dumpPath = options.dumpPath ?? IDN_ADMIN_REGIONS_DUMP_PATH;
  const manifestPath =
    options.manifestPath ?? "data/idn-admin-regions/manifest.json";

  const errors: string[] = [];
  const dumpBytes = await readFile(path.join(rootDir, dumpPath));
  const fileSha256 = sha256(dumpBytes);

  const manifestRaw = await readFile(path.join(rootDir, manifestPath), "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    upstream?: { commit?: string };
    files?: { path?: string; sha256?: string; decreeReference?: string }[];
  };

  const commitSha = manifest.upstream?.commit ?? "";
  const manifestEntry = (manifest.files ?? []).find(
    (entry) => `data/idn-admin-regions/${entry.path}` === dumpPath
  );

  // The manifest is the provenance record; if the bytes on disk no longer match
  // it, the dataset's recorded origin would be fiction. Refuse rather than
  // import data whose provenance cannot be stated truthfully.
  if (!manifestEntry) {
    errors.push(
      `Manifest ${manifestPath} has no entry for ${dumpPath}; provenance cannot be recorded.`
    );
  } else if (manifestEntry.sha256 !== fileSha256) {
    errors.push(
      `Checksum mismatch for ${dumpPath}: manifest records ${manifestEntry.sha256}, file on disk is ${fileSha256}.`
    );
  }

  if (commitSha.length === 0) {
    errors.push(`Manifest ${manifestPath} records no upstream commit SHA.`);
  }

  const parsed = parseWilayahDump(dumpBytes.toString("utf8"));

  if (parsed.unparsed.length > 0) {
    const sample = parsed.unparsed
      .slice(0, 5)
      .map((entry) => `line ${entry.lineNumber}: ${entry.content}`)
      .join("; ");
    errors.push(
      `${parsed.unparsed.length} line(s) in ${dumpPath} did not match the value grammar (${sample}). Importing would silently drop them.`
    );
  }

  if (parsed.duplicateCodes.length > 0) {
    errors.push(
      `${parsed.duplicateCodes.length} duplicate region code(s) in ${dumpPath}: ${parsed.duplicateCodes.slice(0, 5).join(", ")}.`
    );
  }

  let regions: NormalizedRegion[] = [];

  if (parsed.rows.length > 0) {
    const normalized = normalizeRegionRows(parsed.rows);
    regions = normalized.regions;

    if (normalized.orphanCodes.length > 0) {
      errors.push(
        `${normalized.orphanCodes.length} region(s) reference a parent absent from the file: ${normalized.orphanCodes.slice(0, 5).join(", ")}.`
      );
    }
  } else {
    errors.push(`${dumpPath} produced no region rows at all.`);
  }

  const countsByType: Record<string, number> = {};
  for (const region of regions) {
    countsByType[region.regionType] =
      (countsByType[region.regionType] ?? 0) + 1;
  }

  // A dump without all four tiers is structurally wrong even if every line
  // parsed — most plausibly a truncated or partially-vendored file.
  for (const type of ["province", "regency", "district", "village"]) {
    if ((countsByType[type] ?? 0) === 0) {
      errors.push(
        `No ${type} rows found — the dataset is not a full hierarchy.`
      );
    }
  }

  return {
    datasetCode: deriveDatasetCode(commitSha, fileSha256),
    sourceFile: dumpPath,
    sourceFileSha256: fileSha256,
    sourceCommitSha: commitSha,
    decreeReference:
      manifestEntry?.decreeReference ?? IDN_ADMIN_REGIONS_DUMP_DECREE_REFERENCE,
    rowCount: regions.length,
    countsByType,
    errors,
    regions
  };
}

/**
 * Writes one plan as a new dataset in a single transaction. The new dataset
 * lands as `validated`, NEVER `active`: importing is a deployment step,
 * activating is an audited operator decision (ADR-0046 §5).
 *
 * `tx` is one reserved connection — every statement below is awaited in
 * sequence, never `Promise.all`'d (concurrent queries on one connection desync
 * it and strand the transaction).
 */
export async function commitDatasetImport(
  tx: Bun.TransactionSQL,
  plan: DatasetImportPlan,
  options: { importedBy?: string | null } = {}
): Promise<DatasetImportResult> {
  if (plan.errors.length > 0) {
    throw new DatasetImportError(
      "Refusing to import a dataset that failed validation.",
      plan.errors
    );
  }

  const summary: DatasetValidationSummary = {
    rowCount: plan.rowCount,
    countsByType: plan.countsByType,
    sourceFile: plan.sourceFile,
    decreeReference: plan.decreeReference,
    parsedAt: new Date().toISOString()
  };

  const inserted = (await tx`
    INSERT INTO awcms_idn_region_datasets
      (dataset_code, source_repository, source_path, source_commit_sha,
       source_license, source_reference, source_file_sha256, row_count, status,
       validation_summary, created_by)
    VALUES
      (${plan.datasetCode}, ${IDN_ADMIN_REGIONS_SOURCE_REPOSITORY},
       ${IDN_ADMIN_REGIONS_SOURCE_PATH}, ${plan.sourceCommitSha},
       ${IDN_ADMIN_REGIONS_SOURCE_LICENSE}, ${plan.decreeReference},
       ${plan.sourceFileSha256}, ${plan.rowCount}, 'validated',
       ${summary}, ${options.importedBy ?? null})
    RETURNING id
  `) as { id: string }[];

  const datasetId = inserted[0]?.id;

  if (!datasetId) {
    throw new DatasetImportError("Dataset row insert returned no id.", []);
  }

  for (
    let offset = 0;
    offset < plan.regions.length;
    offset += INSERT_BATCH_SIZE
  ) {
    const chunk = plan.regions.slice(offset, offset + INSERT_BATCH_SIZE);

    await tx`
      INSERT INTO awcms_idn_admin_regions
        (dataset_id, code, code_compact, parent_code, level, region_type,
         local_term, official_name, normalized_name, full_path_code,
         full_path_name, province_code, regency_code, district_code,
         village_code, source_row_hash, metadata)
      SELECT ${datasetId}, t.code, t.code_compact, t.parent_code, t.level,
             t.region_type, t.local_term, t.official_name, t.normalized_name,
             t.full_path_code, t.full_path_name, t.province_code, t.regency_code,
             t.district_code, t.village_code, t.source_row_hash,
             t.metadata::jsonb
      FROM unnest(
        ${tx.array(
          chunk.map((region) => region.code),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.codeCompact),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.parentCode),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.level),
          "int2"
        )},
        ${tx.array(
          chunk.map((region) => region.regionType),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.localTerm),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.officialName),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.normalizedName),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.fullPathCode),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.fullPathName),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.provinceCode),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.regencyCode),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.districtCode),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => region.villageCode),
          "text"
        )},
        ${tx.array(
          chunk.map((region) =>
            createHash("sha256")
              .update(`${region.code} ${region.officialName}`)
              .digest("hex")
          ),
          "text"
        )},
        ${tx.array(
          chunk.map((region) => JSON.stringify(region.metadata)),
          "text"
        )}
      ) AS t(code, code_compact, parent_code, level, region_type, local_term,
             official_name, normalized_name, full_path_code, full_path_name,
             province_code, regency_code, district_code, village_code,
             source_row_hash, metadata)
    `;
  }

  return {
    datasetId,
    datasetCode: plan.datasetCode,
    rowCount: plan.rowCount,
    status: "validated"
  };
}
