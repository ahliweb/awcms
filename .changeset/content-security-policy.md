---
"awcms": patch
---

Add a Content-Security-Policy to every response (Issue #148). This base
previously set none at all.

`src/lib/security/security-headers.ts` now emits `default-src 'self'`,
`object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, and
`frame-ancestors 'none'` — the directive set awcms-mini uses, minus its
`frame-src` and the Turnstile/YouTube origins it allowlists, neither of which
has any subject in this base. `src/middleware.ts` already applies this
builder's output to every response, so no route or middleware change was
needed. `X-Frame-Options: DENY` stays as an independent older-browser layer.

Set here rather than via Astro's built-in `security.csp` (the mechanism mini
uses): Astro emits the CSP only from its page render path, and this base has
no pages — `src/pages/` contains only API endpoints, and its two HTML
responses (`src/lib/html/error-responses.ts`) are plain `Response`s returned
from endpoints. A `security.csp` block in `astro.config.mjs` would therefore
set zero headers here; `astro.config.mjs` now carries a comment recording
that, and `security-headers.ts` documents what must be reconciled if this
base ever gains real `.astro` pages (Astro's own header and this one do not
compose — middleware's `headers.set` would replace Astro's).

Rules out the "strict CSP breaks the UI" hazard rather than assuming it away:
this base ships no `.astro` component, no inline script or style, no inline
event handler, and no external origin, so `'self'` has nothing to break.

Session cookies were already `httpOnly`, which stops XSS from reading a
token; this closes the layer above it — XSS riding the session via a
same-origin `fetch()`, and `<base href>` injection hijacking a relative form
POST to an attacker origin.
