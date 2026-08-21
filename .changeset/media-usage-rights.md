---
"awcms": minor
---

feat(media-library): a newsroom can record who took a photograph, and whether anyone checked the licence (#615)

`awcms_news_media_objects` has carried `alt_text` and `caption` since `sql/041`,
and **nothing could edit either**. Of the nine media permissions — create, read,
verify, delete, restore, purge, cancel and the two `enforcement.*` — not one
permitted changing metadata, and the only method on
`/api/v1/media/objects/{id}` was `DELETE`. So a newsroom could upload a wire
photo and had nowhere to put the credit the licence obliges it to print.

### Five columns, and why not the two that exist

Alt text is an ACCESSIBILITY obligation — what a screen reader says. A caption
is EDITORIAL — what the reader is told about the scene. A credit line is
neither, and folding all three into one "required" makes the word meaningless.
`sql/137` adds `credit_line`, `source_name`, `copyright_status`, `rights_notes`,
`rights_verification_status` and the `rights_verified_by`/`_at` pair.

`source_name` is separate from `credit_line` because they are often different: a
photo credited to a stringer may have arrived through an agency, and a takedown
request names the agency. `copyright_status` defaults to `unknown`, which is a
real answer rather than a missing one — most of a legacy archive is exactly that.

### Rights verification is not `media.verify`

`media.verify` and a `verified` object status mean the BYTES were checked: MIME
sniffed from magic bytes, checksum matched. That is a machine answering a
question about a file. Whether a licence permits publication is a person
answering a question about a contract. One word for both would make one of them
wrong, and it would be the legal one — a file that passes a MIME sniff would read
as rights-cleared to anyone glancing at a column called `verified`.

So: separate column, separate vocabulary, separate permission. The eighth media
key, `media_library.media.update`, ships **with** its endpoint —
`media-permissions.ts` records why, after two keys survived three reviews by
being declared ahead of any code that checked them.

### The adjudication is stamped, never submitted

`rights_verified_by` is the authenticated actor and `rights_verified_at` the
transaction clock. A client-supplied verifier is a client-supplied signature on
the record a takedown dispute is argued from. Returning to `unverified` clears
both, enforced by application validation and by a CHECK — one governs what a
request may ask for, the other what the table may hold, including rows written by
a path that predates the validation.

Changing the decision writes an audit event at `warning`; fixing a typo in a
credit writes one at `info`.

### The editor

`/admin/media` gains a Rights column (credit plus a status badge) and an
`?rights=<id>` editor, server-rendered and pre-filled the same way
`/admin/blog-ads` opens its form — so the page ships no client code for
populating fields, and an editor can send somebody the URL of the exact photo
whose credit is wrong. A `PATCH` distinguishes "leave alone" (omitted) from
"clear" (`null`); collapsing the two would let a form submitting one field erase
a credit somebody else typed.

**Existing tenants:** `media.update` is a new catalog permission, so only tenants
created after this migration hold it. Run
`bun run identity-access:permissions:backfill --tenant <code>` for the rest —
dry-run by default.

`APP_BUDGET_BYTES` raised 185,000 → 186,000. The growth is 649 B, all in
`media.astro`'s own island, checked for the per-screen-duplication shape the
gate asks about and not found: the editor reuses the shared form client, and the
cheaper server-rendered design was already taken.
