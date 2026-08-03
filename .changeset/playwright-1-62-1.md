---
"awcms": patch
---

Bump `@playwright/test` from 1.62.0 to 1.62.1 (dev dependency, E2E runner).

Unlike the Astro stack, Playwright is not pinned in
`awcms-family-compatibility.yaml`, so this bump touches nothing but the
lockfile — a consumer of this repo binds against its contracts, not its test
runner.
