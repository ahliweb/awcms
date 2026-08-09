/**
 * What a SUSPENDED tenant may still do — Issue #429, ADR-0073.
 *
 * Suspension stops service. It must not lock a customer out of the two things
 * they need in order to stop being suspended: seeing why, and paying.
 *
 * ## This list is a code declaration on purpose
 *
 * Not a column, not a setting. The same reasoning ADR-0053 wrote for the
 * platform-scope gate: a gate decided from a code-side declaration cannot be
 * lifted by one `UPDATE`, a restored backup, or a provisioning path missing a
 * `WHERE`. A suspension that a row could quietly undo is not a suspension.
 *
 * **Widening this list requires an ADR.** Every entry here is an action a
 * customer who has been cut off can still perform, and the list is short by
 * design — the same discipline `MACHINE_CREDENTIAL_ALLOWED_ACTIONS` carries.
 *
 * ## Why permission keys and not actions
 *
 * `AccessAction` is far too coarse: allowing `read` would leave every read
 * surface in every module open, which is most of the product. The unit is the
 * full permission key, so each entry is one named capability someone chose.
 */
import { permissionKey } from "./access-control";
import type { AccessRequest } from "./access-control";

/**
 * Permission keys that remain reachable while `awcms_tenants.status` is
 * `'suspended'`.
 *
 * Deliberately NOT here, and each absence is the point:
 *
 * - every write in every module — suspension exists to stop them;
 * - `logging.audit_trail.read` — a suspended tenant reading its audit trail is
 *   defensible, but it is not needed to resolve a suspension, and this list
 *   only holds what is;
 * - anything `platform`-scoped — the platform tenant is exempt as a whole
 *   (see `isSuspensionExemptTenant`), so listing those here would be noise.
 */
export const SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS: ReadonlySet<string> =
  new Set([
    // Seeing the tenant's own settings — including, once ADR-0073's follow-on
    // work lands, the reason it was suspended.
    permissionKey("tenant_admin", "tenant_settings", "read")
  ]);

/**
 * The PLATFORM tenant is never suspended out of its own control plane.
 *
 * Without this, marking the platform tenant suspended — by mistake, by a bad
 * restore, or by a lapsed subscription once Gelombang 5 lands — would lock the
 * operator out of the only surface that can lift a suspension, including its
 * own. There is no in-band recovery from that.
 *
 * The same shape of reasoning ADR-0033 §3 used to refuse flat unscoped `deny`
 * policies: a control that can brick its own remedy is not a control.
 */
export function isSuspensionExemptTenant(
  tenantId: string,
  platformTenantId: string | null
): boolean {
  return platformTenantId !== null && tenantId === platformTenantId;
}

/** Whether `guard` names a capability a suspended tenant may still exercise. */
export function isAllowedWhileSuspended(guard: AccessRequest): boolean {
  return SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS.has(
    permissionKey(guard.moduleKey, guard.activityCode, guard.action)
  );
}

/**
 * Tenant statuses that stop service. `inactive` is included: `sql/002` admits
 * `active | inactive | suspended`, the login path already refuses anything that
 * is not `active` (`login-policy.ts`), and leaving `inactive` served while
 * `suspended` is refused would reintroduce the same asymmetry this work exists
 * to close — one status enforced at the door, another only at login.
 */
export function isTenantServiceStopped(status: string): boolean {
  return status !== "active";
}
