/**
 * Read-side queries for `GET /api/v1/omes/backups` (list + detail), Issue
 * ahliweb/omes#198. `checksum` is a sha256 digest of the backup manifest
 * (verification evidence, not key material) and is returned as-is; the
 * manifest jsonb body itself is redacted defense-in-depth.
 */
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { redactSensitiveAttributes } from "../../_shared/redaction";

export type BackupSnapshotSummary = {
  id: string;
  backupId: string;
  serverId: string;
  status: string;
  manifest: unknown;
  sizeBytes: number | null;
  checksumSha256: string | null;
  capturedAt: string;
  fresh: boolean;
};

type BackupRow = {
  id: string;
  backup_id: string;
  server_id: string;
  status: string;
  manifest: Record<string, unknown>;
  size_bytes: string | number | null;
  checksum: string | null;
  captured_at: Date;
  created_at: Date;
  created_at_cursor: string;
};

export const BACKUP_LIST_LIMIT = 100;

/** A backup older than this is no longer considered "fresh" for restore/DR planning purposes. */
const BACKUP_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function toSummary(row: BackupRow, now: Date): BackupSnapshotSummary {
  return {
    id: row.id,
    backupId: row.backup_id,
    serverId: row.server_id,
    status: row.status,
    manifest: redactSensitiveAttributes(row.manifest) ?? {},
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    checksumSha256: row.checksum,
    capturedAt: row.captured_at.toISOString(),
    fresh:
      row.status !== "failed" &&
      now.getTime() - row.captured_at.getTime() <=
        BACKUP_FRESHNESS_THRESHOLD_MS
  };
}

export type BackupListPage = {
  backups: BackupSnapshotSummary[];
  nextCursor: string | null;
};

export async function fetchBackups(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  options: { serverId?: string; status?: string; cursor?: KeysetCursor } = {}
): Promise<BackupListPage> {
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const serverIdFilter = options.serverId ?? null;
  const statusFilter = options.status ?? null;

  const rows = (await tx`
    SELECT id, backup_id, server_id, status, manifest, size_bytes, checksum,
           captured_at, created_at,
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_omes_backup_snapshots
    WHERE tenant_id = ${tenantId}
      AND (${serverIdFilter}::text IS NULL OR server_id = ${serverIdFilter})
      AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${BACKUP_LIST_LIMIT}
  `) as BackupRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === BACKUP_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { backups: rows.map((row) => toSummary(row, now)), nextCursor };
}

export async function fetchBackupDetail(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  now: Date
): Promise<BackupSnapshotSummary | null> {
  const rows = (await tx`
    SELECT id, backup_id, server_id, status, manifest, size_bytes, checksum,
           captured_at, created_at, '' AS created_at_cursor
    FROM awcms_omes_backup_snapshots
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as BackupRow[];
  const row = rows[0];

  return row ? toSummary(row, now) : null;
}
