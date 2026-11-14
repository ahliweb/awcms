---
"awcms": patch
---

Test-only: the social_publishing daily-cap concurrency test no longer assumes
one concurrent dispatch round fills the cap. A dispatcher that loses the
per-account try-lock skips that account for the pass by design, so the test
now asserts `≤ cap` after the concurrent round and exactly the cap after
follow-up passes (#1339).
