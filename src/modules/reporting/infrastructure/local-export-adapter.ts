/**
 * Local/offline export writer (Issue #753) — writes a projection's current
 * metric snapshot to a plain filesystem artifact under
 * `REPORTING_EXPORT_ROOT_PATH` (doc 18), SHA-256 checksummed. Deliberately
 * a small, standalone sibling of `data-lifecycle/infrastructure/local-
 * archive-adapter.ts` rather than an import of it — that file lives under
 * a DIFFERENT module `reporting` declares no `dependencies` edge on (see
 * `reporting/domain/cursor-boundary.ts`'s header comment for the same
 * "avoid a disproportionate cross-module coupling for a small amount of
 * shared code" reasoning), and export rows here (one row per METRIC, not
 * per arbitrary source table row) are a simpler, different shape than
 * that file's generic `Record<string, unknown>[]` archive rows.
 *
 * Called OUTSIDE any DB transaction (ADR-0006-style provider boundary,
 * same "write happens outside the transaction, only the resulting
 * manifest is recorded inside one" shape `data_lifecycle`'s own archive
 * pass uses) even though this is a local filesystem write, not a network
 * call — consistent with treating any I/O-bound external write the same
 * way regardless of provider.
 */
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

export type ExportRow = {
  metricKey: string;
  label: string;
  value: number;
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "string" ? value : String(value);

  // Spreadsheet-formula-injection neutralization: a metric label is
  // code-declared (`ProjectionDescriptor.metricLabels`, never tenant
  // input) so this is defense in depth, not the primary control — still
  // applied unconditionally per this repo's general CSV-export posture.
  const neutralized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }

  return neutralized;
}

function serializeCsv(rows: readonly ExportRow[]): string {
  const header = ["metricKey", "label", "value"].join(",");
  const lines = rows.map((row) =>
    [csvEscape(row.metricKey), csvEscape(row.label), csvEscape(row.value)].join(
      ","
    )
  );
  return [header, ...lines].join("\n");
}

function serializeJson(rows: readonly ExportRow[]): string {
  return JSON.stringify({ rows }, null, 2);
}

function buildArtifactPath(
  rootPath: string,
  tenantId: string,
  projectionKey: string,
  format: "csv" | "json"
): { dir: string; filePath: string } {
  // projectionKey is always "<ownerModuleKey>.<name>" — split, never
  // interpolate the raw key as a single path segment (same defensive
  // convention `local-archive-adapter.ts` established).
  const dir = [rootPath, tenantId, ...projectionKey.split(".")].join("/");
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomUUID()}.${format}`;
  return { dir, filePath: `${dir}/${fileName}` };
}

export type LocalExportWriteResult = {
  storagePath: string;
  checksumSha256: string;
  rowCount: number;
};

export async function writeLocalExportArtifact(
  rootPath: string,
  tenantId: string,
  projectionKey: string,
  format: "csv" | "json",
  rows: readonly ExportRow[]
): Promise<LocalExportWriteResult> {
  const { dir, filePath } = buildArtifactPath(
    rootPath,
    tenantId,
    projectionKey,
    format
  );
  await mkdir(dir, { recursive: true });

  const content = format === "csv" ? serializeCsv(rows) : serializeJson(rows);
  await Bun.write(filePath, content);

  const checksumSha256 = createHash("sha256").update(content).digest("hex");

  return { storagePath: filePath, checksumSha256, rowCount: rows.length };
}

export async function readLocalExportArtifact(
  filePath: string
): Promise<string> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Export artifact not found: ${filePath}`);
  }
  return file.text();
}

/** SHA-256 of `content` — same algorithm `writeLocalExportArtifact` used to compute the manifest's stored checksum, exposed for the download route to REVERIFY against the manifest value rather than trusting it blindly (defense-in-depth against on-disk tampering, security-auditor finding PR #781 — same "verified checksums" posture `data_lifecycle`'s own `ArchivePort.verify` already established). */
export function computeExportArtifactChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
