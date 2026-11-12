---
"awcms": patch
---

test(email): close the coverage gap behind CodeQL alert #204 (`js/useless-assignment-to-local`) in `tests/integration/email-sender-routing.integration.test.ts`. The third dispatch pass of "stale or unknown verification … HOLD the row" assigned `result` and never read it, so the case its own comment describes — s1 sends while s2, which has no health row, is held — was only half checked: the fake provider's outbox and the row status were asserted, but not the pass's own counters, so a dispatcher that held s2's row without counting it in `senderHeld` (the figure operators read) would have passed. The pass now asserts `result.sent === 1` and `result.senderHeld === 1`. Test-only: no runtime, migration or API change.
