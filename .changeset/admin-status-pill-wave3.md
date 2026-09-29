---
"awcms": patch
---

design(admin): comments moderation adopts segmented filter + bulk bar, 31 list screens migrate to `.admin-status-pill` (wave 3 of #858)

`docs/awcms/admin-ui-parity-matrix.md` §7 wave 3, per ADR-0125's admin v2 primitive rollout:

- `src/pages/admin/comments.astro` (flagship): the `.filter-bar` status-tab nav becomes
  `.admin-segmented`/`.admin-segmented-option` — still plain `<a href>` links, so the
  filter works with no JavaScript and the `?status=` query semantics are unchanged. Rows
  gain a `.admin-status-pill` status column, and row checkboxes wire an
  `.admin-bulk-bar` (select-all, live `aria-live` count, Approve/Reject/Spam) to the
  EXISTING `bulk-moderate` endpoint — no new endpoint added. Bulk logic is factored into
  a pure, unit-tested module, `src/lib/ui/admin-bulk-bar-client.ts`.
- 31 other list-management screens migrate their `.status-badge`/`.status-dot` markup to
  `.admin-status-pill`/`.admin-status-pill-dot` (`data-variant` -> `data-tone`), which also
  fixes several sites whose `data-variant="danger"`/`status-badge--${variant}` values had
  no matching CSS rule under the legacy class. Translated status labels and `data-*`
  raw-value hooks are preserved throughout.
- The legacy `.status-badge`/`.status-dot` declarations stay defined in `src/styles/admin.css`
  for the screens waves 4/6 have not migrated yet.
- `email-suppression.astro`, `registrations.astro` and `user-groups.astro` were read and
  confirmed to have no per-row lifecycle status concept — left unchanged rather than
  forcing a primitive that does not fit.
