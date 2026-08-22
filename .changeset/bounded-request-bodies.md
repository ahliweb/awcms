---
"awcms": patch
---

fix(security): an unauthenticated caller could make the server buffer a request body without bound

`request.json()`, `request.text()` and `request.formData()` all read the WHOLE
body before returning anything, with no ceiling. **Twenty-five route files**
called one of them directly.

Twenty-four were behind a resolved session, so the exposure was a caller
spending its own authenticated quota. **One was not.**
`data-lifecycle/dry-run.ts` calls `resolveAuthInputs`, which checks that a tenant
header and a token are *present* — it resolves neither — and then read the body.
Two arbitrary strings were enough to reach it.

**The middleware's pre-check could not help**, and the reason is the finding:
`checkContentLengthCeiling` returns `true` when the header is **absent**. A
chunked request declares no `Content-Length`, so the one case that needs a
ceiling is precisely the case that pre-check waves through. It is
defence-in-depth against an honestly-declared oversized body, which is not the
threat.

All twenty-five now read through `readJsonBody` / `readTextBody` / the new
`readFormBody`, and `bun run api:body-limit:check` fails any route under
`src/pages/api/` that calls a raw reader — with an exemption list that starts
**empty** and may only shrink. `readJsonBody` had existed since Issue #466 and
was used by some routes and not others, which is what a convention becomes when
nothing enforces it: correct wherever somebody remembered.

**`readJsonBody` now distinguishes empty from malformed.** It used to answer
`null` for both, so converting a route that returned "Request body must be valid
JSON" would have silently changed that 400 into a field-validation 400 with a
different sentence — or into a silent accept where an empty body is legitimate.
Every converted route keeps the exact response it had.

`readFormBody` reads capped text and parses it as `URLSearchParams`, giving the
same `.get(name)` surface with a ceiling in front of it. It is **not** a
multipart parser and says so: no route here sends multipart (uploads go direct to
R2 through a presigned session), and a route that starts to needs a real parser
rather than this.

The test drives real streaming `Request` objects that declare no length — the
exact shape the middleware cannot see — and asserts the read **stops early**,
counting the bytes the producer actually emitted. A ceiling applied after
buffering is not a ceiling, and only an executed test can tell the two apart:
mutation-proven, moving the check below the loop turns three cases red.
