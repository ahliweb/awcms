---
"awcms": patch
---

test(realtime): de-flake `tests/integration/realtime-wake-hint.integration.test.ts` (Issue #1171). Test (c) asserted `woke.a > 0` once, right after the stream frame arrived; the frame and the test's own hub subscriber are two consumers of one hint, and the hub gives each a random delay inside its spreading window, so the frame could win the race. It now waits for the asserted condition. The same pattern is fixed in the reconnect, "OFF by default" and F4 tests, and the two 100-stream B1 tests now re-wake streams whose refused tick fell back to the 30 s timer (bounded) instead of timing out. No production code change; isolation assertions are unchanged.
