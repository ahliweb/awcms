---
"awcms": patch
---

chore(deps): bump `astro` from 7.0.9 to 7.1.1. Runtime framework patch. The
family-compatibility manifest's `stack.astro.declared` pin is updated to `^7.1.1`
in the same change so `family:conformance:check` stays green (declared value must
equal the real `package.json` dependency).
