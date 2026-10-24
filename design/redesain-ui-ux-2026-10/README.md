# UI/UX redesign — admin (October 2026)

Reference-only design proposal for the AWCMS admin shell. It keeps every token
name and every contrast-measured value in
[`src/styles/tokens.css`](../../src/styles/tokens.css) (ADR-0120) and changes
information architecture, screen hierarchy and status consistency. UI copy is
Indonesian.

**Not implemented.** These pages render example data only and call no API.
Nothing here changes runtime behaviour; a change to the admin shell still needs
its own issue (and an ADR where it changes a standard).

## How to view

```bash
python3 -m http.server 8080   # from the repository root
# then open http://localhost:8080/design/redesain-ui-ux-2026-10/AwcmsDashboard.dc.html
```

Serve the repository root, not this folder: the pages load this repo's own
fonts and icon by relative path. Each `*.dc.html` is a self-contained Design
Component page rendered by [`support.js`](support.js) — a byte-identical copy of
the vendor runtime in `ahliweb/omes` `ui/control-center/support.js`, which
loads React from unpkg, so viewing needs network access.
[`canvas.json`](canvas.json) records the artboard layout of the design canvas.

## Contents

| File                                               | Screen                                                                                                                                                  | Interactive          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [`Main.dc.html`](Main.dc.html)                     | 00 · Analysis of awcms, awcms-one, omes and awcms-astro; shared status vocabulary, admin type scale, proposed shell and screen patterns                 | no                   |
| [`AwcmsDashboard.dc.html`](AwcmsDashboard.dc.html) | Dashboard: brand + tenant switcher only in the sidebar head, Favourites, collapsed sections, "Perlu tindakan" queue above KPIs, sync health, audit feed | no                   |
| [`AwcmsUsers.dc.html`](AwcmsUsers.dc.html)         | Users: standard list pattern — status tabs with counts, filters, bulk actions, detail drawer                                                            | tabs, selection, row |

The other screens of the same canvas live in their own repositories under
`design/redesain-ui-ux-2026-10/`: `ahliweb/awcms-one` (commerce dashboard,
orders), `ahliweb/omes` (fleet overview, operation approval) and
`ahliweb/awcms-astro` (public home and service page).

## Assets used

| Asset                       | Source in this repo                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Public Sans, JetBrains Mono | [`public/fonts/*.woff2`](../../public/fonts) (same `unicode-range` split as `tokens.css`) |
| Brand mark                  | [`public/icons/icon-192.png`](../../public/icons/icon-192.png)                            |

## Data provenance

Every number, name and timestamp is example data, and each screen says so in a
banner. Labels for sidebar sections and entries come from
`src/modules/module-management/domain/sidebar-menu.ts`.

## Proposals that need a decision

- Column headers change from 11 px uppercase to 12 px/600 sentence case, matching
  the OMES console.
- Only the active sidebar section is open by default; ADR-0120 currently opens
  every section.
- The status vocabulary (Sehat, Perhatian, Kritis, Menunggu, Tak diketahui,
  Info) pairs every colour with an icon shape, using the existing
  `--color-*-on-soft` / `--color-*-soft` pairs.
