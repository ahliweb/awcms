/**
 * A suspended partner stops reaching in — ADR-0093, Issue #543.
 *
 * `sql/116` gave `awcms_partners` a `status` column pinned to `'active'` by a
 * CHECK and wrote its own condition into the file header: the widening lands in
 * the SAME PR as its reader, or not at all. This is the reader's decision rule,
 * kept pure so every branch is testable without a database — and there is
 * exactly one branch here that matters, in exactly one direction.
 *
 * ## Deny-only, and why that is the whole design
 *
 * This never grants. It answers `true` only for an actor who is in a tenant
 * BECAUSE a grant put them there, and whose partner is not `active`. Every
 * ordinary member — `principalKind` absent or `"user"` — gets `false` before
 * the status is even looked at, which leaves their decision exactly where it
 * was. The gate is therefore additive in the only sense that counts: it can
 * refuse requests that used to be allowed, and can never allow one that used
 * to be refused.
 *
 * ## `null` means REFUSE
 *
 * A delegated actor whose partner has no registry row at all is treated as
 * suspended. That is unreachable today — `sql/120`'s foreign key requires a
 * registered partner for as long as any grant exists — and it is BECAUSE it is
 * unreachable that fail-closed costs nothing: there is no working case for it
 * to break, and the alternative is a gate that a deleted row switches off.
 */

/** What `awcms_partner_registry_status()` answers, plus "no row". */
export type PartnerRegistryStatus = "active" | "suspended" | null;

export type DelegatedPartnerCheck = {
  /** `undefined` reads as `"user"` — see `TenantContext.principalKind`. */
  principalKind?: "user" | "delegated";
  partnerRegistryStatus: PartnerRegistryStatus;
};

export function isDelegatedPartnerRefused(
  input: DelegatedPartnerCheck
): boolean {
  if (input.principalKind !== "delegated") return false;

  return input.partnerRegistryStatus !== "active";
}

/**
 * The two values the CHECK constraint allows, as code — so a screen and a
 * writer cannot disagree with the database about what a status may be.
 *
 * A third value is a DROP/ADD CONSTRAINT in a migration that lands with its own
 * reader, which is the rule `sql/116` wrote for itself and this one inherits.
 */
export const PARTNER_STATUSES = ["active", "suspended"] as const;

export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export function isPartnerStatus(value: string): value is PartnerStatus {
  return (PARTNER_STATUSES as readonly string[]).includes(value);
}
