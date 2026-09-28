---
"awcms": patch
---

chore(deps): bump @astrojs/node to 11.1.6, with the family manifest and its doc table moved in step

The Node/Bun standalone-server adapter this repo builds against
(`output: "server"`, `standalone-entry.ts`). `11.1.6` is a patch release with no
breaking changes to the adapter's public config or the request-handler entry point
this repo wires up in `astro.config.mjs`.

`awcms-family-compatibility.yaml` pins `stack.astroNode.declared` as a SOURCE
CONSTANT that must equal `package.json` exactly, so `family:conformance:check` goes
red on any bump until the manifest moves with it (`[FAIL] stack: @astrojs/node
(declared ^11.1.5 vs actual ^11.1.6)`, which is exactly how this PR's CI caught it —
same shape as the astro 7.3.2 bump, `.changeset/astro-7-3-2.md`). The stack table in
`docs/awcms/family-compatibility.md` and its Indonesian twin are held to the manifest
by `tests/family-compatibility-doc-parity.test.ts`, so they move too.
