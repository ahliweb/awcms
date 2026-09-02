🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0120-the-admin-redesign-splits-one-hue-into-three-roles.id.md)

# ADR-0120 — the admin redesign splits one hue into three roles, and gates the split

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision maker:** ahliweb
- **Supersedes:** nothing. It CHANGES the token values in [`docs/awcms/14_ui_ux_design_system.md`](../awcms/14_ui_ux_design_system.md) §Design tokens, which is a standards change and therefore needs an ADR (AGENTS.md §"Aturan wajib").
- **Related:** `src/styles/tokens.css`; `src/styles/admin.css`; `src/styles/admin-screens.css`; `src/styles/auth.css`; `src/layouts/AdminLayout.astro`; `src/lib/ui/admin-icons.ts`; `src/lib/ui/admin-command-palette.ts`; `src/modules/module-management/domain/sidebar-menu.ts`; `scripts/design-token-contrast-check.ts`; `scripts/client-asset-budget.ts`; Issue #434 and PR #720 (the two earlier occurrences of the defect this gates)

## Context

A design reference for the admin surface was supplied as a Claude Design canvas
(`redesign/AWCMS Admin.dc.html`) covering a shell — topbar, grouped sidebar,
command palette — and ten screens. Adopting it is mostly ordinary work. Three
things about it were not, and they are what this ADR is for.

### 1. The obvious colour pairing fails WCAG, and it failed twice before

The canvas uses a tint pair everywhere a status is shown: `--color-X` as text on
`--color-X-soft` as background. Status badges in every table row, the active
sidebar link, the selected filter chip, the bulk-selection bar.

Measured in the light theme:

```
primary  #2563eb on #e8effc   4.48:1   FAIL
success  #12873d on #e4f5ea   4.07:1   FAIL
warning  #b45309 on #fdf1de   4.50:1   at the threshold, no margin
danger   #dc2626 on #fdeaea   4.17:1   FAIL
info     #0e7490 on #e0f2f6   4.65:1   pass
```

Three of five fail the 4.5:1 that
[`docs/awcms/14_ui_ux_design_system.md`](../awcms/14_ui_ux_design_system.md)
§Aksesibilitas promises, and the fourth has nothing left.

**This is the third and fourth time this repo has found this defect class.**

1. Issue #434 found `--color-primary` with white text at 3.68:1 in the dark
   theme. The fix was the `-strong` token family, and `tokens.css` carries an
   excellent docblock explaining it.
2. PR #720 found the _same_ defect again in `StatusBadge`'s `info` variant —
   3.68:1 light, 2.43:1 dark — in a file whose own comment already described the
   rule it was breaking.
3. and 4. This redesign, in the opposite direction: dark text on a pale tint,
   plus `--color-text-faint` passing on `--color-surface` (4.63:1) while failing
   on `--color-surface-3` (4.39:1) — which is the `<thead>` background, where
   that token is used most.

The pattern is consistent: one hue is asked to serve more than one background,
and the value that is right for the common case is wrong for the other. Prose
has now failed to stop it four times.

### 2. A control border that identifies nothing

Separately, `--color-border` measures **1.29:1** (light) and **1.34:1** (dark)
against its surface. WCAG 2.1 **1.4.11 Non-text Contrast** (level AA) requires
3:1 for "visual information required to identify user interface components".
An input's fill differs from the card around it by 1.03:1, so that border is the
only thing saying where the field is.

This predates the redesign — the previous `#d8dee6` measured 1.35:1 — and went
unnoticed because nothing could notice it.

### 3. A contract field that was declared, validated, and dead

`ModuleDescriptor.navigation[].icon` has been in the module contract, checked by
the composition validator, and threaded through `SidebarDefaultEntry` and
`ComposedEntry` since the sidebar was ported. No module set it and
`AdminLayout.astro` never read it. The redesign needs an icon per nav entry.

## Decision

### One hue, three roles, three token families

A status colour now has up to three values, each named for the job it does:

| Family      | Job                                         | Example                                |
| ----------- | ------------------------------------------- | -------------------------------------- |
| `--color-X` | text or border on `--color-surface`         | a link; the outlined `.btn-danger`     |
| `-strong`   | solid fill under `--color-primary-contrast` | `.btn-primary`; the avatar disc        |
| `-on-soft`  | text on `--color-X-soft`                    | status badges; the active sidebar link |

