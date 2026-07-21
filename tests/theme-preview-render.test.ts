/**
 * Unit tests for the preview view-model builder + the render resolver's safe
 * fallbacks (Issue #269, ADR-0029 §6/§7).
 */
import { describe, expect, test } from "bun:test";

import { buildPreviewViewModel } from "../src/modules/theming/application/theme-preview-render";
import {
  defaultThemeCss,
  resolveVersionThemeCss
} from "../src/modules/theming/application/theme-render-resolver";
import type { ThemeConfigVersion } from "../src/modules/theming/application/theme-config-directory";
import { defaultThemeConfig } from "../src/modules/theming/domain/theme-config";
import { defaultTheme } from "../src/modules/theming/themes/default-theme";

describe("buildPreviewViewModel", () => {
  test("respects the section order and slot selections, maps the logo asset", () => {
    const config = {
      ...defaultThemeConfig(defaultTheme),
      sectionOrder: ["cta", "hero"],
      slotSelections: {
        header: "split",
        footer: "columns",
        nav_style: "hamburger"
      },
      navPlacement: "side"
    };
    const model = buildPreviewViewModel(defaultTheme, config, {
      logo: { url: "https://media.example/logo.png", altText: "Logo" }
    });
    expect(model.themeKey).toBe("aria");
    expect(model.sections.map((s) => s.key).slice(0, 2)).toEqual([
      "cta",
      "hero"
    ]);
    expect(model.headerVariant).toBe("split");
    expect(model.footerVariant).toBe("columns");
    expect(model.navPlacement).toBe("side");
    expect(model.logo?.url).toBe("https://media.example/logo.png");
    expect(model.navItems.length).toBeGreaterThan(0);
  });

  test("falls back to slot defaults and null logo when unset", () => {
    const model = buildPreviewViewModel(
      defaultTheme,
      defaultThemeConfig(defaultTheme),
      {}
    );
    expect(model.headerVariant).toBe("centered");
    expect(model.logo).toBeNull();
  });
});

describe("resolveVersionThemeCss", () => {
  const version = (themeKey: string): ThemeConfigVersion => ({
    id: "v1",
    themeKey,
    themeVersion: "1.0.0",
    status: "published",
    versionNumber: 1,
    config: defaultThemeConfig(defaultTheme),
    configHash: "hash1",
    createdAt: new Date(),
    publishedAt: new Date()
  });

  test("serializes a known theme's version to CSS", () => {
    const resolved = resolveVersionThemeCss(version("aria"));
    expect(resolved.themeKey).toBe("aria");
    expect(resolved.css).toContain("--awcms-theme-color_primary: #2563eb;");
    expect(resolved.fingerprint).toBe("v1:hash1");
  });

  test("falls back to the default theme CSS when the version's theme is no longer registered", () => {
    const resolved = resolveVersionThemeCss(version("removed_derived_theme"));
    expect(resolved.themeKey).toBe(defaultThemeCss().themeKey);
    expect(resolved.css).toContain(":root");
  });
});
