/** SQLSTATE 23505. Bun.SQL carries it on `errno`, not `code`. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Bun.SQL.PostgresError && String(error.errno) === "23505"
  );
}

/** SQLSTATE 23514 (a CHECK or a guard trigger refused the write). */
export function isCheckViolation(error: unknown): boolean {
  return (
    error instanceof Bun.SQL.PostgresError && String(error.errno) === "23514"
  );
}
