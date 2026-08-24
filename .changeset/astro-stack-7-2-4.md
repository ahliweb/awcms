---
"awcms": patch
---

chore(deps): astro 7.2.4 and @astrojs/node 11.1.4, with the family manifest and its doc table moved in step

Both halves of the Astro stack move in ONE change rather than the two Dependabot
opened. They are not merely convenient to batch: `@astrojs/node@11.1.4` raises
its peer requirement to `astro@^7.2.1`, and both packages pull the same
`@astrojs/internal-helpers@0.10.4`, so the lockfiles of the two pull requests
overlap and landing one leaves the other conflicted.

The bump also cannot travel alone. `awcms-family-compatibility.yaml` pins
`stack.astro.declared` and `stack.astroNode.declared` as SOURCE CONSTANTS that
must equal `package.json` exactly, so `family:conformance:check` goes red on any
bump until the manifest moves with it — which is what it caught here
(`[FAIL] stack: Astro (declared ^7.2.2 vs actual ^7.2.4)`). The stack table in
`docs/awcms/family-compatibility.md` and its Indonesian twin are held to the
manifest by `tests/family-compatibility-doc-parity.test.ts`, so they move too;
that parity test exists precisely because the table once said `^7.0.7` while the
repo ran `^7.2.2` and nothing was looking.

The sibling pull request carrying the `@astrojs/node` half is closed rather than
merged.
