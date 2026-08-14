/**
 * `/admin/account` agrees with the endpoints and the strings it drives (ADR-0096).
 *
 * The sibling page-contract tests pin PERMISSION gating. This screen has no
 * permissions by design (ADR-0096 §1 — its subject is the caller), so pinning
 * the same thing would be vacuous. What can silently rot here is different, and
 * this file pins the four that can:
 *
 * 1. **Every endpoint the client script calls exists.** A renamed route leaves
 *    a button that fails at runtime and nowhere else; `api:spec:check` validates
 *    routes against OpenAPI, never against the pages that call them.
 * 2. **Every `data-*` string the script reads is rendered by the page.** This is
 *    the writer-moved-readers-did-not class: the script falls back to English on
 *    a missing attribute, so the failure is a screen that looks fine and quietly
 *    stops being translated.
 * 3. **The display-name ceiling agrees** between the route's validation and the
 *    page's `maxlength`, since the route restates a constant it cannot import.
 * 4. **The page stays unpermissioned**, so a future edit cannot quietly install
 *    the latent-authz trap ADR-0058 §E describes on a self-service screen.
 *
 * Pure — reads source text. No database, no network.
 */
import { readFile, stat } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const PAGE = "src/pages/admin/account.astro";
const CLIENT = "src/lib/ui/admin-account-client.ts";
const PROFILE_ROUTE = "src/pages/api/v1/auth/profile.ts";

/** `data-foo-bar` on the page becomes `dataset.fooBar` in the script. */
function attributeToDatasetKey(attribute: string): string {
  return attribute
    .replace(/^data-/, "")
    .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("/admin/account drives endpoints that exist", () => {
  test("every same-origin API path the client script calls resolves to a route file", async () => {
    const client = await read(CLIENT);

    // Matches both the plain literals and the one template literal (the session
    // revoke path interpolates an id, so only its prefix is checked).
    const paths = new Set<string>();

    for (const match of client.matchAll(/["'`](\/api\/v1\/[^"'`$]*)/g)) {
      const path = (match[1] ?? "").replace(/\/$/, "");
      if (path.length > 0) paths.add(path);
    }

    // Guard the fixture: a regex that stopped matching would pass vacuously.
    expect(paths.size).toBeGreaterThan(5);

    const missing: string[] = [];

    for (const path of paths) {
      const base = path.replace(/^\/api\/v1\//, "");
      const candidates = [
        `src/pages/api/v1/${base}.ts`,
        `src/pages/api/v1/${base}/index.ts`,
        // `/api/v1/auth/sessions/` + an interpolated id.
        `src/pages/api/v1/${base}/[id].ts`
      ];

      const found = await Promise.all(
        candidates.map((candidate) =>
          readFile(candidate, "utf8").then(
            () => true,
            () => false
          )
        )
      );

      if (found.some(Boolean)) continue;

      // A template literal interpolates mid-path (`/auth/sso/${key}/link`), so
      // the harvested prefix stops at the `$` and names a DIRECTORY rather than
      // a route. Accepting an existing directory keeps the check meaningful —
      // a renamed `sso` folder still fails — without pretending to resolve a
      // segment only known at runtime. Verified as a directory, not merely
      // "something exists": a stray file of that name must not satisfy it.
      const directory = await stat(`src/pages/api/v1/${base}`).then(
        (entry) => entry.isDirectory(),
        () => false
      );

      if (!directory) missing.push(path);
    }

    expect(missing.sort()).toEqual([]);
  });
});

describe("/admin/account renders every string its script reads", () => {
  test("each dataset key the script looks up is present as a data attribute", async () => {
    const [page, client] = await Promise.all([read(PAGE), read(CLIENT)]);

    // `message("saving", "Saving…")` -> dataset key `saving`.
    const requested = [
      ...client.matchAll(/\bmessage\(\s*["']([A-Za-z0-9]+)["']/g)
    ].map((match) => match[1] ?? "");

    expect(requested.length).toBeGreaterThan(10);

    const rendered = new Set(
      [...page.matchAll(/\bdata-([a-z0-9-]+)=/g)].map((match) =>
        attributeToDatasetKey(`data-${match[1] ?? ""}`)
      )
    );

    const missing = [...new Set(requested)].filter((key) => !rendered.has(key));

    expect(missing.sort()).toEqual([]);
  });

  test("every rendered i18n data attribute is actually read by the script", async () => {
    // The other direction. An attribute nobody reads is a translated string
    // paying catalog and review cost for nothing, and it is how a `data-` blob
    // becomes a junk drawer.
    const [page, client] = await Promise.all([read(PAGE), read(CLIENT)]);

    const blockMatch = /<div\s+id="account-i18n"([\s\S]*?)>/.exec(page);
    expect(blockMatch).not.toBeNull();

    const rendered = [
      ...(blockMatch?.[1] ?? "").matchAll(/\bdata-([a-z0-9-]+)=/g)
    ].map((match) => attributeToDatasetKey(`data-${match[1] ?? ""}`));

    expect(rendered.length).toBeGreaterThan(10);

    const requested = new Set(
      [...client.matchAll(/\bmessage\(\s*["']([A-Za-z0-9]+)["']/g)].map(
        (match) => match[1] ?? ""
      )
    );

    const unread = rendered.filter((key) => !requested.has(key));

    expect(unread.sort()).toEqual([]);
  });
});

describe("/admin/account agrees with its route about limits and guards", () => {
  test("the display-name ceiling is the same number in the route and the page", async () => {
    const [page, route] = await Promise.all([read(PAGE), read(PROFILE_ROUTE)]);

    const routeLimit = /MAX_DISPLAY_NAME_LENGTH\s*=\s*(\d+)/.exec(route)?.[1];
    const pageLimit = /id="account-display-name"[\s\S]*?maxlength="(\d+)"/.exec(
      page
    )?.[1];

    expect(routeLimit).toBe("200");
    // The route restates `profile_identity`'s constant because it is not
    // exported; the page restates it again in an attribute. Two restatements
    // are two chances to drift, so the agreement is asserted rather than hoped
    // for.
    expect(pageLimit).toBe(routeLimit);
  });

  test("the screen declares no permission, so it cannot acquire a latent-authz wall", async () => {
    const page = await read(PAGE);

    // ADR-0096 §1: the subject is the caller. A `permissionKey(...)` appearing
    // here would mean somebody gated a self-service screen on an action no
    // migration seeds — which denies everyone, tenant owner included, while
    // reading as correctly guarded.
    expect(page).not.toContain("permissionKey(");
    expect(page).not.toContain("ssr.permissions");
  });
});
