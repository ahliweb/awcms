/**
 * The ONLY file that reads or writes `awcms_principals` — ADR-0085, Gelombang 7
 * PR 7.1 of Issue #423.
 *
 * That exclusivity is not a convention. `bun run identity:principal-access:check`
 * enforces it, and it is control 2 of the four that stand in for RLS on this
 * table: **RLS bounds which ROWS a query may see; that gate bounds which CALL
 * SITES may issue one at all.**
 *
 * ## Two shapes, and the reason for the split
 *
 * `password_hash` is returned by exactly one function — `loadPrincipalSecret` —
 * and that function's result must never be spread into a response, an event, a
 * log line, or another module's type. Every other reader gets
 * `PrincipalIdentity`, which does not carry the field at all, so the ordinary
 * way to use this module is also the safe one. That is control 3: the projection
 * invariant is a TYPE, not a review habit.
 *
 * ## Every query is keyed, and unbounded reads are impossible by construction
 *
 * There is no `listPrincipals`, no search, no pagination, and no `LIKE`. A
 * credential table with a scan is a credential table with an enumeration
 * endpoint one refactor away. The gate rejects any query here that is not keyed
 * on `id =` or `email_normalized =`, so adding one is a red build rather than a
 * review comment.
 *
 * ## Holding a principal grants NOTHING
 *
 * A principal is an AUTHENTICATION fact, never an AUTHORIZATION fact. Nothing in
 * this file resolves a permission, a role, or a tenant membership, and nothing
 * ever should: authorization stays on `awcms_tenant_users` under FORCE RLS,
 * reached through the chokepoint. If a future reader wants "what may this
 * principal do", the answer is that the question is malformed — a principal does
 * not act; a tenant user does.
 */

/** What every ordinary reader gets. Deliberately WITHOUT `password_hash`. */
export type PrincipalIdentity = {
  id: string;
  emailNormalized: string;
  /** Whether a credential has been promoted yet (PR 7.2). Never the hash itself. */
  hasCredential: boolean;
};

type PrincipalRow = {
  id: string;
  email_normalized: string;
  password_hash: string | null;
};

function toIdentity(row: PrincipalRow): PrincipalIdentity {
  return {
    id: row.id,
    emailNormalized: row.email_normalized,
    hasCredential: row.password_hash !== null
  };
}

/**
 * The normalization rule, restated here so this module has no import cycle with
 * the census domain — and asserted equal to it by
 * `tests/principal-store.test.ts`, so the two cannot drift.
 *
 * `lower(btrim(...))` is also what `sql/112`'s CHECK constraint enforces, which
 * means a value this function did not produce is rejected by the database
 * rather than stored in a shape nothing can look up.
 */
export function normalizePrincipalEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Keyed on `email_normalized =`. */
export async function findPrincipalByEmail(
  tx: Bun.SQL,
  email: string
): Promise<PrincipalIdentity | null> {
  const normalized = normalizePrincipalEmail(email);

  const rows = (await tx`
    SELECT id, email_normalized, password_hash
    FROM awcms_principals
    WHERE email_normalized = ${normalized}
  `) as PrincipalRow[];

  return rows[0] ? toIdentity(rows[0]) : null;
}

/** Keyed on `id =`. */
export async function findPrincipalById(
  tx: Bun.SQL,
  principalId: string
): Promise<PrincipalIdentity | null> {
  const rows = (await tx`
    SELECT id, email_normalized, password_hash
    FROM awcms_principals
    WHERE id = ${principalId}
  `) as PrincipalRow[];

  return rows[0] ? toIdentity(rows[0]) : null;
}

/**
 * The one function that returns the hash.
 *
 * Named so the call site reads as what it is. Its result is intended for a
 * single consumer — the password verification step of the login path (PR 7.2) —
 * and must not be stored, logged, or returned. There is no type-level way to
 * enforce "do not persist this string" in TypeScript; what IS enforced is that
 * no other file may call it, because no other file may name this table.
 */
export async function loadPrincipalSecret(
  tx: Bun.SQL,
  principalId: string
): Promise<{ passwordHash: string | null } | null> {
  const rows = (await tx`
    SELECT id, email_normalized, password_hash
    FROM awcms_principals
    WHERE id = ${principalId}
  `) as PrincipalRow[];

  return rows[0] ? { passwordHash: rows[0].password_hash } : null;
}

/**
 * Creates the principal for an address if it does not exist, and returns it
 * either way.
 *
 * `ON CONFLICT DO NOTHING` plus a re-read rather than `DO UPDATE ... RETURNING`:
 * an UPDATE here would touch `password_hash`'s row under concurrency, and the
 * one thing this function must never do is disturb a credential while trying to
 * ensure a row exists. Two concurrent registrations of the same address
 * therefore converge on one principal with neither writing a secret.
 */
export async function ensurePrincipalForEmail(
  tx: Bun.SQL,
  email: string
): Promise<PrincipalIdentity> {
  const normalized = normalizePrincipalEmail(email);

  await tx`
    INSERT INTO awcms_principals (email_normalized)
    VALUES (${normalized})
    ON CONFLICT (email_normalized) DO NOTHING
  `;

  const rows = (await tx`
    SELECT id, email_normalized, password_hash
    FROM awcms_principals
    WHERE email_normalized = ${normalized}
  `) as PrincipalRow[];

  const row = rows[0];

  if (!row) {
    // Unreachable unless the INSERT above was rolled back underneath us. Loud
    // rather than a null return: a caller that treats "no principal" as an
    // ordinary outcome would silently create an unlinked identity.
    throw new Error(
      `ensurePrincipalForEmail: principal for the requested address is missing immediately after an idempotent insert.`
    );
  }

  return toIdentity(row);
}
