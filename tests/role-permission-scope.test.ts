/**
 * PROJECT_STATE §4 **R8** — a platform-scoped permission may not be attached to
 * an ordinary tenant's role.
 *
 * ## What this was, and what it was not
 *
 * It was never privilege escalation. The chokepoint's platform gate (ADR-0053)
 * always refused these at runtime, and it decides from a CODE-side declaration,
 * so no database row could lift it.
 *
 * What was missing is REDUNDANCY, and honesty: an administrator could grant one,
 * see it listed on the role, and reasonably conclude it applies. A grant that
 * appears given but can never take effect is a wrong answer to "who can do
 * what" — the answer the next access review has to trust. ADR-0058 is a whole
 * document about that class of ambiguity.
 *
 * The behavioural half (grant refused with 409 against a real database) is
 * DB-gated. What is asserted here is that the filter and the server-side
 * re-check both exist, and that neither was written as a UI-only courtesy.
 */
import { describe, expect, test } from "bun:test";

const ROLE_ADMIN = "src/modules/identity-access/application/role-admin.ts";
const ROLE_PERMISSIONS_ROUTE = "src/pages/api/v1/roles/[id]/permissions.ts";
const ROLES_SCREEN = "src/pages/admin/roles.astro";

describe("the catalog picker is filtered", () => {
  test("listPermissionCatalog requires an explicit scope decision", async () => {
    // Not an optional flag with a permissive default: a caller that forgets it
    // is a compile error, not a silently widened picker.
    const source = await Bun.file(ROLE_ADMIN).text();

    expect(source).toContain("includePlatformScoped: boolean");
    expect(source).toContain("WHERE scope = 'tenant'");
  });

  test("the screen decides it from the acting tenant, not from a constant", async () => {
    const source = await Bun.file(ROLES_SCREEN).text();

    expect(source).toContain("resolvePlatformTenant(");
    expect(source).toContain("includePlatformScoped:");
  });
});

describe("the server re-checks — a filtered dropdown is not a control", () => {
  test("grantPermissionToRole can refuse on scope", async () => {
    const source = await Bun.file(ROLE_ADMIN).text();

    expect(source).toContain("platform_scope_blocked");
    expect(source).toContain("mayTenantHoldPermission(");
  });

  test("the check runs BEFORE the insert, not after", async () => {
    // After the insert it would be a cleanup, and cleanups leave a window.
    const source = await Bun.file(ROLE_ADMIN).text();
    const grantAt = source.indexOf(
      "export async function grantPermissionToRole"
    );
    const body = source.slice(grantAt);

    const check = body.indexOf("mayTenantHoldPermission(");
    const insert = body.indexOf("INSERT INTO awcms_role_permissions");

    expect(check).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(check).toBeLessThan(insert);
  });

  test("the refusal reaches the API as a distinct 409, not a generic error", async () => {
    const source = await Bun.file(ROLE_PERMISSIONS_ROUTE).text();

    expect(source).toContain("platform_scope_blocked");
    expect(source).toContain("PLATFORM_SCOPE_REQUIRED");
  });
});

describe("the predicate is about the TENANT, not the role", () => {
  test("an unknown permission id falls through to the FK, not to a refusal", async () => {
    // One place decides "does this permission exist", and it is the foreign
    // key. A second existence check here would drift from it and would turn a
    // `PermissionNotFoundError` into a confusing scope refusal.
    const source = await Bun.file(ROLE_ADMIN).text();
    const fnAt = source.indexOf("async function mayTenantHoldPermission");
    const body = source.slice(fnAt, source.indexOf("\n}", fnAt));

    expect(body).toContain('scope !== "platform"');
    expect(body).toContain("return true");
  });

  test("a tenant-scoped permission is never blocked", async () => {
    const source = await Bun.file(ROLE_ADMIN).text();
    const fnAt = source.indexOf("async function mayTenantHoldPermission");
    const body = source.slice(fnAt, source.indexOf("\n}", fnAt));

    // The early return for the non-platform case comes before any platform
    // resolution, so an ordinary grant never pays for the lookup either.
    expect(body.indexOf('scope !== "platform"')).toBeLessThan(
      body.indexOf("resolvePlatformTenant(")
    );
  });
});
