---
"awcms": patch
---

fix(ui): `admin-form-client` arms the bfcache `pageshow` restore once per window instead of once per process (Issue #1349). A browser has one window, so nothing changes there; the test suite stops depending on file order, where a test's fake `window` could consume the one arming and leave `admin-single-flight.test.ts` without its listener. Adds `tests/admin-form-client-pageshow-arming.test.ts`.
