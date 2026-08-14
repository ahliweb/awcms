/**
 * The one way another module obtains a person profile for an account it is
 * creating — and the reason it exists is ADR-0013 §6, "no shared-table write".
 *
 * ## Why a function rather than three INSERTs
 *
 * `awcms_identities.profile_id` is `NOT NULL` and references `awcms_profiles`,
 * so creating a login identity structurally REQUIRES a profile row. Before
 * this, every path that created an identity wrote that row itself:
 * `identity_access`'s JIT provisioning (#185) and self-registration approval
 * (#276) each carried their own `INSERT INTO awcms_profiles`, alongside
 * `tenant_admin`'s bootstrap.
 *
 * They had already diverged. JIT set `verification_status = 'verified'` and
 * left `status` to its default; self-registration set `status = 'active'`
 * (already the default) and left `verification_status` to ITS default, so two
 * accounts created minutes apart got different verification postures for
 * reasons nobody had decided — which is precisely the drift a single-writer
 * rule prevents, showing up in the smallest possible way.
 *
 * ## Why no audit event here
 *
 * `createParty` (the operator-facing sibling) records one, and needs an
 * `actorTenantUserId` to do it. Neither caller here has an actor in that sense:
 * JIT provisioning is driven by an IdP assertion, and approval already writes
 * its own `registration_approved` entry naming the reviewer. A second row
 * saying "a profile was created" would describe the mechanism rather than the
 * decision, so the caller keeps the audit and this stays a data operation.
 *
 * `tenant_admin`'s bootstrap deliberately does NOT route through here — see the
 * exception recorded in `scripts/table-write-ownership-check.ts` and the header
 * of `tenant-admin/application/platform-bootstrap.ts`.
 */

export type CreatePersonProfileInput = {
  /** Rendered to operators. The caller's own display name or login identifier. */
  displayName: string;
  /**
   * `true` only when an external identity provider asserted a verified
   * address. Default `false` maps to `'unverified'`, which is also the
   * column's default: a self-submitted name is not evidence of anything.
   */
  emailVerified?: boolean;
};

/**
 * Inserts a minimal `person` profile and returns its id. Must be called inside
 * the caller's existing tenant transaction so the profile and the identity it
 * belongs to commit together — a profile with no identity is an orphan row that
 * nothing later cleans up.
 */
export async function createPersonProfileForIdentity(
  tx: Bun.SQL,
  tenantId: string,
  input: CreatePersonProfileInput
): Promise<string> {
  const rows = (await tx`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name, verification_status)
    VALUES (
      ${tenantId}, 'person', ${input.displayName},
      ${input.emailVerified ? "verified" : "unverified"}
    )
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/**
 * Renames the profile behind a LOGIN IDENTITY — the self-service half of
 * ADR-0096, and the second reason this file exists.
 *
 * ## Why the write lives here and not in the route
 *
 * ADR-0013 §6, "no shared-table write": `awcms_profiles` is `profile_identity`'s
 * table, and `identity_access` owning the `/api/v1/auth/*` surface does not make
 * it a co-owner of the row. The first draft of `auth/profile.ts` did the UPDATE
 * inline and `modules:table-writes:check` reported it — correctly, and for the
 * same reason the create above was consolidated: two modules writing one table
 * is how `status` and `verification_status` silently diverged between two
 * account-creation paths.
 *
 * ## Why it takes an IDENTITY id rather than a profile id
 *
 * Because that is what makes it self-service rather than administrative. The
 * caller never names a profile; this resolves it from the identity behind the
 * session, so there is no id to tamper with and no ownership check that could be
 * forgotten. `updateParty` (the operator-facing sibling) takes a profile id and
 * is permissioned precisely because it can be pointed anywhere.
 *
 * ## What it deliberately does not touch
 *
 * `display_name` only. Not `legal_name` (asserted-then-checked, per
 * `verification_status`), not `status`, not `verification_status`, not
 * `risk_level` — ADR-0096 §3 freezes that list, and a self-service writer that
 * grew one of those fields would be a privilege escalation wearing a profile
 * editor's clothes.
 *
 * ## No audit event, same reasoning as the create above
 *
 * `awcms_audit_events` records what administrators do to OTHER people. A person
 * renaming themselves has no actor/subject split to record, and a row saying
 * "somebody changed their own name" would describe the mechanism rather than a
 * decision anybody needs to review.
 *
 * Returns `null` when the identity has no reachable profile, which the caller
 * treats as an authentication failure rather than a 404 — a live session whose
 * identity has no profile is an invariant violation, not a user-facing state.
 */
export async function updateOwnDisplayName(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  displayName: string
): Promise<{ id: string; displayName: string } | null> {
  // Keyed through the identity, and the `tenant_id` predicate is belt-and-braces
  // over FORCE RLS — this repo never leans on RLS alone in an explicit statement.
  const rows = (await tx`
    UPDATE awcms_profiles p
    SET display_name = ${displayName},
        updated_at = now(),
        updated_by = ${identityId}
    FROM awcms_identities i
    WHERE i.tenant_id = ${tenantId}
      AND i.id = ${identityId}
      AND p.tenant_id = i.tenant_id
      AND p.id = i.profile_id
    RETURNING p.id, p.display_name
  `) as Array<{ id: string; display_name: string }>;

  const row = rows[0];

  return row ? { id: row.id, displayName: row.display_name } : null;
}
