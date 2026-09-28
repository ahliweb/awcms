---
"awcms": patch
---

chore(deps): bump astro to 7.3.5, with the family manifest and its doc table moved in step

`astro@7.3.5` covers three patch releases (7.3.3–7.3.5). Each fix was checked against
what this repo actually uses, and none of them reach it:

- **7.3.5** adds an opt-in `?container` import for `experimental_AstroContainer`. This
  repo does not use the experimental container API.
- **7.3.4** fixes an incremental-build re-render bug, a `TypeScript 7` `astro check`
  message, double-escaped `&` in Markdown image `alt`/`title` (a bugfix, not a
  behaviour this repo's own escaping relies on), three dev-overlay error names,
  a Vite dev-server re-evaluation loop that only affects adapters running requests
  outside Vite's module runner (this repo uses `@astrojs/node`, not
  `@astrojs/cloudflare`), domain-based i18n routing respecting
  `security.allowedDomains` (this repo does not use Astro's native `i18n` routing —
  locale resolution runs through middleware over gettext `.po` catalogues, ADR-0095),
  an `object-position` CSS bug in `image.responsiveStyles` (not used here), and
  AI-agent process-backgrounding behaviour on `astro dev`/`astro preview` (dev-only,
  Windows-specific).
- **7.3.3** refactors an internal version-handling dependency, fixes 400/404 image
  endpoint responses for invalid/missing local images, a locale-casing bug in
  `Astro.preferredLocaleList` (native i18n again, not used here), an agent-detection
  regression in `--ignore-lock`, and `getImage()` TypeScript autocompletion.

No code change was needed beyond the bump itself and the manifest/doc housekeeping
below.

`awcms-family-compatibility.yaml` pins `stack.astro.declared` as a source constant
that must equal `package.json` exactly, so `family:conformance:check` goes red on any
bump until the manifest moves with it (`[FAIL] stack: Astro (declared ^7.3.2 vs
actual ^7.3.5)`, which is exactly how this PR's CI caught it — same shape as the
astro 7.3.2 bump, `.changeset/astro-7-3-2.md`). The stack table in
`docs/awcms/family-compatibility.md` and its Indonesian twin are held to the manifest
by `tests/family-compatibility-doc-parity.test.ts`, so they move too.
