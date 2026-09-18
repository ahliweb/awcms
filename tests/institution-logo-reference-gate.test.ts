import { describe, expect, test } from "bun:test";

import { validateInstitutionLogoReferenceForFullOnlineR2Mode } from "../src/modules/blog-content/application/institution-logo-reference-gate";
import type {
  MediaLibraryPort,
  ResolvedMediaReferenceDTO
} from "../src/modules/_shared/ports/media-library-port";

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222";

/** Fake `tx` — never dereferenced by the gate itself, only forwarded opaquely to `mediaPort`'s methods below, which ignore it. */
const FAKE_TX = {} as unknown as Bun.SQL;

function fakePort(options: {
  modeActive: boolean;
  safeIds?: Set<string>;
}): MediaLibraryPort {
  return {
    async isManagedMediaEnforcementActiveForTenant() {
      return options.modeActive;
    },
    async isMediaReferenceSafe(_tx, _tenantId, mediaObjectId) {
      return options.safeIds?.has(mediaObjectId) ?? false;
    },
    async resolveMediaReferences() {
      return new Map<string, ResolvedMediaReferenceDTO>();
    }
  };
}

describe("validateInstitutionLogoReferenceForFullOnlineR2Mode (Issue #806)", () => {
  test("valid when logoMediaId is undefined (omitted from the request)", async () => {
    const result = await validateInstitutionLogoReferenceForFullOnlineR2Mode(
      FAKE_TX,
      "tenant-a",
      undefined,
      fakePort({ modeActive: true })
    );
    expect(result).toEqual({ valid: true });
  });

  test("valid when logoMediaId is explicitly null (clearing the logo)", async () => {
    const result = await validateInstitutionLogoReferenceForFullOnlineR2Mode(
      FAKE_TX,
      "tenant-a",
      null,
      fakePort({ modeActive: true })
    );
    expect(result).toEqual({ valid: true });
  });

  test("no-op (valid) when full-online R2-only mode is not active for the tenant, even for an id that would not resolve", async () => {
    const result = await validateInstitutionLogoReferenceForFullOnlineR2Mode(
      FAKE_TX,
      "tenant-a",
      OTHER_TENANT_ID,
      fakePort({ modeActive: false })
    );
    expect(result).toEqual({ valid: true });
  });

  test("valid when mode is active and logoMediaId resolves as safe", async () => {
    const result = await validateInstitutionLogoReferenceForFullOnlineR2Mode(
      FAKE_TX,
      "tenant-a",
      VALID_ID,
      fakePort({ modeActive: true, safeIds: new Set([VALID_ID]) })
    );
    expect(result).toEqual({ valid: true });
  });

  test("invalid when mode is active and logoMediaId does not resolve as safe (cross-tenant/deleted/unverified)", async () => {
    const result = await validateInstitutionLogoReferenceForFullOnlineR2Mode(
      FAKE_TX,
      "tenant-a",
      OTHER_TENANT_ID,
      fakePort({ modeActive: true, safeIds: new Set([VALID_ID]) })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        {
          field: "logoMediaId",
          message:
            "logoMediaId must reference an existing, verified R2 media object belonging to this tenant in full-online R2-only mode."
        }
      ]);
    }
  });
});
