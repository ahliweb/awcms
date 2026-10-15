---
"awcms": patch
---

fix(booking): a confirm racing the hold's expiry now returns the `HOLD_EXPIRED` refusal (409) instead of a 500 (#1025). The `held -> confirmed` guard trigger judges the hold by its own clock, a few milliseconds after the service's; when the hold elapsed in that window the trigger's 55000 `HOLD_EXPIRED` escaped as an exception. The UPDATE now runs in a savepoint and that error (matched on SQLSTATE plus the `HOLD_EXPIRED` tag) becomes the refusal, with nothing written. The route and the BookingPort confirm share the service, so both are covered. The `(T6 b)` race test no longer flakes, and a deterministic test forces the window.
