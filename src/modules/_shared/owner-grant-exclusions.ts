/**
 * Tenant-scoped permissions that are NEVER part of the blanket grant a tenant's
 * `owner` role receives (Issue #970, ADR-0138 section 3).
 *
 * ## Why this exists beside `scope = 'platform'` (ADR-0053)
 *
 * `scope = 'platform'` means "the action crosses tenant boundaries": it is kept
 * from every tenant owner AND refused by the chokepoint outside the platform
 * tenant. That is the wrong tool for a permission that is wholly INSIDE one
 * tenant but must be assigned on purpose: the tenant itself (not the platform)
 * is the controller of its employees' data, and it must be able to hold the
 * permission.
 *
 * Geolocation evidence is that case. Enabling it processes where an employee
 * was at clock-in; the decision belongs to a named person at the tenant who has
 * seen the data-protection impact assessment, not to whoever happened to create
 * the tenant. So `hr_workforce.geolocation_evidence.configure` stays
 * `scope = 'tenant'` (assignable to any role of any tenant) but is excluded from
 * the two paths that would hand it to an owner automatically:
 *
 *   * `createTenantWithOwner` (`tenant_admin/application/platform-bootstrap.ts`),
 *     the blanket `SELECT … FROM awcms_permissions WHERE scope = 'tenant'`;
 *   * the owner-permission backfill job
 *     (`identity_access/application/owner-permission-backfill-job.ts`).
 *
 * An administrator assigns it explicitly through the role admin surface (an
 * audited, high-risk act). Keys are `module.activity.action`. Adding a key here
 * is a security decision made in a PR that says why.
 */
export const OWNER_GRANT_EXCLUDED_PERMISSION_KEYS: readonly string[] = [
  "hr_workforce.geolocation_evidence.configure"
];

export function isOwnerGrantExcluded(permissionKey: string): boolean {
  return OWNER_GRANT_EXCLUDED_PERMISSION_KEYS.includes(permissionKey);
}
