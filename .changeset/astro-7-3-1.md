---
"awcms": patch
---

chore(deps): bump astro to 7.3.1, with the family manifest and its doc table moved in step

`astro@7.3.1` is a minor-then-patch pair (7.3.0 added `astro preview --ignore-lock`,
logger plumbing for custom image services and cache providers, i18n fallback-route
and content-collection-in-server-islands fixes; 7.3.1 is a follow-up patch fixing a
regression that broke `astro:assets` at start/build). Neither release touches SSR
`output: "server"`, the `@astrojs/node` adapter, standalone mode, or
`build.inlineStylesheets` — the config surface this repo relies on in
`astro.config.mjs` is unaffected, and no code change was needed beyond this bump.

`awcms-family-compatibility.yaml` pins `stack.astro.declared` as a SOURCE CONSTANT
that must equal `package.json` exactly, so `family:conformance:check` goes red on
any bump until the manifest moves with it (`[FAIL] stack: astro (declared ^7.2.9
vs actual ^7.3.1)`, caught on this PR's CI). The stack table in
`docs/awcms/family-compatibility.md` and its Indonesian twin are held to the
manifest by `tests/family-compatibility-doc-parity.test.ts`, so they move too.
