---
"awcms": patch
---

design(admin): adopt admin-stat-card/admin-status-pill on media, account and access-policies (#864)

Wave 5 of the AWCMS ↔ awcms-one admin UI/UX parity work (epic #858, `docs/awcms/admin-ui-parity-matrix.md` §7): `/admin/media`'s three summary counters and two status columns (object status, rights-verification status) move from the legacy `.stat-card`/`.status-badge` family onto `.admin-stat-card`/`.admin-status-pill`; `/admin/account` gains status pills for the SSO-connected badge, the current-session badge and a new two-factor-authentication state pill; `/admin/access-policies` moves its DSL simulator's Allow/Deny verdict from plain text to a toned status pill, built client-side (the verdict script now reads translated `data-verdict-allow`/`-deny`/`-no-policy` attributes rather than shipping hardcoded English). No API, permission, auth, or data-model change — a markup/class swap only, preserving every screen's read path, mutation endpoints, keyboard operation and accessible names. The legacy `.stat-card`/`.status-badge` CSS stays defined (retired separately by #866).

`media.astro` does **not** adopt `.admin-media-grid`: its object table deliberately renders no `<img>` (a documented security decision — a row can be `pending_upload`/`failed`, and re-showing a policy-violating image to the person removing it is the wrong outcome), so there is no thumbnail-grid markup in this screen to convert. The one real `.admin-media-grid`-shaped markup in the repo is the shared media picker (`src/lib/ui/media-picker-client.ts`), consumed by four other screens outside this issue's file ownership; migrating it is a follow-up scoped to that script and its consumers together. Documents the decision in doc 14's new `MediaGrid` row and marks Wave 5 done in the parity matrix.

`APP_BUDGET_BYTES` raised from 248,045 to 248,333 (measured, no added margin) for the access-policies verdict-pill script; `media.astro`/`account.astro` add no bytes since both classes already existed in `admin.css`.
