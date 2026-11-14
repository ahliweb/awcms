---
"awcms": minor
---

feat(identity-access): TOTP enrolment on `/admin/account` now shows the `otpauth://` URI as a QR code (Issue #1316). The code is encoded in the browser by a small dependency-free encoder (`src/lib/qr/qr-code.ts`: byte mode, error correction M, versions 1-15, up to 412 bytes) and drawn as an SVG built with the DOM API: no third-party QR service, no network request, no inline script or style, so the strict CSP is unchanged. The URI carries the shared secret, so it is never logged, stored or put in an attribute. The SVG has a translated text alternative that points at the secret still shown for manual entry; a URI over capacity simply leaves the QR out. The QR is cleared together with the secret when enrolment completes and when the page is left. No endpoint, schema or verification flow changed.

The DOM side now lives in `src/lib/ui/enrolment-qr.ts` and is covered by behaviour tests that render into a document stub. A pending enrolment restored from the back/forward cache (after the page-exit clear emptied the secret and QR) now hides the empty form and offers the start form again.
