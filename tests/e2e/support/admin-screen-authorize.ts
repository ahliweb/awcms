/**
 * Which permission an admin screen demands of whoever loads it.
 *
 * ## What this is for
 *
 * The render sweep needs to know what the seeded OWNER is owed by each screen,
 * and "a rendered page" is not the answer everywhere. Two screens are
 * platform-scoped (ADR-0053): `/admin/tenants` lists every tenant on the
 * platform, `/admin/partner-registry` lists every partnership. The blanket
 * grant a tenant owner receives filters on `scope = 'tenant'`, so an ordinary
 * owner is refused there — and that refusal is the product working.
 *
 * Without this, the sweep can only assert what is true of both cases, which is
 * `200` — and `200` is exactly what a broken screen returns too. Knowing which
 * screens owe a refusal is what lets the other 46 be held to rendering.
 *
 * ## Read from the page, cross-checked against the code registry
 *
 * The triple is parsed out of the page's own `authorize:` block, then looked up
 * in `platformScopedPermissionKeys()` — which is built from the module
 * descriptors, not from the page. So the page says WHICH permission it wants
 * and the registry says what that permission IS; neither one alone decides.
 *
 * The honest limit, stated because the same shape has already fooled me once in
 * this suite: if a screen named the wrong permission, this would compute the
 * wrong expectation and pass. It defends against a screen breaking, not against
 * a screen being mis-declared. `admin:screen-coverage:check` is what watches the
 * declaration.
 */
import { readFileSync } from "node:fs";

import { permissionKey } from "../../../src/modules/identity-access/domain/access-control";
import { platformScopedPermissionKeys } from "../../../src/modules/identity-access/domain/platform-scope";

/**
 * The `moduleKey` / `activityCode` / `action` triples in a screen's
 * SCREEN-LEVEL `authorize` — one object, or an array of them.
 *
 * Bounded to the slice between `authorize:` and the `load:` that follows it.
 * Admin pages are full of further triples (`can({ … })` guards deciding whether
 * a create button renders); those govern controls, not entry, and folding them
 * in would claim a screen needs a permission it only needs for one button.
 */
export function extractScreenAuthorizeKeys(source: string): string[] {
  const start = source.indexOf("authorize:");
  if (start === -1) return [];

  const rest = source.slice(start);
  const end = rest.indexOf("\n  load:");
  const slice = end === -1 ? rest.slice(0, 1_000) : rest.slice(0, end);

  const triple =
    /moduleKey:\s*"([a-z0-9_]+)"[\s\S]{0,200}?activityCode:\s*"([a-z0-9_]+)"[\s\S]{0,200}?action:\s*"([a-z0-9_]+)"/g;

  const keys: string[] = [];
  for (const match of slice.matchAll(triple)) {
    keys.push(permissionKey(match[1]!, match[2]!, match[3]!));
  }
  return keys;
}

/** Does loading this screen require a permission no tenant owner can hold? */
export function requiresPlatformScope(sourceFile: string): boolean {
  const keys = extractScreenAuthorizeKeys(readFileSync(sourceFile, "utf8"));
  const platform = platformScopedPermissionKeys();
  return keys.some((key) => platform.has(key));
}
