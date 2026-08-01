---
"awcms": minor
---

Admin screen for `seo_distribution` at `/admin/seo`, plus the sidebar entry that makes it reachable.

The module shipped a complete admin API (tenant SEO defaults, redirect rules, redirect policy, 404 governance) but no screen, and declared no `navigation` — so every one of its permissions was routed while the module stayed invisible in the sidebar. One page now carries four panels: SEO defaults, redirect policy, redirect rules (create with a read-only dry run, inline edit, activate/deactivate/archive, soft delete, and an id-addressed restore/purge panel because soft-deleted rules are excluded from the list), and the privacy-minimized 404 log (resolve / dismiss).

Reads run server-side through the same application-layer functions the JSON routes use, inside one tenant transaction; every write goes out over `fetch` to the guarded endpoints, with a fresh `Idempotency-Key` per click on the four high-risk mutations. Permission gates are UX-only — notably the lifecycle endpoint's dynamic guard is honored: Purge is gated on `seo_distribution.redirect.delete` and activate/deactivate/archive/restore on `seo_distribution.redirect.update`. Bulk import and URL-change capture stay API-only.
