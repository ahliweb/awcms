---
"awcms": minor
---

feat(admin): add ConfirmDialog, SettingsSaveBar, and ReasonPanel admin v2 primitives

Three accessible admin UX primitives, ported from `ahliweb/media-lenterakalteng`'s local build so every consumer of this template gets them (see ADR-0125): `ConfirmDialog` replaces `window.confirm()` with a themed `<dialog role="alertdialog">` rendered once by `AdminLayout` (43 call sites across 26 admin screens converted); `SettingsSaveBar` is a sticky save bar that works without JavaScript, adopted on `/admin/site-profile`, `/admin/blog-settings`, and `/admin/theming`; `ReasonPanel` replaces `window.prompt()` for actions whose endpoint records a reason (module disable, newsletter suppress, media delete, tenant domain delete, business-scope assignment/exception revoke, domain-event consumer pause and delivery replay — 9 sites converted, 12 left and catalogued in the ADR because they do not fit its one-endpoint/one-required-field/reload-on-success shape). No new endpoints, no API/schema changes; server-side authorization and validation are unchanged.
