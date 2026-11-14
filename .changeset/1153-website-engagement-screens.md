---
"awcms": minor
---

feat(website_engagement): operator screens for the website intake (Issue #1153, ADR-0155 section 8, ADR-0149). The module becomes `active` with two navigation entries and three server-rendered screens; no endpoint, schema or event changes.

**Screens.** `/admin/website-engagement` lists submissions, newest first, keyset-paged and filtered by source, kind and status, with masked contact details and the consent purposes only. `/admin/website-engagement/{id}` shows the consent record (purposes, exact copy version, page, moment), attribution and request provenance (host, how the anti-abuse challenge went) and, for a person holding `submissions.withdraw`, the confirmed, idempotent withdrawal of a still-received submission. `/admin/website-engagement/sources` lists the registered websites with their accepted hosts, accepted kinds, consent copy version, the challenge each source ACTUALLY gets on this deployment (a source set to Turnstile on a deployment that does not run it says so), the token PREFIX and rotation time, and, for `sources.manage`, a confirmed revoke. A refused key ring is stated on both lists (new submissions are being refused) while reads keep working.

**Safety.** The screens read through the API's own directory functions, in the caller's tenant-scoped transaction, via `application/screen-loaders.ts`. They never decrypt, never select a ciphertext, a token or a token hash, and hold no SQL. An unknown, malformed or other tenant's submission id is one "not found". Every control follows its own permission through the same `can()` chokepoint, shown only when allowed; the endpoints stay the authority. Behavioural integration tests run the real loaders as real viewers and were checked by mutation (a loader that ignores a filter, ignores `can()`, or reads the sources table without `sources.read` turns them red).

**Not in this change (API-only).** Creating, editing, pausing and rotating a source (the token must be shown once) and the audited reveal (`submissions.reveal` stays on the `NOT_YET_SCREENED` ledger). No date-range filter: the list API has none. Raises `APP_BUDGET_BYTES` by 1,500 B for the two page scripts.
