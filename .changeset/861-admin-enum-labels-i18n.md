---
"awcms": patch
---

fix(admin): translate closed-enum/status labels and stacked-table `data-label` across `src/pages/admin/**` (item 4 of #854)

Closed-enum/status values (`request.status`, `post.visibility`, GitHub issue
`state`, and roughly 60 other columns across ~40 admin screens) were
rendered as raw untranslated text — a fallback that never reads in Indonesian
because the stored value (e.g. `pending_approval`) is not English prose `t()`
can translate. Every such render now goes through a translated
`Record<Enum, string>` label map — a small set of shared helpers under
`src/lib/i18n/labels/` (`blog-content.ts`, `audit-severity.ts`,
`omes-enrollment.ts`, `omes-operation.ts`) where the same enum is rendered on
2+ screens, otherwise a local map at the render site — with the raw value
kept in a new `data-*` attribute so tests/CSS/JS keep a stable, locale-independent
hook. An unrecognised value falls back to the raw string rather than
crashing or rendering blank.

Separately, `admin.css`'s stacked-table mechanism
(`.data-table--stack td::before { content: attr(data-label); }`, which shows
column names on phones) had ~500 literal English `data-label="…"` attributes
across 49 admin screens; all now read `data-label={t("…")}`, reusing the
exact msgid of that column's `<th>`.

81 new msgids added to `locales/en.po`/`locales/id.po` with real Indonesian
translations; `bun run i18n:compile` regenerated the catalogs.
`tests/admin-i18n-labels.test.ts` is a new regression gate: it fails on any
literal `data-label="…"` on a `<td`/`<th` in `src/pages/admin/**`, and pins
the shared label helpers' exhaustiveness over their known enum values.

Read-side/markup/i18n-catalog changes only — no API/schema/permission
contract changed. See ADR-0125.
