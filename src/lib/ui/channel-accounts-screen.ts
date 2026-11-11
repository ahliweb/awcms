/**
 * Pure rules of the channel-account screens (Issue #1154, ADR-0148 UP-08).
 *
 * Kept out of the `.astro` files so each rule is unit-tested without rendering:
 * what a capability row shows and whether it is DISABLED, how a provider
 * without a connector is described, and how an external id is masked. No
 * database, no network, no secret.
 */
import type {
  CapabilityDisplayState,
  ProviderAvailability
} from "../i18n/labels/channel-accounts";

/** The matrix cells under which a capability can never be granted on this account kind. */
const NEVER_GRANTABLE_CELLS = new Set([
  "not_offered",
  "not_applicable",
  "barred",
  "unverified"
]);

export type CapabilityRowInput = {
  matrixCell: string;
  state: string;
  effective: { allowed: boolean; code?: string };
};

export type CapabilityRowDisplay = {
  state: CapabilityDisplayState;
  /**
   * A capability the provider does not support (or policy bars) is shown
   * DISABLED, never hidden: the operator sees that it exists and why it cannot
   * be had, instead of wondering whether it was forgotten.
   */
  disabled: boolean;
};

/**
 * The evidence state of one capability row.
 *
 * The matrix has the last word, exactly as `evaluateCapability` does on every
 * use: a cell that can never be granted reads "Not offered" (or "unverified")
 * whatever a stored row says, so a stale `granted` row on an unsupported cell
 * is not presented as a working grant. A stored `granted` row on a grantable
 * cell is shown as granted even when it is not usable at this moment; the
 * `effective` verdict is shown beside it by the screen.
 */
export function capabilityRowDisplay(
  row: CapabilityRowInput
): CapabilityRowDisplay {
  if (NEVER_GRANTABLE_CELLS.has(row.matrixCell)) {
    return {
      state: row.matrixCell === "unverified" ? "unverified" : "not_offered",
      disabled: true
    };
  }

  switch (row.state) {
    case "granted":
      return { state: "granted", disabled: false };
    case "pending_approval":
      return { state: "pending_approval", disabled: false };
    case "denied":
      return { state: "denied", disabled: false };
    case "not_offered":
      return { state: "not_offered", disabled: true };
    default:
      // `absent`, or a value this build does not know: nothing is granted.
      return { state: "not_requested", disabled: false };
  }
}

/**
 * Why a provider is listed without a Connect button.
 *
 * A "Connect" control is a promise that a connector will verify the account.
 * Today the OAuth start is refused (`PROVIDER_ADAPTER_UNAVAILABLE`) for every
 * provider with no registered adapter, and no connector verifies a token,
 * device or bot account either, so no provider gets a Connect button from this
 * screen. What differs is the explanation.
 */
export function providerAvailability(input: {
  registrable: boolean;
  hasOAuthAdapter: boolean;
  /** A phase-gated provider (Issue #1152): documented, not admitted. */
  phaseGated?: boolean;
}): ProviderAvailability {
  if (input.phaseGated) return "phase_gated";
  if (!input.registrable) return "policy_boundary";

  return input.hasOAuthAdapter ? "connector_available" : "no_connector";
}

/**
 * A provider identity (a phone number id, a device id) shown as the last four
 * characters only. The full value is on the API for a holder of
 * `accounts.read`; a list screen has no need to put a phone number into HTML a
 * shoulder-surfer or a screenshot can carry away.
 */
export function maskExternalId(externalId: string): string {
  const chars = [...externalId];

  if (chars.length <= 6) return "••••";

  return `••••${chars.slice(-4).join("")}`;
}

/** `2026-11-03 10:15 UTC`, or an em dash for no value. */
export function formatUtcMinute(value: string | null): string {
  return value ? value.replace("T", " ").slice(0, 16) + " UTC" : "—";
}

/**
 * Whether the typed confirmation equals the expected text. Compared after
 * trimming and case-folding, so a stray space or capital does not hold an
 * operator in a dialog, but a different account's name never confirms this one.
 */
export function confirmationMatches(typed: string, expected: string): boolean {
  const left = typed.trim().toLowerCase();

  return left.length > 0 && left === expected.trim().toLowerCase();
}
