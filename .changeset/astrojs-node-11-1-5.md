---
"awcms": patch
---

chore(deps): bump @astrojs/node to 11.1.5, with the family manifest and its doc table moved in step

`@astrojs/node@11.1.5` is a patch release (updated dependency
`@astrojs/internal-helpers@0.11.0`, no API change). `awcms-family-compatibility.yaml`
pins `stack.astroNode.declared` as a SOURCE CONSTANT that must equal
`package.json` exactly, so `family:conformance:check` goes red on any bump
until the manifest moves with it (`[FAIL] stack: @astrojs/node (declared
^11.1.4 vs actual ^11.1.5)`, caught on this PR's CI). The stack table in
`docs/awcms/family-compatibility.md` and its Indonesian twin are held to the
manifest by `tests/family-compatibility-doc-parity.test.ts`, so they move too.
