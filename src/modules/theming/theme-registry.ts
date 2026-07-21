/**
 * The reviewed, build-time THEME registry (ADR-0034 Fase 3; ported from
 * awcms-micro Issue #269/ADR-0029 §3) — the theme-descriptor analogue of
 * `src/modules/index.ts` for module descriptors.
 *
 * `listThemeDescriptors()` returns the reviewed in-repo base themes
 * (`BASE_THEME_DESCRIPTORS`). EVERY descriptor is validated by
 * `assertValidThemeDescriptor` at load time, so a malformed or CSP-weakening
 * theme fails the build/tests, never renders.
 *
 * awcms removed the derived-application pathway (ADR-0034 Fase 2), so — unlike
 * the awcms-micro origin — there is NO `application-theme-registry.ts` seam and
 * no derived theme. Website/theme modules live directly in this base
 * ("template dipakai-langsung"). `composeThemeDescriptors` still accepts an
 * optional `extraThemes` argument so its validate-and-dedupe logic (a theme may
 * not shadow another theme's key) stays unit-testable without a seam file.
 *
 * This composition is 100% static/compile-time: no database, no upload, no
 * runtime discovery. A theme is trusted, reviewed source; only a tenant's DATA
 * configuration of a theme (`ThemeConfig`) lives in the database.
 */
import {
  assertValidThemeDescriptor,
  type ThemeDescriptor
} from "./domain/theme-descriptor";
import { defaultTheme } from "./themes/default-theme";

/** The base themes this repository ships. Order is not significant. */
export const BASE_THEME_DESCRIPTORS: readonly ThemeDescriptor[] = [
  defaultTheme
];

/** The theme every tenant falls back to when none is selected. */
export const DEFAULT_THEME_KEY = defaultTheme.themeKey;

/**
 * Compose the effective registry, validating each descriptor and rejecting a
 * `themeKey` collision (no theme may shadow another theme's key). Pure over its
 * `extraThemes` argument — the base build passes nothing (registry = the base
 * themes); tests may pass extra themes to exercise the validate/dedupe gate.
 */
export function composeThemeDescriptors(
  extraThemes: readonly ThemeDescriptor[] = []
): ThemeDescriptor[] {
  const composed: ThemeDescriptor[] = [];
  const seen = new Set<string>();

  const add = (descriptor: ThemeDescriptor): void => {
    assertValidThemeDescriptor(descriptor);
    if (seen.has(descriptor.themeKey)) {
      throw new Error(
        `Duplicate theme key "${descriptor.themeKey}" — a theme may not shadow another theme's key (ADR-0034 Fase 3).`
      );
    }
    seen.add(descriptor.themeKey);
    composed.push(descriptor);
  };

  for (const descriptor of BASE_THEME_DESCRIPTORS) add(descriptor);
  for (const descriptor of extraThemes) add(descriptor);
  return composed;
}

let cached: ThemeDescriptor[] | null = null;

/** The effective, validated theme registry (the reviewed base themes). Cached. */
export function listThemeDescriptors(): ThemeDescriptor[] {
  if (cached === null) {
    cached = composeThemeDescriptors();
  }
  return cached;
}

/** Look up one theme by key (latest/only version in the registry), or `null`. */
export function getThemeDescriptor(themeKey: string): ThemeDescriptor | null {
  return listThemeDescriptors().find((t) => t.themeKey === themeKey) ?? null;
}
