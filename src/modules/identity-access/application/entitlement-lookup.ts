/**
 * The entitlement question, asked from OUTSIDE the chokepoint — ADR-0084,
 * Gelombang 5 PR 5.4 of Issue #423.
 *
 * Exactly one caller: `module_management`'s enable endpoint, so it can answer
 * `409 ENTITLEMENT_REQUIRED` instead of enabling a module whose every endpoint
 * will then refuse. That is a COURTESY, never the control — the control is
 * `authorizeInTransaction`, which refuses regardless of what this returns and
 * regardless of whether anyone called it.
 *
 * ## Why this is a second reader and not a widening of the guard
 *
 * The guard answers "may THIS request proceed against the module it names". The
 * question here is different: "would a request against ANOTHER module be
 * refused". Threading that through `authorizeInTransaction` would mean giving it
 * a module key that is not the one being authorized — a parameter whose only
 * legitimate use is this one call site, and whose first misuse is authorizing
 * one module while checking another.
 *
 * It reuses `resolveModuleAvailability` and `evaluateEntitlementRequirement`
 * unchanged, so the two readers cannot disagree about what "entitled" means.
 * What it deliberately does NOT do is write a decision log: this is not a
 * resource-access decision, it is a projection of one that has not been asked
 * for yet, and a `deny` row here would make "authorization denial anomalies"
 * unreadable — the reasoning ADR-0049 §6 uses for field-level checks.
 *
 * The PLATFORM exemption is deliberately absent, and its absence is safe: the
 * platform tenant is exempt at the chokepoint, so if it enables an unentitled
 * module here it simply gets a 409 it did not need — a false refusal on an
 * action that would then have worked. Resolving the platform tenant on every
 * enable to avoid that is a round trip bought for a message.
 */
import { listModules } from "../../index";
import {
  evaluateEntitlementRequirement,
  requiredEntitlementForModule,
  type EntitlementDenial
} from "../domain/entitlement";
import { resolveModuleAvailability } from "./auth-context";

/** `null` when there is no objection — the same deny-or-null shape the layer uses everywhere. */
export async function checkModuleEntitlementForEnable(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  now: Date
): Promise<EntitlementDenial | null> {
  const requiredEntitlementKey = requiredEntitlementForModule(
    moduleKey,
    listModules()
  );

  if (requiredEntitlementKey === null) {
    return null;
  }

  const availability = await resolveModuleAvailability(
    tx,
    tenantId,
    moduleKey,
    requiredEntitlementKey,
    now
  );

  return evaluateEntitlementRequirement({
    requiredEntitlementKey,
    held: availability.entitlementHeld,
    actingTenantIsPlatform: false
  });
}
