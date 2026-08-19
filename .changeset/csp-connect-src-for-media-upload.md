---
"awcms": patch
---

fix(security): the CSP blocked every direct-to-R2 upload before a byte left the browser

`media_library` has had the whole presigned upload flow for months — create a
session, `PUT` the bytes straight to R2, finalize. The browser half could never
have worked: the policy had **no `connect-src` directive at all**, so it fell
through to `default-src 'self'` and the browser refused the cross-origin `PUT`.

This is the **third** instance of one defect in this file. `img-src` was missed
and every R2 image rendered as an empty box; `media-src` was missed the same way
and every gallery video stayed blocked while the images beside it loaded. A
directive that is never named does not announce its fall-through — the failure
appears in a browser console, not in a response the server can see.

### The origin is not the one already in the policy

Reads come from `NEWS_MEDIA_R2_PUBLIC_BASE_URL`, usually a custom domain. Writes
go to R2's S3 API endpoint, `https://{accountId}.r2.cloudflarestorage.com`.
Reusing the public base for `connect-src` would emit a policy that reads as
correctly configured and still blocks every upload, so
`deriveMediaUploadOrigin` derives the write origin separately and a test pins
that they differ.

`connect-src` is emitted unconditionally — naming it is the entire point — and
names the R2 origin only when uploads are configured. On a LAN/offline
deployment the directive is exactly `connect-src 'self'` and no third-party
origin appears anywhere in the policy, unchanged.

Prerequisite for the upload UI in #595: without it there is nothing to build on.
