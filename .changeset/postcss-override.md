---
"awcms": patch
---

Close GHSA-fxqj-rqcc-2cmp by pinning `postcss` to `^8.5.23` via `overrides`.

`bun audit` reported one moderate advisory: PostCSS's incomplete fix of
GHSA-6g55-p6wh-862q lets an attacker-controlled `sourceMappingURL` read
arbitrary `.map` files when `from` is unset. It reaches this repo transitively
through `astro › vite › postcss`, which resolved to 8.5.19.

A dependency override rather than waiting for the upstream bump: the path is
three levels deep, so nothing this repo declares can move it, and `overrides`
is the same mechanism `awcms-astro` used to close its `fast-uri` advisory.

Build-path only — PostCSS does not run at request time — so this is hygiene
rather than an exposure. `bun audit` is now clean, and `bun install
--frozen-lockfile` still resolves unchanged.
