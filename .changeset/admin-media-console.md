---
"awcms": minor
---

Add `/admin/media` and put `media_library` in the admin sidebar — the last module in this base without a screen.

It was listed for two waves beside modules that were genuinely only missing a page, and that was wrong for this one. [ADR-0056](../docs/adr/0056-media-library-admin-surface.md) found that five of eleven permissions were enforced by nothing, five application functions had zero callers, and there was **no list function at all** — so this screen could not have been built on the surface that existed, whatever the permission catalog said. `attach`/`detach` were revoked (§A), `delete`/`restore`/`purge` got endpoints (§B), and the browse listing got its own function and route (§C). This is what those three were for.

The console browses with §C's filters — status, mime type, and the three-way `live`/`deleted`/`all` — then deletes, restores, and purges. Reads go through `listMediaObjects` inside one `withTenantOrThrow`; writes post to the guarded endpoints, each with a fresh `Idempotency-Key`. Unlike `/admin/blog` there is no opt-out, and unlike `/admin/sync` there is no endpoint that declines the header: all three here require it.

**Three deliberate absences**, each pinned by `tests/admin-media-page-contract.test.ts` so they stay decisions rather than becoming gaps:

- **Upload** (`media.create`/`.verify`/`.cancel`) — a three-step browser flow (create session → PUT the bytes straight to R2 → finalize) with real file input, progress, and client-side failure modes. A button that starts a session this page cannot finish leaves a `pending_upload` row behind on every misclick, which is precisely the litter the reconciliation job exists to clean up.
- **`enforcement.read`/`.enable`** — a tenant-wide, ONE-WAY content policy switch, not an object action. It belongs on `/admin/security` with the other policy controls; offering it beside a row of files would misrepresent its blast radius.
- **No `<img>` preview.** A registry row can be `pending_upload` or `failed` — the bytes may be absent, unverified, or the very thing an operator is here to delete. Rendering them is how a policy-violating image gets shown one more time, to the person removing it.

The delete prompt asks for a real reason rather than sending a placeholder, because it lands on an audit row that outlives the object, and its `maxlength` comes from the constant the validator enforces. Purge is the only irreversible action and is the only one behind a `confirm`. It is also the only failure this screen names specifically: `MEDIA_OBJECT_REFERENCED` gets "remove that reference first" rather than "please try again", because retrying will never succeed while the foreign key is live.

**This closes ADR-0021's first criterion.** `idn-admin-regions` is now the only module without a screen, and that is a documented decision (ADR-0052 moved its lifecycle to operator jobs). The contract test asserts it repo-wide, so the next module to land without `navigation` turns CI red instead of quietly becoming a second exception.

Mutation-proven four ways: gating a control on the revoked `media.detach`, dropping one mutation's `Idempotency-Key`, rendering a preview `<img>`, and removing the navigation entry each turn it red.
