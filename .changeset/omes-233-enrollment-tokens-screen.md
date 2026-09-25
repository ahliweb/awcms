---
"awcms": minor
---

feat(control-center): OMES enrollment-token management screen (ahliweb/omes#233)

Adds `/admin/omes/enrollments`, the ninth `omes_control` admin screen, gated on the existing `omes_control.enrollments.manage` permission. `ahliweb/omes#201` deliberately shipped without a navigation entry for this — the Servers screen has only ever rendered read-only enrollment/trust evidence; issuing and revoking a worker's one-time enrollment token was reachable only via the API. This closes that gap.

No new write path is introduced: the screen's "Issue token" and "Revoke" buttons call the SAME two endpoints `ahliweb/omes#198` already shipped and guards — `POST /api/v1/omes/servers/{id}/enrollment-challenges` and its `/revoke` sibling — unmodified by this change. A new read-only query, `application/enrollment-directory.ts`'s `fetchEnrollments`, lists enrollment tokens across the whole tenant fleet (the existing `fetchServerDetail` only ever looked at one server's enrollments at a time).

Security-sensitive token handling:

- The issued token is shown exactly once, immediately after issuance, and can never be fetched again — only its SHA-256 hash is ever persisted (`sql/158`'s existing discipline, unchanged).
- Rendered via the shared `messageBox` helper's `textContent`-only `show()` (never `innerHTML`/`set:html`), never written to `localStorage`/`sessionStorage`, never logged, and gone the moment the page is left or reloaded. No auto-download and no modal dialog — a plain in-page reveal, matching this repo's own established `machine-credentials.astro` precedent. A copy-to-clipboard button was drafted and then removed after it pushed this one screen's compiled client bundle over the repo's asset-budget gate; see the screen's own header comment for the full modal-vs-clipboard-button-vs-download trade-off analysis.
- Every mutation remains permission-gated SERVER-SIDE by the endpoints' own `authorize: OMES_GUARDS.enrollments.manage` (unchanged) — this screen hiding a button is UX only, never the enforcement boundary.
- Cross-tenant isolation is proven at runtime against a real PostgreSQL with `FORCE ROW LEVEL SECURITY` (`tests/integration/omes-control.integration.test.ts`'s new "enrollment directory & cross-tenant enrollment isolation" suite): a foreign tenant's `serverRowId` resolves to a fail-closed `not_found`/empty list, never a leaked row or a mutated foreign entry. A separate test reads the raw database row after issuance and asserts the plaintext challenge is not a substring anywhere in it — only its hash is stored.

Adds `tests/admin-omes-control-enrollments-page-contract.test.ts` (guard/endpoint parity, no-direct-SQL, Idempotency-Key discipline, output-encoding, never-re-displayable/never-persisted-in-plaintext static checks, tenant scoping) and updates `tests/omes-control-module.test.ts`/`tests/admin-omes-control-page-contract.test.ts` for the nine-screen shape. Adds EN/ID locale entries (id.po fully translated) and documents the new screen in the module's README/README.id and the overview's quick-links.
