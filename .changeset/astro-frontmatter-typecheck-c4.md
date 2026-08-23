---
"awcms": minor
---

fix(admin-seo): `/admin/seo` answered 404 on every request and had never rendered — plus the gate that found it (C4)

`/admin/seo` computed `showRedirectActions` as the **third statement** of its frontmatter, from three `const`s declared 130 lines further down in the same scope. That is a temporal dead zone: the compiled component threw `ReferenceError: Cannot access 'canUpdateRedirect' before initialization` before rendering anything.

The screen had never worked once. It passed review, `bun run check`, the build, and CI, and the compiled production chunk shows the ordering preserved — statement 3 reading what statement 120 declares. An always-404 operator screen is the failure this repo is least able to notice: nothing polls it, and its module descriptor lists it in the sidebar, so it looks shipped.

### Why nothing saw it, and why the fix is a gate

`tsc` cannot parse `.astro`, and `astro check` **cannot run here** — `@astrojs/check@0.9.10` refuses on TypeScript 7 ("does not expose the programmatic API that `astro check` relies on"), verified by installing and running it rather than by reading a peer range. No version fixes it, and downgrading to 6.x would regress the compiler under ~156,000 lines and 33 gates to buy one checker.

So 61 files and ~34,760 lines were checked by nothing. ADR-0068 §C recorded that as an intentional divergence whose mitigation was that reviewers read `.astro` diffs by eye. This is what that mitigation missed.

### [ADR-0112](../docs/adr/0112-astro-frontmatter-is-type-checked-by-extraction.md) — `check:astro-frontmatter:check`

Every `.astro` frontmatter is extracted to a sibling `*.astro-frontmatter-check.ts`, type-checked with this repo's own `tsc`, and deleted in a `finally` — the technique `check:astro-scripts:check` already used for `<script>` blocks (#552, which found two defects the same way). Same directory is the whole trick: frontmatter imports are relative, so a mirrored tree would need every specifier rewritten, a transformation that can itself be wrong.

Four shims make an extracted block compile, and each gives something up — `*.astro` imports (component `Props` unchecked at call sites), the `Astro` global (`Astro.props` becomes the generic record; `App.Locals` still applies, so `locals.ssrContext` and `locals.locale` ARE checked), `export {}` for module scope (without it an import-free frontmatter is a SCRIPT whose top-level `const`s go global, and two components here both declare `ariaLabel`), and `noUnusedLocals` off for this project only (the template consumes nearly every binding, so 658 phantom diagnostics buried the signal).

Together they took the raw output from **920 diagnostics to the 6 that were real.**

The gate reported exactly those 6 before the fix and `OK — 61 frontmatter block(s) typechecked` after, which is the regression test: it covers every other `.astro` too, not just this page.

### The divergence is narrowed, not deleted

`astro-files-not-type-checked` now covers exactly one thing — component `Props` at their call sites — and the eye-reading instruction in `awcms-testing`/`awcms-pr-review` stays for that class. Standards finding **C4 is closed**, which was the last open row in the document.

One mistake worth recording: the shim first carried a top-level `import type`, which made the `.d.ts` a module — and `declare module "*.astro"` inside a module is read as augmentation rather than a wildcard, so every `.astro` import still failed and the gate reported 53 phantom `TS2307`s. A test now asserts the shim has no column-0 `import`/`export`.
