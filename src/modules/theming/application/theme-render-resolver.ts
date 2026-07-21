/**
 * Theme render resolution (Issue #269, ADR-0029 §7): turn a persisted theme
 * config version into the `text/css` custom-property stylesheet the public
 * layout links, plus a stable cache fingerprint. Pure over its inputs except
 * `resolveActiveThemeCssForTenant`, which reads the tenant's active pointer.
 *
 * A theme descriptor is looked up in the BUILD-TIME registry
 * (`getThemeDescriptor`). If a stored config references a theme that is no
 * longer in the registry (e.g. a derived theme removed in a later build), we
 * fall back to the DEFAULT theme's default CSS rather than trying to serialize
 * a config against an unknown token schema — safe by construction.
 */
import {
  defaultThemeConfig,
  serializeThemeTokensCss
} from "../domain/theme-config";
import { DEFAULT_THEME_KEY, getThemeDescriptor } from "../theme-registry";
import {
  fetchThemeTenantState,
  fetchVersionById,
  type ThemeConfigVersion
} from "./theme-config-directory";

export type ResolvedThemeCss = {
  css: string;
  /** Opaque cache validator — changes iff the emitted CSS would change. */
  fingerprint: string;
  themeKey: string;
};

/** The default theme's default-config CSS — the universal fallback. Computed once. */
function defaultThemeCss(): ResolvedThemeCss {
  const descriptor = getThemeDescriptor(DEFAULT_THEME_KEY);
  if (!descriptor) {
    // The base default theme is always registered; this is unreachable, but
    // stay fail-safe with an empty :root block rather than throwing in a route.
    return {
      css: ":root {\n}\n",
      fingerprint: "default-empty",
      themeKey: DEFAULT_THEME_KEY
    };
  }
  const css = serializeThemeTokensCss(
    descriptor,
    defaultThemeConfig(descriptor)
  );
  return {
    css,
    fingerprint: `${descriptor.themeKey}@${descriptor.version}:default`,
    themeKey: descriptor.themeKey
  };
}

/**
 * Serialize a specific persisted version's config to CSS. Falls back to the
 * default theme CSS if the version's theme is no longer registered OR its stored
 * config fails re-validation (the serializer re-validates every token value; an
 * unexpected failure must degrade to the safe default, never emit unvalidated
 * CSS or 500 a public stylesheet).
 */
export function resolveVersionThemeCss(
  version: ThemeConfigVersion
): ResolvedThemeCss {
  const descriptor = getThemeDescriptor(version.themeKey);
  if (!descriptor) return defaultThemeCss();
  try {
    const css = serializeThemeTokensCss(descriptor, version.config);
    return {
      css,
      fingerprint: `${version.id}:${version.configHash}`,
      themeKey: descriptor.themeKey
    };
  } catch {
    return defaultThemeCss();
  }
}

/**
 * Resolve the CSS for a tenant's ACTIVE published theme version. Returns the
 * default theme CSS when the tenant has published nothing yet — so the public
 * token stylesheet is ALWAYS a valid 200 (there is no "does this host map to a
 * tenant" enumeration oracle: an unresolved tenant and a tenant with no active
 * theme both simply serve the default tokens).
 */
export async function resolveActiveThemeCssForTenant(
  tx: Bun.SQL,
  tenantId: string
): Promise<ResolvedThemeCss> {
  const state = await fetchThemeTenantState(tx, tenantId);
  if (!state.activeVersionId) return defaultThemeCss();
  const version = await fetchVersionById(tx, tenantId, state.activeVersionId);
  if (!version) return defaultThemeCss();
  return resolveVersionThemeCss(version);
}

export { defaultThemeCss };
