---
"awcms": minor
---

Add the `/admin/site-search` operations console and put `site_search` in the admin sidebar.

The module shipped its index/settings/diagnostics API (ADR-0040) without a screen, so the whole surface was reachable only by `curl` and `site_search` was invisible in the sidebar. The console renders index status and freshness, documents by resource type, the ten most recent index runs, and the failed-item diagnostics, and drives reconcile, rebuild, and the search-configuration form.

Reads call the same application functions the JSON endpoints use, inside one `withTenantOrThrow` transaction. Writes go to the guarded `/api/v1/site-search/*` endpoints with a fresh `Idempotency-Key` per click, so a deliberate second run really runs instead of replaying the first run's stored response. Every permission gate on the page is UX-only — the endpoints remain the authority.

`tests/admin-site-search-page-contract.test.ts` pins the page's six permission keys to what the routes enforce and the descriptor declares, so a plausible-but-unseeded key (`settings.configure`, `index.update`) cannot silently hide a panel from everyone including the owner.
