/**
 * `/admin/security` gates against the endpoints it drives.
 *
 * The screen renders nothing that its own permission checks do not allow, but
 * those checks are UX only — the endpoints are the authority. The failure this
 * pins is the opposite one, and it is silent: a page that gates on a permission
 * key NO migration seeds hides the section from everyone, including the owner,
 * and looks like a working screen with an empty area. This repo has shipped
 * that bug twice (admin roles write, admin ABAC policy write), both times by
 * inventing a plausible action name.
 *
 * So: extract the guard triples from the route sources, extract the
 * `permissionKey(...)` triples from the page, and require the page's set to be
 * a subset of what the routes actually enforce AND of what the module
 * descriptor declares (which `module-management`'s permission sync compares
 * against the seed migrations).
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/security.astro";
const ROUTES = [
  "src/pages/api/v1/auth/sso-policy.ts",
  "src/pages/api/v1/auth/mfa/policy.ts",
  "src/pages/api/v1/auth/sso-providers/index.ts"
];

type Triple = `${string}.${string}.${string}`;

/** `{ moduleKey: "identity_access", activityCode: "sso_policy", action: "read" as const }` → `identity_access.sso_policy.read`. */
function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

/** `permissionKey("identity_access", "sso_policy", "read")` → the same shape. */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

describe("/admin/security permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const page = await readFile(PAGE, "utf8");
    const pageKeys = pageTriplesFrom(page);

    expect(pageKeys.size).toBeGreaterThan(0);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check below pass vacuously, which is the shape of gate this repo has
    // already been burned by.
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = new Set<Triple>(
      (listModules()
        .find((module) => module.key === "identity_access")
        ?.permissions?.map(
          (permission) =>
            `identity_access.${permission.activityCode}.${permission.action}`
        ) ?? []) as Triple[]
    );

    expect(declared.size).toBeGreaterThan(0);

    const source = await readFile(PAGE, "utf8");
    const missing = [...pageTriplesFrom(source)].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the MFA read gate is `mfa_admin.reset`, matching the endpoint's own odd choice", async () => {
    // Written down because it looks like a mistake and is not. `GET
    // /api/v1/auth/mfa/policy` guards on `reset`; a page that "corrected" this
    // to a nicer `mfa_admin.read` would name a permission no migration seeds
    // and hide the section from every caller.
    const page = await readFile(PAGE, "utf8");
    const route = await readFile("src/pages/api/v1/auth/mfa/policy.ts", "utf8");

    expect(guardTriplesFrom(route)).toContain(
      "identity_access.mfa_admin.reset"
    );
    expect(pageTriplesFrom(page)).toContain("identity_access.mfa_admin.reset");
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' break-glass rule and audit rows cannot be bypassed by
    // rendering a form that writes for itself.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain('sendJson("PATCH", "/api/v1/auth/sso-policy"');
    expect(page).toContain('sendJson("PUT", "/api/v1/auth/mfa/policy"');
  });

  test("the sidebar entry points at a page that exists and has a resolved label", async () => {
    const nav = listModules()
      .find((module) => module.key === "identity_access")
      ?.navigation?.find((entry) => entry.path === "/admin/security");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("identity_access.sso_policy.read");
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS in both directions; this only pins the gate, which
    // it does not check.
    await expect(Bun.file(PAGE).exists()).resolves.toBe(true);
  });
});
