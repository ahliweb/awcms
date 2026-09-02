---
"awcms": patch
---

chore(deps): bump astro 7.2.4 → 7.2.9 — and the three other places that pin it

Dependabot's PR (#757) changed `package.json` and `bun.lock` and failed two CI
jobs, because in this repo the Astro version is **declared in four places and
asserted between them**:

1. `package.json` `dependencies.astro` — what Dependabot changed;
2. `awcms-family-compatibility.yaml` `stack.astro.declared` — asserted equal to
   (1) by `family:conformance:check`, which is why both the `quality` and the
   `minimum-supported` jobs went red rather than just one;
3. and 4. the stack table in `docs/awcms/family-compatibility.md` **and its
   Indonesian mirror**, asserted equal to (2) by
   `tests/family-compatibility-doc-parity.test.ts`.

Fixing only (2) still leaves two failing assertions, which is the point of the
arrangement: the manifest is the family contract `awcms-astro` binds against,
and a contract that can drift from its own published table is not one. Nothing
here required judgement — but nothing here was automatic either, and a bump
merged without it would have reddened `main`.

`DATABASE_URL="" bun run check` is green on the result (5,981 pass, 0 fail),
including the Astro build and `check:astro-frontmatter:check`.
