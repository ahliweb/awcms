---
"awcms": patch
---

Bump the Astro stack: `astro` 7.1.3 → 7.1.6 and `@astrojs/node` 11.0.2 →
11.0.3, together with the two `stack` entries in
`awcms-family-compatibility.yaml` that pin them.

The manifest is what makes this one change rather than three: `family:conformance:check`
reads `package.json` and fails on any drift from the declared range, so either
bump alone turns CI red until its `declared` value moves with it. That gate is
the reason the version a consumer reads has never silently diverged from the
version this repo actually runs.
