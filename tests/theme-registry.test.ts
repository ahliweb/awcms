/**
 * Unit tests for theme descriptor validation + the build-time registry
 * composition (ADR-0034 Fase 3; ported from awcms-micro Issue #269/ADR-0029 §3).
 * Proves: a theme cannot weaken CSP or drop a11y; every theme composes through
 * the SAME validation gate; a theme cannot shadow another theme's key; and every
 * default theme token value is itself safe.
 *
 * PORT ADAPTATION: awcms removed the derived-application pathway (ADR-0034 Fase
 * 2), so there is no `application-theme-registry.ts` seam and no
 * `tests/fixtures/derived-theme-example`. `composeThemeDescriptors` now takes an
 * optional `extraThemes` array; the "a second theme composes through the same
 * gate / may not shadow a base key" coverage is exercised with an inline
 * synthetic theme instead of a fixture file.
 */
import { describe, expect, test } from "bun:test";

import {
  InvalidThemeDescriptorError,
  assertValidThemeDescriptor,
  type ThemeDescriptor
} from "../src/modules/theming/domain/theme-descriptor";
import {
  BASE_THEME_DESCRIPTORS,
  composeThemeDescriptors,
  getThemeDescriptor,
  listThemeDescriptors
} from "../src/modules/theming/theme-registry";
import { defaultTheme } from "../src/modules/theming/themes/default-theme";
import {
  defaultThemeConfig,
  resolveThemeTokens
} from "../src/modules/theming/domain/theme-config";

describe("assertValidThemeDescriptor", () => {
  test("the base default theme is valid", () => {
    expect(() => assertValidThemeDescriptor(defaultTheme)).not.toThrow();
  });

  test("rejects a theme that requires an inline script (CSP weakening)", () => {
    const bad: ThemeDescriptor = {
      ...defaultTheme,
      csp: { ...defaultTheme.csp, requiresInlineScript: true }
    };
    expect(() => assertValidThemeDescriptor(bad)).toThrow(
      InvalidThemeDescriptorError
    );
  });

  test("rejects a theme that requires inline style", () => {
    const bad: ThemeDescriptor = {
      ...defaultTheme,
      csp: { ...defaultTheme.csp, requiresInlineStyle: true }
    };
    expect(() => assertValidThemeDescriptor(bad)).toThrow(
      InvalidThemeDescriptorError
    );
  });

  test("rejects a theme declaring an external script source outside the allow-list", () => {
    const bad: ThemeDescriptor = {
      ...defaultTheme,
      csp: {
        ...defaultTheme.csp,
        externalScriptSources: ["https://evil.example"]
      }
    };
    expect(() => assertValidThemeDescriptor(bad)).toThrow(
      InvalidThemeDescriptorError
    );
  });

  test("rejects a theme below WCAG AA contrast or not keyboard-navigable", () => {
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        accessibility: { ...defaultTheme.accessibility, minContrastRatio: 3 }
      })
    ).toThrow(InvalidThemeDescriptorError);
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        accessibility: {
          ...defaultTheme.accessibility,
          keyboardNavigable: false
        }
      })
    ).toThrow(InvalidThemeDescriptorError);
  });

  test("rejects an invalid theme key and a slot default that is not one of its variants", () => {
    expect(() =>
      assertValidThemeDescriptor({ ...defaultTheme, themeKey: "Bad Key" })
    ).toThrow(InvalidThemeDescriptorError);
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        slots: [
          {
            key: "header",
            label: "H",
            variants: [{ key: "a", label: "A" }],
            default: "z"
          }
        ]
      })
    ).toThrow(InvalidThemeDescriptorError);
  });

  test("rejects a theme requiring a newer module contract than this build ships (R-M3)", () => {
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        compatibility: {
          ...defaultTheme.compatibility,
          minModuleContractVersion: "99.0.0"
        }
      })
    ).toThrow(InvalidThemeDescriptorError);
  });

  test("rejects a theme with a malformed minModuleContractVersion", () => {
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        compatibility: {
          ...defaultTheme.compatibility,
          minModuleContractVersion: "not-a-version"
        }
      })
    ).toThrow(InvalidThemeDescriptorError);
  });

  test("rejects an empty or malformed supportedResourceTypes list", () => {
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        compatibility: {
          ...defaultTheme.compatibility,
          supportedResourceTypes: []
        }
      })
    ).toThrow(InvalidThemeDescriptorError);
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        compatibility: {
          ...defaultTheme.compatibility,
          supportedResourceTypes: ["home", ""]
        }
      })
    ).toThrow(InvalidThemeDescriptorError);
  });

  test("rejects a theme whose font-family stack is CSS-injection-shaped (R-L4)", () => {
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        fontFamilies: [
          {
            key: "system",
            label: "System",
            stack: "sans-serif; background: url(javascript:alert(1))"
          }
        ]
      })
    ).toThrow(InvalidThemeDescriptorError);
  });

  test("rejects a theme with an unsafe/out-of-range non-font default token value (R-L4)", () => {
    const colorToken = defaultTheme.tokens.find((t) => t.kind === "color");
    expect(colorToken).toBeDefined();
    expect(() =>
      assertValidThemeDescriptor({
        ...defaultTheme,
        tokens: defaultTheme.tokens.map((t) =>
          t.key === colorToken!.key
            ? { ...t, default: "red; background: url(x)" }
            : t
        )
      })
    ).toThrow(InvalidThemeDescriptorError);
  });
});

describe("composeThemeDescriptors", () => {
  test("base-only registry (no extra themes) is exactly the base themes", () => {
    const composed = composeThemeDescriptors();
    expect(composed.map((t) => t.themeKey)).toEqual(
      BASE_THEME_DESCRIPTORS.map((t) => t.themeKey)
    );
    expect(composed.some((t) => t.themeKey === "aria")).toBe(true);
  });

  test("an extra reviewed theme composes through the SAME validation gate", () => {
    const aurora: ThemeDescriptor = {
      ...defaultTheme,
      themeKey: "aurora",
      name: "Aurora",
      origin: "base"
    };
    const composed = composeThemeDescriptors([aurora]);
    const keys = composed.map((t) => t.themeKey);
    expect(keys).toContain("aria"); // base, untouched
    expect(keys).toContain("aurora"); // the extra, added + validated
  });

  test("a theme may NOT shadow another theme's key", () => {
    const shadow: ThemeDescriptor = { ...defaultTheme };
    expect(() => composeThemeDescriptors([shadow])).toThrow(
      /Duplicate theme key/
    );
  });

  test("an extra theme that would weaken CSP fails the compose gate", () => {
    const unsafe: ThemeDescriptor = {
      ...defaultTheme,
      themeKey: "unsafe",
      csp: { ...defaultTheme.csp, requiresInlineScript: true }
    };
    expect(() => composeThemeDescriptors([unsafe])).toThrow(
      InvalidThemeDescriptorError
    );
  });
});

describe("effective registry + default token safety", () => {
  test("listThemeDescriptors + getThemeDescriptor resolve the base default", () => {
    expect(listThemeDescriptors().length).toBeGreaterThanOrEqual(1);
    expect(getThemeDescriptor("aria")?.themeKey).toBe("aria");
    expect(getThemeDescriptor("does_not_exist")).toBeNull();
  });

  test("every default theme token value passes its own validator (defaults are safe)", () => {
    // resolveThemeTokens re-validates every value; throwing would mean a default is unsafe.
    expect(() =>
      resolveThemeTokens(defaultTheme, defaultThemeConfig(defaultTheme))
    ).not.toThrow();
  });
});
