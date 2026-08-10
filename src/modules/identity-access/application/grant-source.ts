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
 * ## The scope columns
 *
 * PR 3.3 projected only `(tenant_user_id, role_id)`, because every grant written
 * then was tenant-wide and a column that is always `'tenant'` teaches its readers
 * a shape they do not yet have. ADR-0080 gave them a reader:
 * `resolveBusinessScopeFacts` turns a NON-tenant-wide grant into a
 * scope-qualified fact. Every other reader ignores the two extra columns, which
 * is exactly why they belong here rather than in a second, nearly-identical
 * fragment that could disagree with this one about what "in force" means.
 */

/**
 * The tables a live role grant can be reached through.
 *
 * `awcms_access_assignments` is deliberately absent: `sql/103` made it read-only
 * history, so a reader that still named it would be reading rows no writer can
 * add to and no revocation can remove from.
 *
 * The two group tables joined it in ADR-0081, and that they are LISTED rather
 * than merely joined is the point: membership is now part of the answer to "what
 * has been granted to whom", so a change to it is a change to authorization.
 *
 * `access:grant-readers:check` keeps the file-level allow-list; this constant is
 * what the readers themselves share, and `tests/grant-source-parity.test.ts`
 * pins that they do.
 */
export const GRANT_SOURCE_TABLES: readonly string[] = [
  "awcms_access_policies",
  "awcms_user_groups",
  "awcms_user_group_members"
];

/**
 * The `(tenant_user_id, role_id, scope_type, scope_id)` grants in force in
 * `tenantId` at the database's transaction clock — held DIRECTLY or through a
 * group the subject belongs to.
 *
 * Effective dating is evaluated with `now()` IN THE DATABASE rather than against
 * a caller-supplied clock, for the reason ADR-0078 records: a grant that expires
 * according to the application's idea of the time is a grant an application bug
 * can extend. `now()` is the transaction start instant, so one authorization
 * decision never sees two different times.
 *
 * ## Why the group branch belongs HERE and not in each reader
 *
 * A group grants a ROLE (ADR-0081), so group membership has to reach every
 * reader that asks what roles a subject holds — `subject.roles`, the permission
 * keys, the SoD facts, the admin listing, the last-administrator guard. Adding
 * it in one place adds it to all of them in one commit; adding it per reader is
 * the drift ADR-0079 is a record of, except that this time the readers that
 * missed it would be the ones that keep a DENY policy working.
 *
 * `UNION ALL` rather than `UNION`: a subject can hold the same role directly and
 * through a group, and every consumer already de-duplicates what it needs to
 * (`SELECT DISTINCT` on the key/role-code reads, `EXISTS` on the membership
 * ones). Paying for a sort here to spare them nothing would be paying on the
 * authorization path.
 *
 * A soft-deleted group grants nothing — `deleted_at IS NULL` — which is what
 * makes deleting a group a revocation rather than a rename with side effects.
 *
 * Returns a Bun.SQL query object used ONLY as an embedded fragment. Awaiting it
 * directly would run the whole tenant's grants, which no caller wants; every
 * caller filters it in the statement it is spliced into.
 */
export function activeRoleGrants(tx: Bun.SQL, tenantId: string) {
  return tx`
    SELECT ap.tenant_user_id, ap.role_id, ap.scope_type, ap.scope_id
    FROM awcms_access_policies ap
    WHERE ap.tenant_id = ${tenantId}
      AND ap.subject_type = 'tenant_user'
      AND ap.status = 'active'
      AND ap.effective_from <= now()
      AND (ap.effective_to IS NULL OR ap.effective_to > now())
    UNION ALL
    SELECT m.tenant_user_id, ap.role_id, ap.scope_type, ap.scope_id
    FROM awcms_access_policies ap
    JOIN awcms_user_groups gr
      ON gr.id = ap.user_group_id AND gr.tenant_id = ap.tenant_id
      AND gr.deleted_at IS NULL
    JOIN awcms_user_group_members m
      ON m.user_group_id = gr.id AND m.tenant_id = gr.tenant_id
    WHERE ap.tenant_id = ${tenantId}
      AND ap.subject_type = 'user_group'
      AND ap.status = 'active'
      AND ap.effective_from <= now()
      AND (ap.effective_to IS NULL OR ap.effective_to > now())
  `;
}
