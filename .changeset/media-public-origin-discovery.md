---
"awcms": minor
---

`GET /api/v1/media/public-origin` — the origin media public URLs are served
from, so a build client never holds a second copy of it.

`awcms-astro` ships a strict CSP and must name the media host in `img-src` at
BUILD time: an image resolved correctly still renders as nothing when
`img-src 'self'` blocks the host it lives on. Reading the origin off a
`publicUrl` does not help, because the policy is written before any object is
fetched, and a build with no images would then emit no `img-src` at all. The
only alternative left was copying `NEWS_MEDIA_R2_PUBLIC_BASE_URL` into the
consumer by hand — two copies of one value that agree until one is edited, with
a failure (images silently blocked) that names its cause nowhere.

Reports `origin` (scheme + host + port, for the host-wide CSP form) and
`baseUrl` (path included, for the tighter prefix form); neither choice is this
API's to make.

A deployment serving no public media answers `200` with `configured: false`
rather than an error, so a LAN/offline build omits the entry instead of
failing. A value that is set but unparseable — or on a scheme that cannot serve
media, `data:` above all — is reported the same way and never echoed back:
handing a consumer a malformed origin puts it in a CSP header, where a browser
either rejects the whole policy or allows something nobody wrote down.

Gated on `media_library.media.read`, the permission a build client already
holds; no new authority on any credential, and machine credentials stay
read-only (ADR-0049). No migration.
