---
"awcms": patch
---

chore(deps): astro 7.2.2 and @astrojs/node 11.1.2, with the family manifest moved in step

Both halves of the Astro stack are bumped in ONE change rather than the two
Dependabot opened, because they fail for the same reason and fixing one leaves
the other red: `awcms-family-compatibility.yaml` pins `stack.astro.declared` and
`stack.astroNode.declared` as source constants that must match
`package.json` exactly, so any bump reddens `family:conformance:check` until the
manifest moves with it.

`bun install` resolves astro to 7.2.3 inside the declared `^7.2.2` range. Full
`bun run check` verified green on the bumped stack before merge — all 52 gates,
the test suite, and the build.
