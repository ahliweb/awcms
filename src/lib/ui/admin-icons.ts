/**
 * Admin icon set — ADR-0120.
 *
 * ## Why path data in a TypeScript module
 *
 * The obvious alternatives are all worse HERE, for reasons specific to this
 * repo rather than to taste:
 *
 *   - **An icon font or an SVG sprite file.** Both are a network request for
 *     chrome that renders on every `/admin/*` page, and both add a file to
 *     `public/` — which is a GATED registry (`PUBLIC_ASSET_AUDIENCE` in
 *     `scripts/client-asset-budget.ts`). Inlining costs no request at all.
 *   - **An icon dependency.** This repo ships TWO runtime dependencies on
 *     purpose (see the block-editor decision recorded in
 *     `scripts/client-asset-budget.ts`). A general icon library is a large
 *     package for a closed set of ~30 glyphs.
 *   - **`<img src="…svg">`.** Cannot inherit `currentColor`, so every icon
 *     would need a light and a dark copy.
 *
 * So: path data, rendered into an inline `<svg>` by the Astro component that
 * needs it. `currentColor` means one definition themes itself, and the whole
 * set costs about 3 KB inside a stylesheet-sized chunk.
 *
 * ## The strings here are NOT user input, and that matters
 *
 * They are interpolated into `<path d={…}>` markup. Every value in this file is
 * build-time source written by us — nothing reads a database, a descriptor
 * field from an uploaded artifact, or a request. `resolveAdminIcon` returns the
 * FALLBACK for an unknown name rather than echoing the name, so even a
 * mis-typed key in a module descriptor cannot put arbitrary text into an
 * attribute.
 *
 * ## Drawing conventions
 *
 * 24x24 viewBox, stroke-based, no fill, 1.8 stroke width, round caps and joins.
 * Uniform on purpose: mixing filled and stroked glyphs in one list makes the
 * filled ones read as selected.
 */

/**
 * Path `d` data by icon name.
 *
 * Names are semantic-by-shape (`doc`, `gear`, `shield`), not semantic-by-screen
 * (`blogPosts`, `settings`). Two screens that look like a document should be
 * able to share one glyph without one of them being named after the other.
 */
export const ADMIN_ICON_PATHS = Object.freeze({
  dashboard: "M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  page: "M4 4h16v16H4zM4 9h16M9 9v11",
  tag: "M20.6 13.4 12 22l-9-9V3h10zM7.5 7.5h.01",
  home: "M3 10.5 12 3l9 7.5V21H3zM9 21v-7h6v7",
  ads: "M3 5h18v11H3zM8 20h8M12 16v4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 7 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3 13.6a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 7l-.06-.06a2 2 0 1 1 2.83-2.83L7.43 4.2A1.7 1.7 0 0 0 9.3 4.5h.1A1.7 1.7 0 0 0 10.4 3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 17 4.6l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0 1.2 2.87H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.7",
  image:
    "M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 16l-5-5L6 19",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  sync: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  check: "M20 6 9 17l-5-5",
  bolt: "m13 2-9 12h7l-1 8 9-12h-7z",
  building: "M4 21V6l8-3 8 3v15M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01",
  key: "M15 7a4 4 0 1 1-3.2 6.4L4 21H2v-3l7.6-7.6A4 4 0 0 1 15 7",
  puzzle:
    "M4 4h7v3a2 2 0 1 0 4 0V4h5v5h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H4z",
  database:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  palette:
    "M12 21a9 9 0 1 1 0-18c5 0 9 3.6 9 8 0 2.2-1.8 4-4 4h-2a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21M7.5 11.5h.01M10.5 8h.01M15 8h.01",
  moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  film: "M3 4h18v16H3zM7 4v16M17 4v16M3 12h18",
  file: "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM13 2v7h7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-3.5-3.5",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9s-1.2 6.3-3.7 9c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 1 1 8 0v4",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  layers: "m12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v7H2v-7z",
  flag: "M4 22V4h11l-1 3h6l-2 5 2 5h-9l-1-3H4",
  map: "m9 4-6 3v13l6-3 6 3 6-3V4l-6 3zM9 4v13M15 7v13",
  handshake: "M12 6 9 3 2 10l4 4M12 6l3-3 7 7-4 4M6 14l4 4 2-2 2 2 4-4",
  /** The last resort. See `resolveAdminIcon`. */
  dot: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10"
});

export type AdminIconName = keyof typeof ADMIN_ICON_PATHS;

/**
 * The glyph used when a name is unknown.
 *
 * A neutral dot rather than nothing: a missing icon leaves a 17px hole that
 * knocks its label out of alignment with every other row, which reads as a
 * broken menu rather than as a missing glyph. A dot keeps the list aligned and
 * is visibly the odd one out — findable, but not alarming.
 */
export const FALLBACK_ADMIN_ICON: AdminIconName = "dot";

/**
 * Path data for `name`, or the fallback glyph.
 *
 * NEVER returns `name` itself. That is the property that keeps this safe to
 * interpolate into an SVG attribute even though `ModuleDescriptor.navigation[].icon`
 * is a free-form string: an unrecognised value becomes a dot, not markup.
 */
export function resolveAdminIcon(name: string | undefined): string {
  if (name !== undefined && name in ADMIN_ICON_PATHS) {
    return ADMIN_ICON_PATHS[name as AdminIconName];
  }

  return ADMIN_ICON_PATHS[FALLBACK_ADMIN_ICON];
}
