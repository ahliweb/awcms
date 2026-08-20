---
"awcms": minor
---

feat(admin-ui): a journalist can upload a photo without hand-calling the API

`media_library` has had the whole server half for a long time — presigned
session, magic-byte MIME sniff over the real bytes, server-side SHA-256
verification, authoritative post-TOCTOU size check, orphan lifecycle, reconcile
job. What it never had was the only part a journalist can use: **a file picker**.

`/admin/media` could browse, delete, restore and purge. It could not accept a
file, so attaching a photo to an article meant calling the API by hand with a
token — which is not a workflow, it is a workaround.

### The absence was deliberate, and this answers its objection

ADR-0056 kept `media.create` off this screen for a stated reason: uploading is a
three-step dance, and *"a button that starts a session this page cannot finish
would leave `pending_upload` rows behind on every misclick"*.

That objection was about an **unfinished flow**, not about the screen. So the
uploader finishes it, and every failure path cancels the session it created:

- a failed transfer cancels;
- a failed finalize cancels — the bytes landed but nothing references them;
- a cancel that itself fails does **not** replace the error the operator can act
  on, because the reconcile job is the backstop and "cleanup also failed" is not
  something the person uploading can do anything about.

Each of those is a test, because "it cancelled" is the property the objection
was about. The decision was recorded in three places (the page header, the
contract test, the screen-coverage registry) and all three are updated to say
why it was reversed rather than quietly dropped.

### Two details that decide whether it works at all

**`XMLHttpRequest`, not `fetch`** — only XHR reports upload progress. A newsroom
photo on a regional connection is otherwise tens of seconds of silence, and
silence is indistinguishable from a hang: people retry, and every retry is
another orphan object.

**The checksum is optional on purpose.** `crypto.subtle` does not exist outside
a secure context, and the LAN/offline profile may be plain HTTP. The finalize
contract already treats `checksumSha256` as optional, so the client sends one
when it can and omits it when it cannot, rather than failing an upload on a
deployment shape the project supports. A digest that *throws* is treated the
same way.

### It renders only where it can work

`POST .../upload-sessions` answers `502 PROVIDER_ERROR` with R2 unconfigured, so
the same config the endpoint checks decides whether the panel exists — no file
picker that fails every time for a reason the journalist cannot fix. The
`accept` attribute comes from the same allow-list the server validates against,
and the `create` guard is resolved through `loadAdminScreen` so the form is not
rendered to someone the endpoint would refuse.

Client cost: **3,854 B**, all of it on the app surface. The reader budget is
untouched at 21,415 B — the first change to demonstrate the ADR-0101 split doing
its job.
