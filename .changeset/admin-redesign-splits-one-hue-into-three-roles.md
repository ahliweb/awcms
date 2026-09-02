---
"awcms": minor
---

feat(ui): redesign the admin surface, and gate the contrast promise it kept breaking (ADR-0120)

The supplied design canvas (shell + ten screens) is adopted across all 48 admin
screens, the login surface and the four other auth pages. Three things in it
were not ordinary work.

**The canvas's status colour pairing fails WCAG, and this repo had already found
that defect class twice.** `--color-X` as text on `--color-X-soft` measures
4.48 / 4.07 / 4.50 / 4.17 / 4.65:1 in the light theme — three of five below the
4.5:1 that `docs/awcms/14_ui_ux_design_system.md` §Aksesibilitas promises, and
the fourth with no margin. Issue #434 found the same class (white on
`--color-primary`, 3.68:1) and PR #720 found it again in `StatusBadge`, inside a
file whose own comment described the rule it was breaking. So a semantic colour
now carries up to three values, each named for the background it sits on:
`--color-X` (text on a surface), `-strong` (solid fill under white text, already
present) and the new `-on-soft` (text on the matching tint).

**`--color-border` measured 1.29:1 against its surface.** WCAG 2.1 §1.4.11 asks
3:1 for a boundary that identifies an operable component, and an input's fill
differs from the card around it by 1.03:1 — that line is the only thing locating
the field. `--color-border-strong` is added for controls; `--color-border` stays
a hairline on purpose, because 1.4.11 governs controls rather than decorative
separators, and darkening card edges and table rules would turn a dense surface
into a grid. This predates the redesign: the previous `#d8dee6` measured 1.35:1.

**Prose failed to stop this four times, so the measurement is now a gate.**
`bun run design:token-contrast:check` joins `bun run check`: it reads
`tokens.css`, resolves dark as an override layer over light, and asserts a
registry of 25 foreground/background pairs — 50 measurements — refusing colour
notations it cannot parse rather than skipping them. Its own first version was
green for the wrong reason, matching `:root[data-theme="dark"]` inside
`tokens.css`'s header comment so the dark theme silently inherited every light
value; it is anchored to the start of a line now, and the bug is recorded in the
script.

Also in this change:

- **The shell owns the page title.** `AdminLayout` renders a header band
  (breadcrumb, `<h1>`, description, `page-actions` slot) and 45 screens stopped
  rendering their own — they had been showing their name twice, and for 20 of
  them the layout's copy was untranslated English beside a translated `<h1>`.
  The breadcrumb's middle segment is derived from the composed sidebar rather
  than passed by each page.
- **`ModuleDescriptor.navigation[].icon` is live.** It had been declared in the
  contract, validated by the composition checker and threaded through two type
  layers while no module set it and nothing rendered it. A `labelKey`-keyed
  default table now fills it, and a descriptor's own value still wins.
- **A command palette** (Cmd/Ctrl+K) that filters the nav entries already
  rendered into the page, so it cannot surface a screen the sidebar would not —
  structurally, not by policy. A native `<dialog>`, no fetch, 1,369 B.
- **The typeface is self-hosted.** `default-src 'self'` blocks Google Fonts
  outright, so Public Sans and JetBrains Mono ship as five `unicode-range`-gated
  latin subsets in `public/fonts/`. They are measured against a new `font`
  audience in `scripts/client-asset-budget.ts` rather than folded into
  `APP_BUDGET_BYTES`, whose job is catching 600 B per-screen growth and which a
  104 KB step change would have destroyed. A public content page loads none of
  them; the reader budget is unchanged at 21,415 B.
- **`APP_BUDGET_BYTES` 193,500 → 218,000**, with the gate's own question
  answered by measurement: JS +1,369 B and CSS +19,466 B, all of the latter in
  the two stylesheets every screen already loads. Not the Issue #552
  duplication shape — the opposite, since 45 screens shed their header markup.

Deliberately not adopted from the canvas: the tenant **switcher** (one identity
is scoped to one tenant, so the chevron would be exactly the fake affordance
`TenantBadge.astro` already argues against) and the two-line account cluster
(`SsrContext` carries neither a display name nor an email, and chrome does not
justify a third query per `/admin/*` render).
