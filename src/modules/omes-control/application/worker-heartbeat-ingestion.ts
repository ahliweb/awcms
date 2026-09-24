/**
 * `POST /api/v1/omes/worker/heartbeat` ingestion (ahliweb/omes#199).
 *
 * Updates `awcms_omes_servers.last_heartbeat_at` and a redacted evidence
 * blob. Staleness itself is never stored — `domain/staleness.ts`
 * (`isHeartbeatStale`, #198) already computes it as a pure function of `now`
 * on every READ, which is exactly the right shape for "missing evidence
 * never implies healthy": a server that stops heartbeating needs no write at
 * all for every subsequent read to correctly report it stale, because
 * staleness is derived from the age of `last_heartbeat_at`, never from a
 * flag this endpoint would have to remember to flip.
 *
 * A `decommissioned` server is terminal: a heartbeat for one is acknowledged
 * (still authenticates and consumes its nonce) but does NOT resurrect
 * `status`, and the response tells the worker to re-enroll rather than
 * implying it is still in service.
 */
import { redactSensitiveAttributes } from "../../_shared/redaction";

export type WorkerHeartbeatInput = {
  tenantId: string;
  serverId: string;
  reportedStatus: "healthy" | "degraded" | "maintenance";
  omesVersion: string;
  contractVersion: string;
  capabilityRegistryDigest: string;
  platform: { os: string; version: string; arch: string };
  uptimeSeconds: number;
  lastReconciliationAt?: string;
};

const STATUS_FOR_REPORTED: Record<WorkerHeartbeatInput["reportedStatus"], string> = {
  healthy: "online",
  degraded: "degraded",
  maintenance: "maintenance"
};

export type IngestHeartbeatOutcome =
  | { outcome: "acknowledged"; serverStatus: string }
  | { outcome: "re-enroll_required" }
  | { outcome: "unknown_server" };

export async function ingestWorkerHeartbeat(
  tx: Bun.SQL,
  input: WorkerHeartbeatInput,
  now: Date
): Promise<IngestHeartbeatOutcome> {
  const serverRows = (await tx`
    SELECT status FROM awcms_omes_servers
    WHERE tenant_id = ${input.tenantId} AND server_id = ${input.serverId}
  `) as { status: string }[];
  const server = serverRows[0];

  if (!server) {
    return { outcome: "unknown_server" };
  }

  const evidence = redactSensitiveAttributes({
    omesVersion: input.omesVersion,
    contractVersion: input.contractVersion,
    capabilityRegistryDigest: input.capabilityRegistryDigest,
    platform: input.platform,
    uptimeSeconds: input.uptimeSeconds,
    lastReconciliationAt: input.lastReconciliationAt ?? null,
    attributedTo: "omes-host"
  }) ?? {};

  if (server.status === "decommissioned") {
    await tx`
      UPDATE awcms_omes_servers
      SET last_heartbeat_at = ${now}, last_heartbeat_evidence = ${evidence}::jsonb, updated_at = now()
      WHERE tenant_id = ${input.tenantId} AND server_id = ${input.serverId}
    `;

    return { outcome: "re-enroll_required" };
  }

  const nextStatus = STATUS_FOR_REPORTED[input.reportedStatus];

  const updatedRows = (await tx`
    UPDATE awcms_omes_servers
    SET status = ${nextStatus}, last_heartbeat_at = ${now},
        last_heartbeat_evidence = ${evidence}::jsonb, updated_at = now()
    WHERE tenant_id = ${input.tenantId} AND server_id = ${input.serverId}
    RETURNING status
  `) as { status: string }[];

  return { outcome: "acknowledged", serverStatus: updatedRows[0]?.status ?? nextStatus };
}
