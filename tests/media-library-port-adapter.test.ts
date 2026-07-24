import { describe, expect, test } from "bun:test";

import { mediaLibraryPortAdapter } from "../src/modules/media-library/application/media-library-port-adapter";

/**
 * Unit-level proof of the `isManagedMediaEnforcementActiveForTenant` short
 * circuit (ADR-0036): when the DEPLOYMENT is not ready, the adapter must return
 * false WITHOUT ever touching the database — the fail-closed "both halves must
 * hold" contract. Deployment readiness alone must never opt a tenant in; the
 * tenant flag alone must never enforce on a deployment with no working storage.
 *
 * The full both-halves behavior against a real DB (readiness ready + tenant flag
 * on/off) is covered by `tests/integration/media-library-tenant-state.integration.test.ts`.
 */

/** A `tx` that throws the moment it is used as a tagged template — proves the DB was not queried. */
const THROWING_TX = ((..._args: unknown[]) => {
  throw new Error(
    "database must not be queried when deployment readiness fails"
  );
}) as unknown as Bun.SQL;

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant short-circuit", () => {
  test("returns false and never queries the DB when R2 is disabled", async () => {
    const result =
      await mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant(
        THROWING_TX,
        TENANT_ID,
        { NEWS_MEDIA_R2_ENABLED: "false" } as NodeJS.ProcessEnv
      );
    expect(result).toBe(false);
  });

  test("returns false and never queries the DB when R2 is enabled but incompletely configured", async () => {
    const result =
      await mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant(
        THROWING_TX,
        TENANT_ID,
        { NEWS_MEDIA_R2_ENABLED: "true" } as NodeJS.ProcessEnv
      );
    expect(result).toBe(false);
  });
});
