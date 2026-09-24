---
"awcms": patch
---

chore(deps-dev): bump @playwright/test from 1.62.1 to 1.63.0

Dev/CI-only: the runner behind the E2E smoke job and the browser tests. It does not
ship in the built application.

The E2E smoke job passing on this PR is the meaningful signal here — it exercises the
bumped runner against the real suite, including the 360px viewport gate, rather than
merely proving the package installs.
