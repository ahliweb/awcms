/**
 * Read-side queries for `GET /api/v1/omes/servers` (list + detail), Issue
 * ahliweb/omes#198. Sanitized: enrollment credential evidence is reduced to
 * a fingerprint (never the raw public key material), and staleness is
 * computed from `last_heartbeat_at` rather than stored.
 */
import { createHash } from "node:crypto";

import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { isHeartbeatStale } from "../domain/staleness";

export type ServerEnrollmentEvidence = {
  workerId: string;
  status: string;
  publicKeyFingerprint: string;
  enrolledAt: string | null;
  revokedAt: string | null;
};

export type ServerSummary = {
  id: string;
  serverId: string;
  hostname: string;
  ip: string | null;
  osName: string | null;
  osVersion: string | null;
  arch: string | null;
  status: string;
  tags: unknown;
  lastHeartbeatAt: string | null;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
};

type ServerRow = {
  id: string;
  server_id: string;
  hostname: string;
  ip: string | null;
  os_name: string | null;
  os_version: string | null;
  arch: string | null;
  status: string;
  tags: unknown;
  last_heartbeat_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_at_cursor: string;
};

export type ServerListPage = {
  servers: ServerSummary[];
  nextCursor: string | null;
};

export const SERVER_LIST_LIMIT = 100;

function fingerprintPublicKey(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("hex");
}

export async function fetchServers(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  options: { status?: string; cursor?: KeysetCursor } = {}
): Promise<ServerListPage> {
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const statusFilter = options.status ?? null;

  const rows = (await tx`
    SELECT id, server_id, hostname, ip, os_name, os_version, arch, status, tags,
           last_heartbeat_at, created_at, updated_at,
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_omes_servers
    WHERE tenant_id = ${tenantId}
      AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${SERVER_LIST_LIMIT}
  `) as ServerRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === SERVER_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return {
    servers: rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      hostname: row.hostname,
      ip: row.ip,
      osName: row.os_name,
      osVersion: row.os_version,
      arch: row.arch,
      status: row.status,
      tags: row.tags,
      lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
      stale: isHeartbeatStale(row.last_heartbeat_at, now),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    })),
    nextCursor
  };
}

export type ServerDetail = ServerSummary & {
  enrollments: ServerEnrollmentEvidence[];
};

type EnrollmentRow = {
  worker_id: string;
  status: string;
  public_key: string;
  enrolled_at: Date | null;
  revoked_at: Date | null;
};

export type RegisterServerInput = {
  hostname: string;
  platform: { os: string; version: string; arch: string };
  ip?: string;
  tags?: unknown[];
};

export type RegisterServerOutcome =
  | { outcome: "registered"; server: ServerSummary }
  | { outcome: "already_registered"; server: ServerSummary };

/**
 * `POST /api/v1/omes/servers` (Issue ahliweb/omes#198) — records registration
 * INTENT only (`status = 'offline'`, no heartbeat yet). This never talks to a
 * host; the server only becomes reachable once its pull worker later
 * completes the enrollment-challenge exchange (`ahliweb/omes#199`).
 *
 * Idempotent by natural key: `(tenant_id, server_id)` is already a unique
 * index (sql/154). A retry with the SAME hostname re-derives the SAME
 * deterministic `server_id` (see {@link deriveServerId}) and this function
 * returns the existing row rather than erroring, on top of (not instead of)
 * the route's own `Idempotency-Key` handling.
 */
export async function registerServer(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  input: RegisterServerInput
): Promise<RegisterServerOutcome> {
  const serverId = deriveServerId(input.hostname);

  const existingRows = (await tx`
    SELECT id, server_id, hostname, ip, os_name, os_version, arch, status, tags,
           last_heartbeat_at, created_at, updated_at
    FROM awcms_omes_servers
    WHERE tenant_id = ${tenantId} AND server_id = ${serverId}
  `) as Omit<ServerRow, "created_at_cursor">[];
  const existing = existingRows[0];

  if (existing) {
    return {
      outcome: "already_registered",
      server: toServerSummary(existing, now)
    };
  }

  const insertedRows = (await tx`
    INSERT INTO awcms_omes_servers
      (tenant_id, server_id, hostname, ip, os_name, os_version, arch, status, tags)
    VALUES (
      ${tenantId}, ${serverId}, ${input.hostname}, ${input.ip ?? null},
      ${input.platform.os}, ${input.platform.version}, ${input.platform.arch},
      'offline', ${input.tags ?? []}::jsonb
    )
    RETURNING id, server_id, hostname, ip, os_name, os_version, arch, status, tags,
      last_heartbeat_at, created_at, updated_at
  `) as Omit<ServerRow, "created_at_cursor">[];

  return {
    outcome: "registered",
    server: toServerSummary(insertedRows[0]!, now)
  };
}

