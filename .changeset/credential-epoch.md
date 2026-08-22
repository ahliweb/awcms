---
"awcms": minor
---

fix(identity-access): a password reset changed the credential everywhere and revoked sessions in one tenant

Finding **A5** of the 17 August 2026 audit round. `sql/144`.

`setPrincipalCredentialForIdentity` is global by design (ADR-0086: one human, one
credential). `revokeAllSessionsForIdentity` carries `WHERE tenant_id = …`, and it
has to — `awcms_sessions` is `FORCE ROW LEVEL SECURITY` and the transaction is
scoped to one tenant. So a person whose tenant-B cookie was stolen, recovering
from tenant A, changed the password everywhere and revoked nothing in B. **The
stolen session kept working with a password its holder no longer knows** — the
exact opposite of what a reset is for. "Sign me out everywhere" had the same
boundary, and two doc comments asserted the guarantee the code no longer
provided.

**Why an epoch rather than a wider revoke.** The revocation cannot be widened
from inside the request: the tenant GUC is set for one tenant per transaction, so
the UPDATE would silently match zero rows everywhere else — the same bug with
more code. Escaping RLS would mean a `SECURITY DEFINER` function that may revoke
any session in any tenant, reachable from a request path, which is a far larger
blast radius than the problem.

An epoch inverts it. The credential change writes **one row it already owns**
(`awcms_principals` is global and RLS-free), and every session carries the epoch
it was minted under. A session behind its principal is refused by every reader in
every tenant at once, and no writer ever crosses a tenant boundary. The
integration suite asserts that directly: after a reset in A, tenant B's row still
has `revoked_at IS NULL` and is refused anyway.

**The bump lives inside `setPrincipalCredential`**, in the same statement as the
hash, for the reason ADR-0079 already paid for once: a caller that replaces the
credential and forgets the bump leaves no trace — the password changes, the mail
arrives, the tests pass, and the stolen session keeps working. Two writers that
must always run together are one writer. `promotePrincipalCredential`
deliberately does **not** bump: promotion writes a hash the identity already had,
nothing about the credential changed, and bumping there would sign a person out
of their other tenants on an ordinary login.

**One fragment, eight readers, one gate.** `sessionCredentialCurrent` is the only
definition of "still backed by the current credential", and
`bun run identity:session-readers:check` (new, gate 57) fails the build for a
recorded live-session reader that does not embed it, for a session `INSERT` that
does not stamp the epoch, and for any new file naming `awcms_sessions` that is on
neither list. The alternative — a per-file `AND …` — is exactly the arrangement
ADR-0079 records: a session row gives no hint that a global credential exists to
be behind, so the next author writes the three predicates they can see and the
fourth is invisible.

Both nullabilities are load-bearing and in opposite directions.
`awcms_principals.credential_epoch` is `NOT NULL DEFAULT 0` so the comparison
always has a right-hand side; `awcms_sessions.credential_epoch` is **nullable**
and read as 0, so sessions minted before this migration are behind the moment any
epoch is bumped and the first reset after deployment kills them. An identity with
no `principal_id` (nullable by design, sql/112) is unaffected — it has no global
credential to be behind, and its tenant-scoped revocation remains its whole
guarantee.
