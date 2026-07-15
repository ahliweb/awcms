const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Expected a UUID, received: ${value}`);
  }

  return value;
}

/**
 * Runs `fn` inside a tenant-scoped transaction: sets the RLS session
 * variable (`SET LOCAL`, safe under PgBouncer transaction pooling — never a
 * plain session `SET`) before `fn` runs any query. RLS is a second line of
 * defense — every query must still explicitly filter `tenant_id`.
 */
export async function withTenant<T>(
  sql: Bun.SQL,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  const safeTenantId = assertUuid(tenantId);

  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${safeTenantId}'`);

    return fn(tx);
  });
}
