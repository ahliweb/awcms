/**
 * Whether the person behind an identity also works in another tenant (#1004,
 * finding H2; sql/261).
 *
 * `awcms_identities` is FORCE RLS, so this cannot be an ordinary query; it asks a
 * narrow SECURITY DEFINER function that returns a single boolean (never an id or
 * a count, so it is not a membership oracle). The principal id is read from the
 * CALLER'S OWN identity row in the current tenant, never from a request value.
 */
export async function principalHasOtherTenantIdentity(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT principal_id FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND id = ${identityId}
  `) as { principal_id: string | null }[];
  const principalId = rows[0]?.principal_id;

  // FAIL CLOSED (#1004 re-audit L2). An unlinked identity is not "a person who
  // is nowhere else": `requirePrincipalIdForEnrollment` links it by address the
  // moment it enrols, and the person it links to may already work in other
  // tenants. Answering "no other tenant" here would hand the SSO exemption to
  // exactly the identity whose reach is unknown.
  if (!principalId) return true;

  const result = (await tx`
    SELECT awcms_principal_has_other_tenant_identity(${principalId}, ${tenantId}) AS other
  `) as { other: boolean }[];

  return result[0]?.other === true;
}
