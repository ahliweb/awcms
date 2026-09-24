/**
 * Atomic nonce/replay consumption for the worker endpoints
 * (ahliweb/omes#199). Mirrors `modules/_shared/idempotency.ts`'s
 * `saveIdempotencyRecord` pattern exactly: a single
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING id`, decided purely by
 * `rows.length`, never by catching a unique-violation error. That distinction
 * matters here specifically because comparing `error.code` directly to a
 * unique-violation SQLSTATE never fires on this driver (Bun.SQL surfaces the
 * Postgres SQLSTATE on `error.errno`, not `error.code`), so a
 * "catch the conflict" implementation would silently never catch it and let
 * every replay through the "already used" branch as dead code.
 */
export type ConsumeNonceOutcome = "consumed" | "replayed";

export async function consumeWorkerNonce(
  tx: Bun.SQL,
  tenantId: string,
  serverId: string,
  workerId: string,
  nonce: string,
  route: "poll" | "result" | "heartbeat",
  now: Date,
  retentionMs: number
): Promise<ConsumeNonceOutcome> {
  const expiresAt = new Date(now.getTime() + retentionMs);

  const rows = (await tx`
    INSERT INTO awcms_omes_worker_nonces
      (tenant_id, server_id, worker_id, nonce, route, created_at, expires_at)
    VALUES (
      ${tenantId}, ${serverId}, ${workerId}, ${nonce}, ${route}, ${now}, ${expiresAt}
    )
    ON CONFLICT (tenant_id, worker_id, nonce) DO NOTHING
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0 ? "consumed" : "replayed";
}
