---
"awcms": minor
---

Add the `/admin/data-lifecycle` console and put `data_lifecycle` in the admin sidebar.

The module shipped its registry / legal-hold / dry-run / run-history API (ADR-0037) with no screen at all, so the entire surface was reachable only by `curl` and its own README recorded the screen as an open follow-up. The console renders the code-declared lifecycle registry, the legal-hold ledger with a place-hold form and per-hold release, the on-demand dry-run planner with its categorized counts, and the run history that is itself retention evidence.

Reads reuse the same application functions the JSON endpoints call, inside one `withTenantOrThrow` transaction. Writes go to the guarded `/api/v1/data-lifecycle/*` endpoints — the two hold mutations with a fresh `Idempotency-Key` per click, the dry-run with none, because that endpoint mutates nothing and requires none. Real archive and purge stay job-only; the screen has no control for them because they have no HTTP surface.

`legal_hold.create` and `legal_hold.release` are gated **separately**: `data_lifecycle.legal_hold_maker_checker` makes holding both a `critical` SoD conflict, so gating both controls on one permission — the tidier-looking choice — would be wrong for every real operator. `tests/admin-data-lifecycle-page-contract.test.ts` pins that, plus the page's six permission keys against what the routes enforce and the descriptor declares, so a plausible-but-unseeded key (`legal_hold.delete`, `plan.read`) cannot silently hide a panel from everyone including the owner.
