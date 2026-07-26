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
