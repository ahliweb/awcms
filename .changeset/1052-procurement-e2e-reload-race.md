---
"awcms": patch
---

test(e2e): the procurement write spec waits for the page's own reload after delete and restore, so "deletes and restores the supplier" no longer races `window.location.reload()` and passes only on retry (#1052). Test-only; no runtime change.