`-strong` already existed (Issue #434). `-on-soft` is added here for all five
status hues. `--color-border-strong` is added for the 1.4.11 case, and
`--color-border` deliberately keeps its hairline value — 1.4.11 governs
boundaries that identify an operable component, not decorative separators, and
darkening card edges and table rules would turn a dense surface into a grid.

Every value is measured, in both themes, against every surface it lands on.

### The measurement is a gate, not a comment

`bun run design:token-contrast:check` (in the `bun run check` chain) reads
`tokens.css`, resolves the dark theme as an override layer over light, and
asserts a registry of 25 foreground/background pairs — 50 measurements across
the two themes.

It is a registry rather than a sweep for the reason `i18n:screens:check` gives
for not scanning attributes: a sweep over every token combination reports
hundreds of pairs nobody renders and trains its readers to ignore it. Each entry
names the rule that renders it, so a pairing introduced in CSS with no entry here
is visible in review as a rule with no entry. A token a pair names disappearing
is a failure, so a rename cannot quietly stop the measuring.

It refuses values it cannot parse (`rgb()`, `color-mix()`, 3-digit hex) rather
than skipping them, because a gate that silently ignores its input is the
"green while wrong" mode this repo keeps rediscovering.

**Its own first version was green for the wrong reason**, and the bug is
recorded in the script: `indexOf(':root[data-theme="dark"]')` matched that
selector inside `tokens.css`'s own header COMMENT, so the "dark" theme silently
inherited every light value. It is anchored to the start of a line now.

### The dead `icon` field becomes live

`DEFAULT_SIDEBAR_ICONS` in `sidebar-menu.ts` maps `labelKey` to an icon name,
and `buildDefaultSidebarModel` resolves `nav.icon ?? resolveSidebarIcon(...)` —
so a descriptor that declares its own icon WINS and the contract field is real,
while no module has to be edited for the default to work. `labelKey` is the key
because it is already gated for completeness in both directions.

Path data lives in `src/lib/ui/admin-icons.ts` and `resolveAdminIcon` never
echoes an unknown name back, so a mis-typed descriptor value renders a neutral
dot rather than putting arbitrary text into an SVG attribute.

### The shell owns the page title

`AdminLayout` renders a header band — breadcrumb, `<h1>`, description, and a
`page-actions` slot. All 45 screens that rendered their own
`<header class="page-header">` stopped. Before this, every screen showed its
name twice: once from the layout's `title` prop and once from its own `<h1>`,
frequently in two different languages, because 20 of those props were literal
English while the `<h1>` was `t(...)`.

The breadcrumb's middle segment is DERIVED from the composed sidebar rather than
passed by the page — `composeSidebarSections` already marked the current entry,
and asking 45 pages to name their own section would recreate exactly the drift
the removed `active` prop caused.

### Self-hosted typeface, and a third asset budget

The canvas specifies Public Sans and JetBrains Mono via Google Fonts, which this
repo's `default-src 'self'` CSP blocks outright. They are self-hosted (five
latin/latin-ext `woff2` subsets, 104,004 B) — the only way that typeface renders
at all under the existing policy, and it widens the CSP by no origin.

`scripts/client-asset-budget.ts` gains a `font` audience with its own ceiling
rather than folding fonts into `APP_BUDGET_BYTES`. That budget's job is
"catching slow growth one admin screen at a time"; a 104 KB step change inside a
193,500 B ceiling would have required roughly doubling it, and a doubled ceiling
detects nothing. Its per-file rule is likewise split by kind — the 27,000 B
number's stated premise is "an island bundled a dependency", which is a premise
about scripts, and it has now been broken twice by the admin stylesheet.

## Consequences

### What this buys

- The AA promise in doc 14 is now enforced rather than asserted. The gate fails
  on all four historical defects: reverting `--color-success-on-soft` to the
  plain token reproduces 4.07:1 and reddens; so does restoring the hairline
  control border, and so does an unparseable colour notation.
- One change to `tokens.css` moves all 48 admin screens, because the token NAMES
  did not change — only their values, plus additive families.
- `ModuleDescriptor.navigation[].icon` is a field that does something.

### What it costs, stated plainly

- **Three families is more to learn than one.** Someone adding a status colour
  must now decide which background it sits on. The gate is what makes that
  decision visible instead of optional, and the tables above are the answer key.
- **The contrast registry is not automatic.** A new pairing added to CSS without
  a line in `PAIRS` is not measured. Two things push against that: `renderedBy`
  makes an unregistered pairing visible in review, and the registry fails when a
  token it names disappears.
- **`--color-border-strong` is visibly darker than the reference canvas.** The
  canvas was not measured against 1.4.11; doc 14's promise binds harder than a
  canvas value.
- **`--color-text-faint` also departs from the canvas** (`#8b959f`/`#6d7883`
  measure 3.04:1 and 3.87:1). It carries table column headings and audit
  timestamps — information, not decoration.
- **The APP budget rose 193,500 → 218,000.** Measured: JS +1,369 B (the entire
  command palette), CSS +19,466 B, all of the latter in the two stylesheets
  every screen already loads. Not the Issue #552 duplication shape; the opposite,
  since 45 screens shed their own header markup.
- **The admin now ships 104 KB of fonts.** Latin only, `unicode-range`-gated so
  58,264 B of it is unconditional. A locale needing another script must add its
  subsets, and `FONT_BUDGET_BYTES` is where that becomes visible.
- **Sidebar section collapse is not remembered.** `<details open>` on every
  section, with nothing persisting the toggle — chosen over script because a
  CSS-only control is strictly better under this CSP, and because a
  remembered-collapsed section hides screens from someone who does not know it
  collapses.

### Deliberately not adopted from the canvas

- **The tenant SWITCHER.** The canvas draws the tenant pill with a dropdown
  chevron. `awcms_tenant_users` scopes an identity to exactly one tenant, so
  there is nothing to switch to; `TenantBadge.astro`'s own header already argues
  that a control which looks like a disabled switcher is worse than no control.
  The pill and its mark tile are adopted; the chevron is not.
- **A two-line account cluster.** The canvas shows display name over email.
  `SsrContext` carries neither, and a third query per `/admin/*` render for
  chrome is not worth it. One line — the role list — which is what this topbar
  has always shown.
