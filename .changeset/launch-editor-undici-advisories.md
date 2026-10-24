---
"awcms": patch
---

Dependencies: `bun audit fix` moves `launch-editor` 2.14.1 → 2.14.2 (GHSA-587h-7wmj-h5pm, high, plus two moderate advisories; reached only through `@changesets/cli`), `undici` 8.11.2 → 8.12.2 (GHSA-xjj6-f33q-929c, high, denial of service on excessive content-encodings, plus two moderate advisories) and `smol-toml` 1.8.0 → 1.9.0 (moderate quadratic parse). Every new version is inside the range already declared, so only `bun.lock` moves; no `overrides` entry and no exception is needed. `deps:audit:check` was red on `main` and on every pull request until this lands.
