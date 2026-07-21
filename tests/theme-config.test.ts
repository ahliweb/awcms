/**
 * Unit tests for tenant theme config validation + safe serialization (Issue
 * #269, ADR-0029 §4/§5). Proves the descriptor bounds the whole configurable
 * surface (unknown tokens/slots/assets/sections rejected) and that only safe
 * values ever reach the emitted CSS.
 */
import { describe, expect, test } from "bun:test";

import {
  THEME_CSS_CUSTOM_PROPERTY_PREFIX,
  defaultThemeConfig,
  resolveThemeTokens,
  serializeThemeTokensCss,
  validateThemeConfig,
  type ThemeConfig
} from "../src/modules/theming/domain/theme-config";
import { CssValueError } from "../src/modules/theming/domain/css-value-validation";
import { defaultTheme } from "../src/modules/theming/themes/default-theme";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("validateThemeConfig", () => {
  test("accepts a valid config and normalizes it", () => {
    const result = validateThemeConfig(defaultTheme, {
      themeKey: "aria",
      tokenOverrides: {
        color_primary: "#123456",
        font_body: "serif",
        line_height_base: "1.6"
      },
      slotSelections: { header: "split" },
      assetRefs: { logo: UUID },
      sectionOrder: ["cta", "hero"],
      navPlacement: "side"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokenOverrides.color_primary).toBe("#123456");
    expect(result.value.slotSelections.header).toBe("split");
    // Unset slots fall back to their defaults.
    expect(result.value.slotSelections.footer).toBe("simple");
    expect(result.value.assetRefs.logo).toBe(UUID);
    // Omitted sections are appended in declared order.
    expect(result.value.sectionOrder.slice(0, 2)).toEqual(["cta", "hero"]);
    expect(result.value.sectionOrder).toContain("about");
    expect(result.value.navPlacement).toBe("side");
  });

  test("rejects an unknown token key (declared-surface bounding)", () => {
    const result = validateThemeConfig(defaultTheme, {
      themeKey: "aria",
      tokenOverrides: { not_a_token: "#fff" }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.field === "tokenOverrides.not_a_token")
    ).toBe(true);
  });

  test("rejects a CSS-injection token value (the spine)", () => {
    const result = validateThemeConfig(defaultTheme, {
      themeKey: "aria",
      tokenOverrides: { color_primary: "url(javascript:alert(1))" }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.field === "tokenOverrides.color_primary")
    ).toBe(true);
  });

  test("rejects a font family outside the allow-list, accepts an allow-list key", () => {
    const bad = validateThemeConfig(defaultTheme, {
      themeKey: "aria",
      tokenOverrides: { font_body: "Comic Sans" }
    });
    expect(bad.ok).toBe(false);
    const good = validateThemeConfig(defaultTheme, {
      themeKey: "aria",
      tokenOverrides: { font_body: "mono" }
    });
    expect(good.ok).toBe(true);
  });

  test("rejects an unknown slot variant, unknown asset slot, non-UUID asset, unknown section, bad nav", () => {
    expect(
      validateThemeConfig(defaultTheme, {
        themeKey: "aria",
        slotSelections: { header: "nope" }
      }).ok
    ).toBe(false);
    expect(
      validateThemeConfig(defaultTheme, {
        themeKey: "aria",
        assetRefs: { not_a_slot: UUID }
      }).ok
    ).toBe(false);
    expect(
      validateThemeConfig(defaultTheme, {
        themeKey: "aria",
        assetRefs: { logo: "https://evil/x.png" }
      }).ok
    ).toBe(false);
    expect(
      validateThemeConfig(defaultTheme, {
        themeKey: "aria",
        sectionOrder: ["nope"]
      }).ok
    ).toBe(false);
    expect(
      validateThemeConfig(defaultTheme, {
        themeKey: "aria",
        navPlacement: "diagonal"
      }).ok
    ).toBe(false);
  });
});

describe("serializeThemeTokensCss / resolveThemeTokens", () => {
  test("emits a :root block of --awcms-theme-* custom properties with the default values", () => {
    const css = serializeThemeTokensCss(
      defaultTheme,
      defaultThemeConfig(defaultTheme)
    );
    expect(css).toContain(":root {");
    expect(css).toContain(
      `${THEME_CSS_CUSTOM_PROPERTY_PREFIX}color_primary: #2563eb;`
    );
    // font_family tokens emit the descriptor-owned CSS STACK, never the tenant key.
    expect(css).toContain("system-ui");
    expect(css).not.toContain("font_body: system;");
  });

  test("a valid override flows through to the emitted CSS", () => {
    const result = validateThemeConfig(defaultTheme, {
      themeKey: "aria",
      tokenOverrides: { color_primary: "#abcdef" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const css = serializeThemeTokensCss(defaultTheme, result.value);
    expect(css).toContain("color_primary: #abcdef;");
  });

  test("resolveThemeTokens RE-VALIDATES: a config smuggling an unsafe value throws at serialize time (defense in depth)", () => {
    // Bypass validateThemeConfig and hand a hostile config straight to the serializer.
    const hostile: ThemeConfig = {
      themeKey: "aria",
      tokenOverrides: { color_primary: "red;}body{display:none" },
      slotSelections: {},
      assetRefs: {},
      sectionOrder: [],
      navPlacement: "top"
    };
    expect(() => resolveThemeTokens(defaultTheme, hostile)).toThrow(
      CssValueError
    );
    expect(() => serializeThemeTokensCss(defaultTheme, hostile)).toThrow(
      CssValueError
    );
  });
});
