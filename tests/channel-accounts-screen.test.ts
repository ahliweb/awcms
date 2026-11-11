/**
 * The pure rules of the channel-account screens (Issue #1154): what a capability
 * row shows and whether it is disabled, why a provider has no Connect action,
 * the identity mask and the typed confirmation. Also holds the closed
 * vocabularies' label helpers to the values the module can actually produce, so
 * a new status or capability cannot reach a screen as a raw token.
 */
import { describe, expect, test } from "bun:test";

import { getTranslator } from "../src/lib/i18n";
import {
  capabilityDenialLabel,
  capabilityDisplayStateLabel,
  channelAccountKindLabel,
  channelAccountStatusLabel,
  channelAuthModeLabel,
  channelCapabilityLabel,
  channelGrantStateLabel,
  channelHealthStateLabel,
  channelProviderLabel,
  providerAvailabilityLabel
} from "../src/lib/i18n/labels/channel-accounts";
import {
  capabilityRowDisplay,
  confirmationMatches,
  formatUtcMinute,
  maskExternalId,
  providerAvailability
} from "../src/lib/ui/channel-accounts-screen";
import {
  ACCOUNT_STATUSES,
  GRANT_STATES,
  HEALTH_STATES
} from "../src/modules/channel-accounts/domain/channel-accounts-constants";
import {
  CHANNEL_CAPABILITIES,
  PROVIDER_MATRIX
} from "../src/modules/channel-accounts/domain/provider-matrix";

const { t } = getTranslator("en");
const { t: tId } = getTranslator("id");

describe("capabilityRowDisplay", () => {
  const denied = { allowed: false, code: "CAPABILITY_NOT_RECORDED" };

  test("a capability the provider does not offer is DISABLED, whatever a stored row says", () => {
    for (const matrixCell of ["not_offered", "not_applicable", "barred"]) {
      expect(
        capabilityRowDisplay({
          matrixCell,
          state: "granted",
          effective: denied
        })
      ).toEqual({ state: "not_offered", disabled: true });
    }
  });

  test("an unverified cell is disabled and says so, not 'not offered'", () => {
    expect(
      capabilityRowDisplay({
        matrixCell: "unverified",
        state: "absent",
        effective: denied
      })
    ).toEqual({ state: "unverified", disabled: true });
  });

  test("a grantable cell shows the stored evidence state, enabled", () => {
    for (const matrixCell of ["candidate", "restricted"]) {
      expect(
        capabilityRowDisplay({
          matrixCell,
          state: "granted",
          effective: { allowed: true }
        })
      ).toEqual({ state: "granted", disabled: false });
      expect(
        capabilityRowDisplay({
          matrixCell,
          state: "pending_approval",
          effective: denied
        })
      ).toEqual({ state: "pending_approval", disabled: false });
      expect(
        capabilityRowDisplay({ matrixCell, state: "denied", effective: denied })
      ).toEqual({ state: "denied", disabled: false });
    }
  });

  test("nothing recorded, or an unknown stored value, is 'no grant recorded' (denied by default)", () => {
    for (const state of ["absent", "something_new"]) {
      expect(
        capabilityRowDisplay({
          matrixCell: "candidate",
          state,
          effective: denied
        })
      ).toEqual({ state: "not_requested", disabled: false });
    }
  });

  test("a stored not_offered row on a grantable cell is also disabled", () => {
    expect(
      capabilityRowDisplay({
        matrixCell: "candidate",
        state: "not_offered",
        effective: denied
      })
    ).toEqual({ state: "not_offered", disabled: true });
  });
});

describe("providerAvailability", () => {
  test("a policy boundary is never connectable", () => {
    expect(
      providerAvailability({ registrable: false, hasOAuthAdapter: true })
    ).toBe("policy_boundary");
  });

  test("a provider with no adapter is unsupported and requires approval", () => {
    expect(
      providerAvailability({ registrable: true, hasOAuthAdapter: false })
    ).toBe("no_connector");
    expect(providerAvailabilityLabel(t, "no_connector")).toContain(
      "requires approval"
    );
  });

  test("a phase-gated provider (Issue #1152) is never connectable, even with an adapter", () => {
    expect(
      providerAvailability({
        registrable: true,
        hasOAuthAdapter: true,
        phaseGated: true
      })
    ).toBe("phase_gated");
    expect(providerAvailabilityLabel(t, "phase_gated")).toContain(
      "phase-gated"
    );
  });

  test("every provider in the matrix gets an availability; phase-gated rows say so, the other unregistrable rows are policy boundaries", () => {
    for (const [provider, row] of Object.entries(PROVIDER_MATRIX)) {
      const availability = providerAvailability({
        registrable: row.registrable,
        hasOAuthAdapter: false,
        phaseGated: row.phase !== undefined
      });

      expect(availability).toBe(
        row.phase
          ? "phase_gated"
          : row.registrable
            ? "no_connector"
            : "policy_boundary"
      );
      expect(provider.length).toBeGreaterThan(0);
    }
  });
});

