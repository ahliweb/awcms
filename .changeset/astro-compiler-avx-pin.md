---
"awcms": patch
---

fix(deps): pin `@astrojs/compiler-rs` to 0.5.2 through `package.json` `overrides` (astro accepts `^0.5.2`). The 0.5.3 prebuilt binding `@astrojs/compiler-binding-linux-x64-gnu` crashes `astro build` with SIGILL on x86-64 CPUs without AVX (Issue #1367). The pin and its release condition are recorded in dependency-governance, and the build-host requirement is documented in `deploy-coolify` (EN + ID).