/** Deterministic, stable-across-retries `server_id` derived from hostname. */
function deriveServerId(hostname: string): string {
  return createHash("sha256")
    .update(hostname.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

function toServerSummary(
  row: Omit<ServerRow, "created_at_cursor">,
  now: Date
): ServerSummary {
  return {
    id: row.id,
    serverId: row.server_id,
    hostname: row.hostname,
    ip: row.ip,
    osName: row.os_name,
    osVersion: row.os_version,
    arch: row.arch,
    status: row.status,
    tags: row.tags,
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
    stale: isHeartbeatStale(row.last_heartbeat_at, now),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export type DecommissionServerOutcome =
  | { outcome: "decommissioned"; server: ServerSummary }
  | { outcome: "not_found" }
  | { outcome: "already_decommissioned"; server: ServerSummary };

/**
 * `DELETE /api/v1/omes/servers/{id}` (Issue ahliweb/omes#198) — soft delete
 * (doc 10's "Soft delete for deletable resources"): flips `status` to
 * `decommissioned` rather than removing the row, since enrollment/job/audit
 * history keeps referencing this server's `server_id` by value, not by FK.
 * Naturally idempotent: decommissioning an already-decommissioned server
 * returns its current state rather than erroring.
 */
export async function decommissionServer(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  now: Date
): Promise<DecommissionServerOutcome> {
  const existingRows = (await tx`
    SELECT id, server_id, hostname, ip, os_name, os_version, arch, status, tags,
           last_heartbeat_at, created_at, updated_at
    FROM awcms_omes_servers
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as Omit<ServerRow, "created_at_cursor">[];
  const existing = existingRows[0];

  if (!existing) {
    return { outcome: "not_found" };
  }

  if (existing.status === "decommissioned") {
    return {
      outcome: "already_decommissioned",
      server: toServerSummary(existing, now)
    };
  }

  const updatedRows = (await tx`
    UPDATE awcms_omes_servers
    SET status = 'decommissioned', updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING id, server_id, hostname, ip, os_name, os_version, arch, status, tags,
      last_heartbeat_at, created_at, updated_at
  `) as Omit<ServerRow, "created_at_cursor">[];

  return {
    outcome: "decommissioned",
    server: toServerSummary(updatedRows[0]!, now)
  };
}

export async function fetchServerDetail(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  now: Date
): Promise<ServerDetail | null> {
  const serverRows = (await tx`
    SELECT id, server_id, hostname, ip, os_name, os_version, arch, status, tags,
           last_heartbeat_at, created_at, updated_at
    FROM awcms_omes_servers
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as Omit<ServerRow, "created_at_cursor">[];
  const server = serverRows[0];

  if (!server) {
    return null;
  }

  const enrollmentRows = (await tx`
    SELECT worker_id, status, public_key, enrolled_at, revoked_at
    FROM awcms_omes_enrollments
    WHERE tenant_id = ${tenantId} AND server_id = ${server.server_id}
    ORDER BY created_at DESC
  `) as EnrollmentRow[];

  return {
    id: server.id,
    serverId: server.server_id,
    hostname: server.hostname,
    ip: server.ip,
    osName: server.os_name,
    osVersion: server.os_version,
    arch: server.arch,
    status: server.status,
    tags: server.tags,
    lastHeartbeatAt: server.last_heartbeat_at?.toISOString() ?? null,
    stale: isHeartbeatStale(server.last_heartbeat_at, now),
    createdAt: server.created_at.toISOString(),
    updatedAt: server.updated_at.toISOString(),
    enrollments: enrollmentRows.map((row) => ({
      workerId: row.worker_id,
      status: row.status,
      publicKeyFingerprint: fingerprintPublicKey(row.public_key),
      enrolledAt: row.enrolled_at?.toISOString() ?? null,
      revokedAt: row.revoked_at?.toISOString() ?? null
    }))
  };
}
