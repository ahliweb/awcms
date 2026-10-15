---
"awcms": patch
---

test: give the whole-repo scan tests explicit 60 s per-test timeouts so `bun run check` is not load-flaky (#1022). The two api-docs generator determinism tests, the OpenAPI bundle tests that regenerate the full bundle, and the repo-wide legacy-class scan now declare `60_000` as their timeout, with no assertion changed and nothing skipped. No runtime behaviour changes.