describe("maskExternalId", () => {
  test("shows only the last four characters", () => {
    expect(maskExternalId("628123456789")).toBe("••••6789");
    expect(maskExternalId("628123456789")).not.toContain("62812345");
  });

  test("a short value is fully masked", () => {
    expect(maskExternalId("12345")).toBe("••••");
    expect(maskExternalId("")).toBe("••••");
  });
});

describe("confirmationMatches", () => {
  test("is exact after trimming and case-folding", () => {
    expect(confirmationMatches("  Sales Number ", "sales number")).toBe(true);
  });

  test("a different name, and an empty input, never confirm", () => {
    expect(confirmationMatches("Other", "Sales Number")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
    expect(confirmationMatches("   ", "   ")).toBe(false);
  });
});

describe("formatUtcMinute", () => {
  test("renders an instant to the minute in UTC, and an em dash for none", () => {
    expect(formatUtcMinute("2026-11-03T10:15:42.000Z")).toBe(
      "2026-11-03 10:15 UTC"
    );
    expect(formatUtcMinute(null)).toBe("—");
  });
});

describe("label helpers cover the closed vocabularies", () => {
  test("every account status, grant state and health state has a label that is not the raw token", () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(channelAccountStatusLabel(t, status)).not.toBe(status);
    }
    for (const state of GRANT_STATES) {
      expect(channelGrantStateLabel(t, state)).not.toBe(state);
    }
    for (const state of HEALTH_STATES) {
      expect(channelHealthStateLabel(t, state)).not.toBe(state);
    }
  });

  test("every capability, provider, auth mode and account kind has a label", () => {
    for (const capability of CHANNEL_CAPABILITIES) {
      expect(channelCapabilityLabel(t, capability)).not.toBe(capability);
    }

    const kinds = new Set<string>();
    const modes = new Set<string>();

    for (const [provider, row] of Object.entries(PROVIDER_MATRIX)) {
      expect(channelProviderLabel(t, provider)).not.toBe(provider);
      Object.keys(row.kinds).forEach((kind) => kinds.add(kind));
      row.authModes.forEach((mode) => modes.add(mode));
    }
    for (const kind of kinds) {
      expect(channelAccountKindLabel(t, kind)).not.toBe(kind);
    }
    for (const mode of modes) {
      expect(channelAuthModeLabel(t, mode)).not.toBe(mode);
    }
  });

  test("every denial code evaluateCapability can return has words", () => {
    const codes = [
      "PROVIDER_UNKNOWN",
      "ACCOUNT_KIND_CONTAINER",
      "PROVIDER_NOT_OFFERED",
      "PROVIDER_BARRED",
      "PROVIDER_UNVERIFIED",
      "PROVIDER_RESTRICTED",
      "CAPABILITY_NOT_RECORDED",
      "CAPABILITY_NOT_GRANTED",
      "EVIDENCE_MISSING",
      "MATRIX_VERSION_STALE",
      "ACCOUNT_NOT_USABLE",
      "CONNECTION_NOT_ACTIVE"
    ];

    for (const code of codes) {
      expect(capabilityDenialLabel(t, code)).not.toBe(code);
    }
  });

  test("an unknown value falls back to the raw token, never a blank", () => {
    expect(channelAccountStatusLabel(t, "brand_new")).toBe("brand_new");
    expect(channelProviderLabel(t, "brand_new")).toBe("brand_new");
  });

  test("the Indonesian catalogue translates the evidence states", () => {
    expect(capabilityDisplayStateLabel(tId, "granted")).not.toBe("Granted");
    expect(capabilityDisplayStateLabel(tId, "not_offered")).not.toBe(
      "Not offered"
    );
  });
});
