/**
 * The ONE definition of "which role grants are in force right now" (ADR-0079,
 * Gelombang 3 PR 3.3 of #423).
 *
 * Before this file, nine SQL statements in seven files each wrote their own
 * version of that join, and every one of them named `awcms_access_assignments`
 * directly. When PR 3.2 moved the writer to `awcms_access_policies`, five of
 * them kept reading the old table and therefore kept answering about a table
 * nothing writes any more — silently, because each still returned rows for
 * tenants created before that PR. What that cost is written down in ADR-0079;
 * the shortest version is that a freshly bootstrapped tenant's owner held every
 * permission and yet had NO roles according to `GET /api/v1/auth/session`, the
 * admin user list, SoD, and the guard that refuses to deactivate the last
 * administrator.
 *
 * So the join stops being something a reader writes. It is emitted here, once,
 * and every reader embeds it as a subquery:
 *
 * ```ts
 * const rows = await tx`
 *   SELECT r.role_code
 *   FROM (${activeRoleGrants(tx, tenantId)}) g
 *   JOIN awcms_roles r ON r.id = g.role_id AND r.tenant_id = ${tenantId}
 *   WHERE g.tenant_user_id = ${tenantUserId} AND r.deleted_at IS NULL
 * `;
 * ```
 *
 * Bun.SQL splices a nested tagged template into the outer statement as SQL
 * (parameters keep their positions), so this stays ONE query — the readers'
 * bounded-query-count promise is unchanged.
 *
 * ## Why a fragment rather than a view
 *
 * A database view would also be one definition, but the repo has none, and the
 * first one would have to answer questions this change should not be answering
 * at the same time: `security_invoker` (without it a view runs as its owner and
 * bypasses the FORCE RLS on the table beneath it — the isolation would be gone
 * and every existing RLS test would still pass), the privilege grants, and what
 * `security-readiness`'s table sweeps make of a relation that is not a table.
 * A fragment needs none of that: the SQL that reaches Postgres is the same SQL
 * the reader would have written, so RLS applies exactly as before.
 *
 * ## What is deliberately NOT here
 *
 * The subject's SCOPES. `activeRoleGrants` answers "does this subject hold this
 * role" and nothing narrower — `scope_type`/`scope_id` are not projected,
 * because every grant written today is tenant-wide and a column that is always
 * `'tenant'` teaches its readers a shape it does not yet have. Scope arrives at
 * evaluation time in PR 3.4, through `BusinessScopeFact`, and this is where the
 * projection widens when it does.
 */

/**
 * The tables a live role grant can live in.
 *
 * ONE entry, and that is the point of PR 3.3: `awcms_access_assignments` was
 * removed from this list by the migration that made it read-only history
 * (`sql/103`), so a reader that still named it would be reading rows no writer
 * can add to and no revocation can remove from.
 *
 * `access:grant-readers:check` keeps the file-level allow-list; this constant is
 * what the readers themselves share, and `tests/grant-source-parity.test.ts`
 * pins that they do.
 */
export const GRANT_SOURCE_TABLES: readonly string[] = ["awcms_access_policies"];

/**
 * The `(tenant_user_id, role_id)` grants in force in `tenantId` at the database's
 * transaction clock.
 *
 * Effective dating is evaluated with `now()` IN THE DATABASE rather than against
 * a caller-supplied clock, for the reason ADR-0078 records: a grant that expires
 * according to the application's idea of the time is a grant an application bug
 * can extend. `now()` is the transaction start instant, so one authorization
 * decision never sees two different times.
 *
 * Returns a Bun.SQL query object used ONLY as an embedded fragment. Awaiting it
 * directly would run `SELECT tenant_user_id, role_id` for the whole tenant,
 * which no caller wants; every caller filters it in the statement it is spliced
 * into.
 */
export function activeRoleGrants(tx: Bun.SQL, tenantId: string) {
  return tx`
    SELECT ap.tenant_user_id, ap.role_id
    FROM awcms_access_policies ap
    WHERE ap.tenant_id = ${tenantId}
      AND ap.status = 'active'
      AND ap.effective_from <= now()
      AND (ap.effective_to IS NULL OR ap.effective_to > now())
  `;
}
