/**
 * Preview VIEW MODEL builder (Issue #269, ADR-0029 §6). Pure: turns a theme
 * descriptor + validated config into a structured model the trusted
 * `PublicThemeLayout.astro` renders. No HTML is built here — Astro's own
 * auto-escaping renders every value — and no tenant value reaches this model
 * except the (already-validated) slot/section selections, so the preview cannot
 * inject markup.
 */
import type { ThemeConfig } from "../domain/theme-config";
import type { ThemeDescriptor } from "../domain/theme-descriptor";

/** A media asset already resolved to a safe same-tenant URL by the composition root. */
export type PreviewAsset = { url: string; altText: string | null };

export type PreviewSection = {
  key: string;
  label: string;
  heading: string;
  body: string;
};

export type PreviewViewModel = {
  themeName: string;
  themeKey: string;
  headerVariant: string;
  footerVariant: string;
  navVariant: string;
  navPlacement: string;
  sections: PreviewSection[];
  logo: PreviewAsset | null;
  navItems: { label: string; href: string }[];
};

/** Static demo copy per known section key (falls back to the section label). */
const SAMPLE_COPY: Record<string, { heading: string; body: string }> = {
  hero: {
    heading: "Welcome to your site",
    body: "This is a live preview of your theme with your selected design tokens applied."
  },
  featured: {
    heading: "Featured",
    body: "Highlight your most important content here."
  },
  latest: {
    heading: "Latest posts",
    body: "Your most recent articles will appear in this section."
  },
  about: {
    heading: "About",
    body: "Tell visitors who you are and what you do."
  },
  cta: {
    heading: "Get in touch",
    body: "Add a call to action to convert visitors."
  },
  showcase: {
    heading: "Showcase",
    body: "Show off your work in this section."
  }
};

/**
 * Build the preview view model. `sectionOrder` from the config drives the order;
 * `slotSelections` drive the header/footer/nav variants (falling back to the
 * descriptor defaults for any slot the theme declares but the config omits).
 */
export function buildPreviewViewModel(
  descriptor: ThemeDescriptor,
  config: ThemeConfig,
  assetUrls: Record<string, PreviewAsset>
): PreviewViewModel {
  const sectionLabelByKey = new Map(
    descriptor.contentSections.map((s) => [s.key, s.label])
  );
  const sections: PreviewSection[] = config.sectionOrder
    .filter((key) => sectionLabelByKey.has(key))
    .map((key) => {
      const label = sectionLabelByKey.get(key) ?? key;
      const copy = SAMPLE_COPY[key] ?? {
        heading: label,
        body: `Preview of the ${label} section.`
      };
      return { key, label, heading: copy.heading, body: copy.body };
    });

  const slot = (slotKey: string): string => {
    const spec = descriptor.slots.find((s) => s.key === slotKey);
    if (!spec) return "default";
    return config.slotSelections[slotKey] ?? spec.default;
  };

  return {
    themeName: descriptor.name,
    themeKey: descriptor.themeKey,
    headerVariant: slot("header"),
    footerVariant: slot("footer"),
    navVariant: slot("nav_style"),
    navPlacement: config.navPlacement,
    sections,
    logo: assetUrls.logo ?? null,
    navItems: [
      { label: "Home", href: "#" },
      { label: "About", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Contact", href: "#" }
    ]
  };
}
