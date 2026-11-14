---
"awcms": patch
---

fix(test): the email webhook M-2 flood test keeps all 25 report timestamps on one UTC day (Issue #1322). Recipient-keyed events are deduplicated per UTC day, so the fixed 60–84-minute window split the clicks over two days for runs that started between 01:00 and 01:24 UTC. The window is now chosen once with a five-minute margin. Test-only; no product behaviour change.
