/**
 * The base "Aria" default theme (Issue #269, ADR-0029). A trusted, reviewed,
 * build-time `ThemeDescriptor` — the reference theme every AWCMS tenant
 * can select and configure, and the shape every in-repo base theme mirrors.
 * (awcms has no derived-repo theme seam; the derived-application pathway was
 * removed in ADR-0034 Fase 2, so themes live directly in this base registry.)
 *
 * Every default value here is itself validated by the registry
 * (`assertValidThemeDescriptor` + `resolveThemeTokens` in a unit test), so a
 * malformed default fails the build/tests rather than shipping. The token
 * defaults are chosen to meet WCAG AA contrast on the default surfaces.
 */
import { defineTheme } from "../domain/theme-descriptor";

export const defaultTheme = defineTheme({
  themeKey: "aria",
  version: "1.0.0",
  name: "Aria",
  owner: "@ahliweb",
  description:
    "The AWCMS reference theme: a clean, accessible, responsive website layout with a semantic design-token palette, header/footer/nav slot variants, and orderable home sections. Self-contained (no inline script, no external font/script) so it never weakens CSP.",
  origin: "base",
  fontFamilies: [
    {
      key: "system",
      label: "System sans-serif",
      stack:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif'
    },
    {
      key: "humanist",
      label: "Humanist sans-serif",
      stack: '"Inter", system-ui, sans-serif'
    },
    {
      key: "serif",
      label: "Serif",
      stack: 'Georgia, "Times New Roman", serif'
    },
    {
      key: "mono",
      label: "Monospace",
      stack: "ui-monospace, SFMono-Regular, Menlo, monospace"
    }
  ],
  tokens: [
    {
      key: "color_primary",
      kind: "color",
      label: "Primary",
      description: "Primary brand color (links, buttons).",
      default: "#2563eb"
    },
    {
      key: "color_on_primary",
      kind: "color",
      label: "On primary",
      description: "Text/icon color on primary surfaces.",
      default: "#ffffff"
    },
    {
      key: "color_background",
      kind: "color",
      label: "Background",
      description: "Page background.",
      default: "#ffffff"
    },
    {
      key: "color_surface",
      kind: "color",
      label: "Surface",
      description: "Card/section surface.",
      default: "#f8fafc"
    },
    {
      key: "color_text",
      kind: "color",
      label: "Text",
      description: "Primary body text.",
      default: "#0f172a"
    },
    {
      key: "color_muted",
      kind: "color",
      label: "Muted text",
      description: "Secondary/muted text.",
      default: "#475569"
    },
    {
      key: "color_border",
      kind: "color",
      label: "Border",
      description: "Divider/border color.",
      default: "#e2e8f0"
    },
    {
      key: "color_accent",
      kind: "color",
      label: "Accent",
      description: "Accent/highlight color.",
      default: "#0ea5e9"
    },
    {
      key: "font_body",
      kind: "font_family",
      label: "Body font",
      description: "Body text family.",
      default: "system"
    },
    {
      key: "font_heading",
      kind: "font_family",
      label: "Heading font",
      description: "Heading family.",
      default: "system"
    },
    {
      key: "font_size_base",
      kind: "dimension",
      label: "Base font size",
      description: "Root font size.",
      constraint: { units: ["rem", "px"], min: 0.875, max: 1.5 },
      default: "1rem"
    },
    {
      key: "radius_base",
      kind: "dimension",
      label: "Corner radius",
      description: "Base border radius.",
      constraint: { units: ["rem", "px"], min: 0, max: 2 },
      default: "0.5rem"
    },
    {
      key: "space_unit",
      kind: "dimension",
      label: "Spacing unit",
      description: "Base spacing scale unit.",
      constraint: { units: ["rem", "px"], min: 0.25, max: 3 },
      default: "1rem"
    },
    {
      key: "container_max_width",
      kind: "dimension",
      label: "Container width",
      description: "Max content container width.",
      constraint: { units: ["rem", "px"], min: 20, max: 120 },
      default: "72rem"
    },
    {
      key: "line_height_base",
      kind: "number",
      label: "Line height",
      description: "Base body line height.",
      constraint: { min: 1.2, max: 2.2 },
      default: "1.5"
    }
  ],
  slots: [
    {
      key: "header",
      label: "Header layout",
      variants: [
        { key: "minimal", label: "Minimal" },
        { key: "centered", label: "Centered" },
        { key: "split", label: "Split" }
      ],
      default: "centered"
    },
    {
      key: "footer",
      label: "Footer layout",
      variants: [
        { key: "simple", label: "Simple" },
        { key: "columns", label: "Columns" }
      ],
      default: "simple"
    },
    {
      key: "nav_style",
      label: "Navigation style",
      variants: [
        { key: "inline", label: "Inline" },
        { key: "hamburger", label: "Hamburger" }
      ],
      default: "inline"
    }
  ],
  assetSlots: [
    { key: "logo", label: "Logo", kind: "logo" },
    { key: "favicon", label: "Favicon", kind: "favicon" },
    { key: "hero_image", label: "Hero image", kind: "image" }
  ],
  contentSections: [
    { key: "hero", label: "Hero" },
    { key: "featured", label: "Featured" },
    { key: "latest", label: "Latest" },
    { key: "about", label: "About" },
    { key: "cta", label: "Call to action" }
  ],
  navPlacements: ["top", "side"],
  accessibility: {
    minContrastRatio: 4.5,
    supportsReducedMotion: true,
    supportsResponsive: true,
    keyboardNavigable: true,
    landmarks: ["banner", "navigation", "main", "contentinfo"]
  },
  csp: {
    requiresInlineStyle: false,
    requiresInlineScript: false,
    externalStyleSources: [],
    externalScriptSources: [],
    externalFrameSources: []
  },
  compatibility: {
    minModuleContractVersion: "1.2.0",
    supportedResourceTypes: [
      "home",
      "page",
      "blog_index",
      "blog_post",
      "search",
      "error"
    ]
  }
});
