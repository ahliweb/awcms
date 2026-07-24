/**
 * Local/offline archive adapter (ported from awcms-micro Issue #745, ADR-0037) —
 * the DEFAULT `ArchivePort` implementation, writing archive artifacts to a plain
 * filesystem directory (`DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`, doc 18). Works fully
 * offline/LAN, no external dependency, matching doc 15's offline-first rule.
 *
 * Layout: `<rootPath>/<tenantId>/<ownerModuleKey>/<tableShortName>/
 * <cursorRangeStartIso>_<cursorRangeEndIso>_<uuid>.<ext>` — tenant-first (mirrors
 * this repo's DB index convention), then owner/table so an operator can find a
 * specific descriptor's archives without scanning every tenant directory. A
 * random uuid suffix guarantees no filename collision even for two archive
 * passes covering an overlapping/adjacent range (e.g. after a retry).
 *
 * Row serialization is intentionally minimal (no per-column type schema) —
 * `write`'s caller already has the exact `Record<string, unknown>[]` read from
 * Postgres via a plain `SELECT *`-shaped query, and `read`'s caller is
 * reconciliation/restore tooling that re-parses JSON/CSV text, not a typed ORM.
 * See this module's README §Limitations: values coming back from `read()` are the
 * JSON/CSV-native types (string/number/boolean/null/object), NOT re-cast to their
 * original Postgres column type (e.g. a `timestamptz` column round-trips as an
 * ISO string, not a `Date`) — a real restore-into-a-table procedure must re-cast
 * per column, documented explicitly rather than silently assumed exact.
 */
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type {
  ArchivePort,
  ArchiveWriteInput,
  ArchiveWriteResult
} from "../domain/archive-port";

export const LOCAL_ARCHIVE_RESTORE_PROCEDURE_REF =
  "src/modules/data-lifecycle/README.md#restore-procedure-local-offline-archive";

function isoOrEpoch(date: Date | null): string {
  return (date ?? new Date(0)).toISOString().replace(/[:.]/g, "-");
}

function descriptorDirSegments(descriptorKey: string): string[] {
  // descriptorKey is always "<ownerModuleKey>.<tableShortName>"
  // (`lifecycle-registry.ts`'s `DESCRIPTOR_KEY_PATTERN`) — split, never
  // interpolate the raw key as a single path segment, so a future descriptor key
  // containing an unexpected character can't produce a surprising path.
  return descriptorKey.split(".");
}

function buildArtifactPath(
  rootPath: string,
  tenantId: string,
  descriptorKey: string,
  cursorRangeStart: Date | null,
  cursorRangeEnd: Date | null,
  format: "jsonl" | "csv"
): { dir: string; filePath: string } {
  const dir = [
    rootPath,
    tenantId,
    ...descriptorDirSegments(descriptorKey)
  ].join("/");
  const fileName = `${isoOrEpoch(cursorRangeStart)}_${isoOrEpoch(cursorRangeEnd)}_${crypto.randomUUID()}.${format}`;

  return { dir, filePath: `${dir}/${fileName}` };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    typeof value === "string"
      ? value
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function serializeJsonl(rows: readonly Record<string, unknown>[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

function serializeCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const columns = Object.keys(rows[0]!);
  const header = columns.map(csvEscape).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => csvEscape(row[column])).join(",")
  );

  return [header, ...lines].join("\n");
}

function deserializeJsonl(content: string): Record<string, unknown>[] {
  if (content.trim().length === 0) {
    return [];
  }

  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Minimal RFC4180-ish CSV parser matching `serializeCsv`'s own escaping —
 * sufficient for round-tripping artifacts this SAME adapter wrote, not a
 * general-purpose CSV parser for arbitrary external files.
 *
 * Parses the WHOLE document in one pass (never pre-splits on `\n` first) —
 * `serializeCsv`'s own `csvEscape` deliberately allows a literal newline inside a
 * quoted field (matching RFC4180), so a line-based pre-split would incorrectly
 * cut a single row in two wherever an archived value happens to contain `\n`.
 * Quote state is tracked across the entire input; only an UNQUOTED `\n` ends a
 * row.
 */
function parseCsvDocument(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      // Bare CR outside quotes: ignore, the following LF (if any) ends the row.
      index += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Final row with no trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function deserializeCsv(content: string): Record<string, unknown>[] {
  if (content.trim().length === 0) {
    return [];
  }

  const rows = parseCsvDocument(content);
  const header = rows[0]!;

  return rows.slice(1).map((fields) => {
    const row: Record<string, unknown> = {};

    header.forEach((column, index) => {
      row[column] = fields[index] === "" ? null : fields[index];
    });

    return row;
  });
}

function detectFormatFromPath(path: string): "jsonl" | "csv" {
  return path.endsWith(".csv") ? "csv" : "jsonl";
}

export function createLocalArchiveAdapter(rootPath: string): ArchivePort {
  return {
    kind: "local_offline",

    async write(input: ArchiveWriteInput): Promise<ArchiveWriteResult> {
      const { dir, filePath } = buildArtifactPath(
        rootPath,
        input.tenantId,
        input.descriptorKey,
        input.cursorRangeStart,
        input.cursorRangeEnd,
        input.format
      );

      await mkdir(dir, { recursive: true });

      const content =
        input.format === "csv"
          ? serializeCsv(input.rows)
          : serializeJsonl(input.rows);

      await Bun.write(filePath, content);

      const checksumHex = createHash("sha256").update(content).digest("hex");

      return {
        artifactLocation: filePath,
        checksumHex,
        rowCount: input.rows.length,
        restoreProcedureRef: LOCAL_ARCHIVE_RESTORE_PROCEDURE_REF
      };
    },

    async verify(
      artifactLocation: string,
      expectedChecksumHex: string
    ): Promise<boolean> {
      const file = Bun.file(artifactLocation);

      if (!(await file.exists())) {
        return false;
      }

      const content = await file.text();
      const checksumHex = createHash("sha256").update(content).digest("hex");

      return checksumHex === expectedChecksumHex;
    },

    async read(artifactLocation: string): Promise<Record<string, unknown>[]> {
      const file = Bun.file(artifactLocation);

      if (!(await file.exists())) {
        throw new Error(`Archive artifact not found: ${artifactLocation}`);
      }

      const content = await file.text();
      const format = detectFormatFromPath(artifactLocation);

      return format === "csv"
        ? deserializeCsv(content)
        : deserializeJsonl(content);
    }
  };
}
