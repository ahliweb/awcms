/**
 * `/admin/channel-account-claims` gates against the endpoint it drives (Issue
 * #1215, ADR-0170 option C, ADR-0051).
 *
 * The screen is the PLATFORM operator's, so the properties pinned here are the
 * ones that keep it from becoming a tenant surface by accident:
 *
 * - its entry guard is the platform permission, equal to the endpoint's guard;
 *   the permission is declared `scope: "platform"` with MFA enrolment, seeded as
 *   `platform` by a migration, and is NOT in the catalogue of any tenant role;
 * - the sidebar entry is gated on the same key and opens a page that exists;
 * - the screen reads nothing cross-tenant (no SQL, no claim listing, no holder
 *   locator) and never shows the holder tenant;
 * - the script sends an `Idempotency-Key` on the mutation, asks for the step-up
 *   inline and keeps the same key for the retry, types a confirmation, and
 *   touches no web storage.
 *
 * Pure: no database, no network.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import { CHANNEL_ACCOUNTS_GUARDS } from "../src/modules/channel-accounts/domain/channel-accounts-constants";

const PAGE = "src/pages/admin/channel-account-claims.astro";
const ROUTE = "src/pages/api/v1/channel-accounts/claims/release.ts";
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const page = read(PAGE);
const route = read(ROUTE);
const release = read(
  "src/modules/channel-accounts/application/claim-release.ts"
);
const KEY = "channel_accounts.account_claims.revoke";

describe("the claim-release screen is gated on the platform permission", () => {
  test("the literal guard equals the module's own guard constant and the endpoint's guard", () => {
    const match =
      /const RELEASE_GUARD = \{\s*moduleKey: "([a-z_]+)",\s*activityCode: "([a-z_]+)",\s*action: "([a-z_]+)"\s*\} as const;/.exec(
        page
      );

    expect(match).not.toBeNull();
    expect({
      moduleKey: match![1],
      activityCode: match![2],
      action: match![3]
    }).toEqual(CHANNEL_ACCOUNTS_GUARDS.releaseClaim);
    expect(page).toContain("authorize: RELEASE_GUARD");
    expect(route).toContain("CHANNEL_ACCOUNTS_GUARDS.releaseClaim");
  });

  test("the key is declared PLATFORM-scoped with MFA, and seeded as platform", () => {
    const module = listModules().find((m) => m.key === "channel_accounts")!;
    const permission = module.permissions!.find(
      (p) => `channel_accounts.${p.activityCode}.${p.action}` === KEY
    );

    expect(permission?.scope).toBe("platform");
    expect(permission?.requiresMfaEnrolment).toBe(true);

    const seed = read("sql/416_awcms_channel_accounts_claim_on_verify.sql");

    expect(seed).toMatch(
      /\('channel_accounts', 'account_claims', 'revoke',[\s\S]*?'platform'\)/
    );
  });

  test("the sidebar entry opens this page on the same key", () => {
    const module = listModules().find((m) => m.key === "channel_accounts")!;

    expect(module.navigation).toContainEqual(
      expect.objectContaining({
        path: "/admin/channel-account-claims",
        requiredPermission: KEY
      })
    );
  });

  test("a tenant-scoped decision never opens the screen: it reads no raw RBAC", () => {
    expect(page).not.toContain("ssr.permissions.has");
  });
});

describe("the screen reads nothing across tenants", () => {
  test("no SQL, no claim listing, no holder locator, no holder tenant shown", () => {
    expect(page).not.toMatch(/await tx`|awcms_channel_accounts|\bSELECT\b/);
    expect(page).not.toContain("findClaimHolder");
    expect(page).not.toContain("awcms_find_channel_account_claim_holder");
    expect(page).not.toContain("holderTenantId");
    expect(page).not.toContain("application/secret-store");
  });

  test("the only call is the guarded release endpoint (plus the step-up)", () => {
    const calls = [...page.matchAll(/sendJson\(\s*"([A-Z]+)",\s*"([^"]+)"/g)];

    expect(calls.map((c) => `${c[1]} ${c[2]}`).sort()).toEqual([
      "POST /api/v1/auth/mfa/step-up",
      "POST /api/v1/channel-accounts/claims/release"
    ]);
  });
});

describe("the mutation is idempotent, stepped up and typed-confirmed", () => {
  test("it sends an Idempotency-Key and reuses it for the step-up retry only", () => {
    expect(page).toContain('"Idempotency-Key": key');
    expect(page).toContain("const key = pendingKey ?? newKey()");
    expect(page).toContain("pendingKey = key");
    expect(page).toContain("pendingKey = null");
  });

  test("the confirmation is the external id typed again, checked before anything is sent", () => {
    expect(page).toContain("confirmationMatches(confirmation, externalId)");
    expect(page.indexOf("confirmationMatches(")).toBeLessThan(
      page.indexOf('"/api/v1/channel-accounts/claims/release"')
    );
  });

  test("the script touches no web storage and imports its helpers (CSP: external bundle)", () => {
    expect(page).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(page).toContain('from "../../lib/ui/admin-form-client"');
  });

  test("every error code the script maps is one the endpoint or the chokepoint emits", () => {
    const mapped = [...page.matchAll(/case "([A-Z_]+)":/g)].map((m) => m[1]!);
    const emittedByRoute = new Set(
      [...`${route}\n${release}`.matchAll(/"([A-Z][A-Z_]+)"/g)].map(
        (m) => m[1]!
      )
    );
    // Emitted by shared machinery the route is built on: the chokepoint
    // (access denial, MFA enrolment), the step-up endpoint, validation, the
    // idempotency runner and the rate limiter.
    const shared = new Set([
      "ACCESS_DENIED",
      "MFA_ENROLMENT_REQUIRED",
      "MFA_NOT_ACTIVE",
      "MFA_INVALID_CODE",
      "MFA_LOCKED",
      "VALIDATION_ERROR",
      "IDEMPOTENCY_CONFLICT",
      "RATE_LIMITED"
    ]);

    for (const code of mapped) {
      expect(emittedByRoute.has(code) || shared.has(code)).toBe(true);
    }

    expect(emittedByRoute.has("HAS_CHILD_ACCOUNTS")).toBe(true);
    expect(emittedByRoute.has("RESOURCE_NOT_FOUND")).toBe(true);
  });
});
