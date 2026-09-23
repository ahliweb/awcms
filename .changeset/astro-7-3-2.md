---
"awcms": patch
---

chore(deps): bump astro to 7.3.2, with the family manifest and its doc table moved in step

`astro@7.3.2` is a patch release. Its four fixes were each checked against what this
repo actually uses, and none of them reach it:

- **MDX `<script>`/`<style>` dynamic children are now escaped** unless explicitly
  opted back in with `set:html`. This is the only security-relevant change in the
  release, and it does not apply here: the repo ships no `.mdx` files and does not
  install `@astrojs/mdx`, so there is no MDX rendering path to harden. The escaping
  posture of this repo's own `.astro` templates is unchanged by the bump.
- **i18n fallback routing no longer replaces the first substring match** instead of
  the real locale segment. This repo does not use Astro's native `i18n` routing at
  all — locale resolution runs through middleware over the gettext `.po` catalogues
  (ADR-0095), and `astro.config.mjs` declares no `i18n` block — so the mangled-path
  bug was never reachable here.
- **Dev-toolbar 504 "Outdated Optimize Dep"** on workspace-linked packages, and
  **sessions breaking in dev mode with the Cloudflare adapter**. Both are dev-mode
  paths; this repo builds `output: "server"` on `@astrojs/node`, not Cloudflare.

No code change was needed beyond the bump itself and the manifest/doc housekeeping
below.

`awcms-family-compatibility.yaml` pins `stack.astro.declared` as a SOURCE CONSTANT
that must equal `package.json` exactly, so `family:conformance:check` goes red on any
bump until the manifest moves with it (`[FAIL] stack: Astro (declared ^7.3.1 vs
actual ^7.3.2)`, which is exactly how this PR's CI caught it). The stack table in
`docs/awcms/family-compatibility.md` and its Indonesian twin are held to the manifest
by `tests/family-compatibility-doc-parity.test.ts`, so they move too.
