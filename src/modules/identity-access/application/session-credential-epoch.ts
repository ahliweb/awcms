/**
 * The ONE definition of "this session was minted under the credential that is
 * in force now" — finding A5 of the 17 August 2026 audit round, sql/144.
 *
 * A password reset replaces the credential for the whole PRINCIPAL (ADR-0086:
 * one human, one credential) but can only revoke sessions inside the tenant the
 * reset happened in, because `awcms_sessions` is FORCE RLS and the transaction
 * is scoped to one tenant. Every other tenant's sessions survived a credential
 * change their holder did not make. `sql/144`'s header explains why an epoch,
 * rather than a wider revoke, is the fix.
 *
 * ## Why this is a fragment and not seven predicates
 *
 * Eight files read `awcms_sessions`, and seven of them decide, on their own,
 * whether a row is a live session. That is precisely the shape ADR-0079 wrote
 * down after `activeRoleGrants`: when the WRITER moved to a new table, five
 * readers kept answering about the old one, silently, and each read as correct.
 * A per-file `AND ... credential_epoch ...` would be the same arrangement with a
 * different column — the next author adds a session reader, writes the three
 * predicates they can see (`revoked_at`, `expires_at`, `tenant_id`), and the
 * fourth one is invisible because nothing in the file mentions it.
 *
 * So it is emitted here, once, and `scripts/session-readers-check.ts` fails the
 * build for a live-session reader that does not embed it.
 *
 * ```ts
 * const rows = await tx`
 *   SELECT s.id, s.identity_id
 *   FROM awcms_sessions s
 *   WHERE s.tenant_id = ${tenantId}
 *     AND s.token_hash = ${tokenHash}
 *     AND s.revoked_at IS NULL
 *     AND s.expires_at > ${now}
 *     AND ${sessionCredentialCurrent(tx)}
 * `;
 * ```
 *
 * Bun.SQL splices a nested tagged template into the outer statement as SQL, so
 * this stays ONE query and the readers' bounded-query-count promise is
 * unchanged. That is the same mechanism `grant-source.ts` relies on, and the
 * same reason a database view was rejected there: the SQL that reaches Postgres
 * is the SQL the reader would have written, so FORCE RLS applies exactly as
 * before.
 *
 * ## The alias contract
 *
 * The fragment correlates on `s.identity_id` and `s.credential_epoch`, so the
 * session table MUST be aliased `s` in the reader. That is a real constraint and
 * it is checked: a reader on the gate's live list that does not alias `s` fails
 * the build with the reason, rather than producing a Postgres error at runtime
 * on a path only an expired credential reaches. Passing the alias in as a
 * parameter was the alternative and it is worse — an identifier interpolated
 * into SQL by hand is the one thing this codebase does not do anywhere else.
 */

/**
 * A SQL comment carried by every fragment in this file, and it earns its place
 * twice.
 *
 * In production it lands in `pg_stat_statements` and in any `EXPLAIN`, so an
 * operator looking at a session query can see that the epoch check is part of
 * the plan rather than wondering where a join to `awcms_principals` came from.
 *
 * Exported for the fakes, and written LITERALLY into each template rather than
 * interpolated: `${…}` inside a tagged template binds a parameter, so
 * interpolating it would send `$1` to Postgres where a comment was meant.
 *
 * In tests it is the only honest way for a fake `Bun.SQL` to tell a FRAGMENT
 * apart from a STATEMENT. Both arrive as a call to the same tagged template;
 * real Bun.SQL splices the first into the outer statement and executes the
 * second, and a recording fake sees one indistinguishable call. Without a
 * marker those fakes would count two queries where Postgres runs one — the test
 * would then be asserting something false about the system, which is worse than
 * asserting nothing.
 */
export const SESSION_EPOCH_FRAGMENT_MARKER =
  "/* awcms:fragment session-credential-epoch */";

/**
 * True when the session row aliased `s` is still backed by the credential its
 * principal holds now.
 *
 * Three reasons it can be true, and all three are deliberate:
 *
 *  - the epochs match — the ordinary case;
 *  - the identity has no `principal_id` (the link is nullable by design,
 *    sql/112) — there is no global credential to be behind, and the
 *    tenant-scoped revocation is that identity's whole guarantee, unchanged;
 *  - the session predates sql/144 and its stamp is NULL — read as 0, so the
 *    first credential change after deployment leaves it behind and kills it.
 *
 * `NOT EXISTS` rather than a JOIN because it must not multiply the outer row,
 * must not require the outer query to project the epoch, and must be safe to
 * drop into a `WHERE` that already has an `ORDER BY`/`RETURNING` after it.
 */
export function sessionCredentialCurrent(tx: Bun.SQL) {
  return tx`
    /* awcms:fragment session-credential-epoch */
    NOT EXISTS (
      SELECT 1
      FROM awcms_identities ci
      JOIN awcms_principals cp ON cp.id = ci.principal_id
      WHERE ci.id = s.identity_id
        AND ci.tenant_id = s.tenant_id
        AND cp.credential_epoch > COALESCE(s.credential_epoch, 0)
    )
  `;
}

/**
 * The epoch a session minted RIGHT NOW must carry, as a scalar subquery.
 *
 * A fragment rather than a value the caller resolves and passes, for the same
 * reason the bump lives inside `setPrincipalCredential`: there are two INSERT
 * sites today (`login.ts` for the password path, `createSessionWithAssurance`
 * for MFA/SSO/handoff/switch/step-up) and a third one is a matter of time. A
 * caller that forgets the column mints a session stamped NULL, which reads as
 * epoch 0 — permanently stale for anyone who has ever reset a password, so that
 * account silently cannot stay signed in. A caller that forgets a subquery it
 * never had to write cannot happen.
 *
 * `LEFT JOIN` + `COALESCE(..., 0)`: an identity with no `principal_id` yields 0
 * rather than no row, so the INSERT never writes NULL by accident and the value
 * means the same thing as an unstamped legacy row.
 */
export function currentCredentialEpoch(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
) {
  return tx`
    /* awcms:fragment session-credential-epoch */
    (SELECT COALESCE(ep.credential_epoch, 0)
     FROM awcms_identities ei
     LEFT JOIN awcms_principals ep ON ep.id = ei.principal_id
     WHERE ei.id = ${identityId} AND ei.tenant_id = ${tenantId})
  `;
}
