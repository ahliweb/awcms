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
  /**
   * The GLOBAL lockout state (ADR-0086, closing #430). Carried on the ordinary
   * projection rather than behind a second read: the login path needs it on
   * every attempt, and a separate call would be a second round trip plus a
   * second chance to forget it.
   */
  failedLoginCount: number;
  lockedUntil: Date | null;
};

type PrincipalRow = {
  id: string;
  email_normalized: string;
  password_hash: string | null;
  failed_login_count: number;
  locked_until: Date | null;
};

function toIdentity(row: PrincipalRow): PrincipalIdentity {
  return {
    id: row.id,
    emailNormalized: row.email_normalized,
    hasCredential: row.password_hash !== null,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until
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
    SELECT id, email_normalized, password_hash, failed_login_count, locked_until
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
    SELECT id, email_normalized, password_hash, failed_login_count, locked_until
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
    SELECT id, email_normalized, password_hash, failed_login_count, locked_until
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
    SELECT id, email_normalized, password_hash, failed_login_count, locked_until
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

/**
 * Records ONE failed login attempt against the human, and locks them out when
 * the threshold is reached — ADR-0086, the fix for #430.
 *
 * ## Why this closes the finding
 *
 * The counter it touches lives on the PRINCIPAL, of which there is exactly one
 * per human and which carries no tenant column. Rotating `x-awcms-tenant-id`
 * therefore changes nothing about which row is incremented, whereas the
 * per-identity counter it replaces gave an attacker a fresh one per tenant.
 *
 * ## Computed IN-DB, never read-modify-write
 *
 * Inherited from the identity counter Issue #483 fixed rather than repeated as a
 * new mistake: under READ COMMITTED — what `sql.begin` gives — two concurrent
 * failures that both SELECT N and both write N+1 cost ONE increment, so K
 * parallel attempts cost one. The increment and the conditional lock are both
 * expressions evaluated by PostgreSQL against the current row.
 *
 * The counter is NOT reset when the lock fires: a successful login is what
 * clears it (`clearPrincipalLockout`). That is the identity counter's behaviour
 * preserved exactly, and it differs from `mfa.ts` on purpose — the same
 * asymmetry that file already documents.
 */
export async function recordPrincipalLoginFailure(
  tx: Bun.SQL,
  principalId: string,
  maxFailedAttempts: number,
  lockoutCandidateAt: Date | null
): Promise<void> {
  await tx`
    UPDATE awcms_principals
    SET failed_login_count = failed_login_count + 1,
        locked_until =
          CASE WHEN failed_login_count + 1 >= ${maxFailedAttempts}
               THEN ${lockoutCandidateAt}
               ELSE locked_until END,
        updated_at = now()
    WHERE id = ${principalId}
  `;
}

/**
 * Clears the global lockout — the ONLY way out of one, and therefore the
 * function every recovery path must call.
 *
 * A successful login calls it, and so do password reset and password change.
 * That last part is not optional: a global counter with a per-tenant reset would
 * mean an attacker who locked `alice@corp.com` out of every tenant could not be
 * undone by the reset link she was sent. Moving the writer without moving its
 * recovery is the "writer moved, readers did not" defect this repo has already
 * paid for once.
 */
export async function clearPrincipalLockout(
  tx: Bun.SQL,
  principalId: string
): Promise<void> {
  await tx`
    UPDATE awcms_principals
    SET failed_login_count = 0, locked_until = NULL, updated_at = now()
    WHERE id = ${principalId}
  `;
}

/**
 * Writes the credential onto the principal the first time a password is proven
 * against the identity's own hash — the PROMOTION `sql/112` was built to leave
 * room for.
 *
 * `WHERE … AND password_hash IS NULL` makes it a one-way, idempotent step: once
 * promoted, this can never overwrite a credential, so a stale identity hash
 * (from a tenant whose row was not the one that changed) can never clobber the
 * live one. Password CHANGE goes through its own writer, not this.
 */
export async function promotePrincipalCredential(
  tx: Bun.SQL,
  principalId: string,
  passwordHash: string
): Promise<void> {
  await tx`
    UPDATE awcms_principals
    SET password_hash = ${passwordHash}, updated_at = now()
    WHERE id = ${principalId} AND password_hash IS NULL
  `;
}

/** Replaces the credential outright — password reset and password change. */
export async function setPrincipalCredential(
  tx: Bun.SQL,
  principalId: string,
  passwordHash: string
): Promise<void> {
  await tx`
    UPDATE awcms_principals
    SET password_hash = ${passwordHash},
        failed_login_count = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE id = ${principalId}
  `;
}

/**
 * Issues the ONE live tenant-selection token this human may hold (ADR-0088).
 *
 * Overwrites unconditionally, which is the behaviour and not a shortcut: a
 * second tenantless login invalidates the first login's token, the same rule
 * `deletePendingFactors` applies to a re-started MFA enrolment — only the most
 * recently issued credential may be redeemed. Two tokens alive at once would be
 * two chances for the one that was abandoned in a browser tab to be used.
 *
 * Takes the HASH, never the token: the plaintext exists only in the `409` body
 * being written, and a store function that accepted it would be a second place
 * for it to be logged.
 */
export async function issuePrincipalSelectionToken(
  tx: Bun.SQL,
  principalId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await tx`
    UPDATE awcms_principals
    SET selection_token_hash = ${tokenHash},
        selection_token_expires_at = ${expiresAt},
        updated_at = now()
    WHERE id = ${principalId}
  `;
}

/**
 * Spends a tenant-selection token, returning the human it belonged to — or
 * `null` for unknown, expired, and already-spent alike.
 *
 * Single use is enforced as a COMPARE-AND-SWAP, not a read-then-write: the
 * predicate re-asserts the hash and the expiry inside the same statement that
 * clears them, so two concurrent redemptions of the same token cannot both
 * receive a session. A read-modify-write here would be the exact defect
 * ADR-0027's auditor found in the MFA verify path (HIGH-1) and that `sql/024`
 * pays a row lock to avoid — repeated in a place where the prize is a session
 * in a tenant of the attacker's choosing.
 *
 * The expiry is compared in SQL against the caller's `now` rather than filtered
 * in JS for the same reason: a token that expires between the read and the
 * write must lose, and only the database can decide that atomically.
 */
export async function redeemPrincipalSelectionToken(
  tx: Bun.SQL,
  tokenHash: string,
  now: Date
): Promise<string | null> {
  const rows = (await tx`
    UPDATE awcms_principals
    SET selection_token_hash = NULL,
        selection_token_expires_at = NULL,
        updated_at = now()
    WHERE selection_token_hash = ${tokenHash}
      AND selection_token_expires_at > ${now}
    RETURNING id
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

/**
 * Which human an identity belongs to, or `null` when nothing has linked it yet.
 *
 * Reads `awcms_identities` — a tenant table under FORCE RLS, not a guarded
 * principal table — so this is an ordinary keyed read and not a widening of the
 * credential boundary.
 *
 * Module-private, and keyed on the identity PRIMARY KEY alone: both callers below
 * are reached from a path that has just authenticated the human it is acting for.
 * A caller holding an identity id it did NOT resolve itself — the MFA module,
 * whose administrative reset takes one from a request body — must not reuse this
 * shape; `mfa.ts` keys its own hop on `(tenant_id, id)` for that reason.
 *
 * `null` is a real answer, not an error. ADR-0085 refused `principal_id NOT NULL`
 * precisely so an identity written by a path not yet taught about principals is
 * visibly unlinked rather than a 500 — callers decide what an unlinked identity
 * means for them.
 */
async function resolvePrincipalIdForIdentity(
  tx: Bun.SQL,
  identityId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT principal_id FROM awcms_identities WHERE id = ${identityId}
  `) as { principal_id: string | null }[];

  return rows[0]?.principal_id ?? null;
}

/**
 * Clears the global lockout for whichever principal an IDENTITY belongs to.
 *
 * Exists because three success paths know an `identityId` and not an email:
 * the SSO callback, MFA enrolment verification, and any future federated login.
 * Each of them proves the human's identity by a route that never sees a
 * password, and each therefore has the same obligation as `/auth/login` — a
 * successful authentication clears the counter.
 *
 * Missing this is not cosmetic. A person locked out by password attempts who
 * then signs in through their IdP would stay locked at the password path with
 * no way to tell why, and the lever that used to clear it (the per-tenant
 * counter) no longer decides anything.
 *
 * Reads `awcms_identities` rather than taking a principal id so the call sites
 * stay one line and cannot pass the wrong id. The read is keyed on the identity
 * primary key; the principal write is keyed on `id`, so both satisfy the
 * read-shape invariant.
 */
export async function clearPrincipalLockoutForIdentity(
  tx: Bun.SQL,
  identityId: string
): Promise<void> {
  const principalId = await resolvePrincipalIdForIdentity(tx, identityId);

  if (principalId) await clearPrincipalLockout(tx, principalId);
}

/**
 * Replaces the credential (and clears the lockout) for whichever principal an
 * IDENTITY belongs to — the reset path's shape, which knows an identity id.
 *
 * A sibling of `clearPrincipalLockoutForIdentity` rather than a second spelling
 * of it: reset must also write the new hash, and folding the two together would
 * give the clearing helper an optional password parameter that most call sites
 * pass `undefined` to. Both keep their reads keyed on the identity primary key.
 */
export async function setPrincipalCredentialForIdentity(
  tx: Bun.SQL,
  identityId: string,
  passwordHash: string
): Promise<void> {
  const principalId = await resolvePrincipalIdForIdentity(tx, identityId);

  if (principalId) await setPrincipalCredential(tx, principalId, passwordHash);
}

/**
 * Links a NEWLY CREATED identity to its principal, creating the principal when
 * this is the first tenant that address has ever appeared in.
 *
 * ## Why every identity writer must call this
 *
 * `sql/112` backfilled the identities that existed WHEN IT RAN. Nothing made the
 * writers create one afterwards, so every account created after the migration
 * landed with `principal_id = NULL` — and since ADR-0086 the lockout counter
 * lives on the principal, a null link means failed attempts count NOTHING.
 *
 * That is a brute-force control silently switched off for exactly the accounts
 * nobody has audited yet, and no pure gate can see it: the code is correct in
 * isolation and the tables are correct in isolation. The DB-gated suite found it
 * by looking for the row and getting none.
 *
 * There are four writers (tenant bootstrap, invitation acceptance,
 * self-registration approval, SSO just-in-time provisioning) and they all call
 * this, so the next one has one obvious thing to copy.
 */
export async function linkIdentityToPrincipal(
  tx: Bun.SQL,
  identityId: string,
  loginIdentifier: string
): Promise<string> {
  const principal = await ensurePrincipalForEmail(tx, loginIdentifier);

  await tx`
    UPDATE awcms_identities
    SET principal_id = ${principal.id}
    WHERE id = ${identityId} AND principal_id IS NULL
  `;

  return principal.id;
}

/**
 * The same link, for a caller that already KNOWS which principal — ADR-0090.
 *
 * `linkIdentityToPrincipal` above derives the principal from an address, which
 * is right for every path where the address IS the claim being made. Delegated
 * access is the one path where it is not: the human is identified by the
 * credential they authenticated with in another tenant, and re-deriving them
 * from a string this tenant supplied would let the tenant choose whose
 * principal the membership attaches to.
 *
 * Fifth writer of `awcms_identities.principal_id`, and it keeps the same
 * `principal_id IS NULL` predicate: linking is a one-way step, and a repointed
 * identity is a person's account handed to someone else.
 */
export async function attachIdentityToPrincipal(
  tx: Bun.SQL,
  identityId: string,
  principalId: string
): Promise<void> {
  await tx`
    UPDATE awcms_identities
    SET principal_id = ${principalId}
    WHERE id = ${identityId} AND principal_id IS NULL
  `;
}
