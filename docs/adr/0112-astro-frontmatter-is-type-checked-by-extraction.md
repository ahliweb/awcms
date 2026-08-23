🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0112-astro-frontmatter-is-type-checked-by-extraction.id.md)

# ADR-0112 — `.astro` frontmatter is type-checked by extraction, because `astro check` cannot run here

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision maker:** ahliweb
- **Related:** standards finding C4; [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md) §C (the divergence this narrows); Issue #552 (`check:astro-scripts:check`, the same technique for `<script>` blocks); `awcms-family-compatibility.yaml` → `astro-files-not-type-checked`

## Context

`bun run typecheck` is `tsc --noEmit`, and `tsc` cannot parse `.astro`. The standard answer is `astro check`, and this repo cannot run it. Verified by installing `@astrojs/check@0.9.10` and running it rather than by reading the peer range:

> The TypeScript module loaded (found 7.0.2) does not expose the programmatic API that `astro check` relies on. TypeScript's native compiler (7.0 and later) does not ship this API yet.

There is no version that fixes this. The repo is on TypeScript `^7.0.2` deliberately, and downgrading to 6.x to satisfy one checker would regress the toolchain under 33 gates and ~156,000 lines that `tsc` keeps clean today.

So **61 `.astro` files — roughly 34,760 lines — were checked by nothing at all.** ADR-0068 §C recorded that as an intentional divergence with a review date, and the mitigation was explicit: `awcms-testing` and `awcms-pr-review` instruct that any `.astro` diff be read for types by eye.

### Reading by eye did not work, and the proof is a screen that never rendered

`/admin/seo` computed:

```ts
const showRedirectActions = canUpdateRedirect || canDeleteRedirect;
```

as the third statement of its frontmatter, from three `const`s declared **130 lines further down** in the same scope. That is a temporal dead zone: the compiled component function threw `ReferenceError: Cannot access 'canUpdateRedirect' before initialization` before rendering anything.

**The screen answered 404 on every request and had never worked once.** It passed review, `bun run check`, the build, and CI. The compiled production chunk shows the ordering preserved — statement 3 reads what statement 120 declares — so this was not a theoretical hazard.

An operator screen that always 404s is the failure mode this repo is least able to notice: nothing polls `/admin/seo`, and its module descriptor lists it in the sidebar, so it looks shipped.

## Decision

**Every `.astro` frontmatter is extracted to a sibling `*.astro-frontmatter-check.ts` and type-checked with this repo's own `tsc`, as `check:astro-frontmatter:check` in the `check` chain.**

This is the technique `check:astro-scripts:check` already uses for `<script>` blocks (Issue #552, which found two defects the same way), applied to the other half of the file. The generated files land in the SAME directory as the page and are deleted in a `finally`: frontmatter imports are relative, so a mirrored tree elsewhere would need every specifier rewritten — a transformation that can itself be wrong, and would then report errors that are not in the page.

### The four compromises, all deliberate and all documented in place

An extracted frontmatter is not a valid standalone module. Four adjustments make it compile, and each one gives something up:

1. **`declare module "*.astro"`** — `tsc` cannot resolve component imports. **Cost:** a component's `Props` are not checked at its call sites; a misspelled or missing prop still compiles.
2. **`declare const Astro`** — the compiler injects this global into a real `.astro`. `App.Locals` still applies, so `Astro.locals.ssrContext` and `Astro.locals.locale` ARE checked. **Cost:** `Astro.props` is the generic record rather than the page's own `Props`.
3. **`export {}` appended** — a frontmatter with no import is a SCRIPT to TypeScript, so its top-level `const`s land in the global scope. Two components here both declare `ariaLabel`, and without this they collide with an error belonging to neither file.
4. **`noUnusedLocals` / `noUnusedParameters` off, for this project only** — nearly every frontmatter binding is consumed by the TEMPLATE, which is not extracted. Leaving them on produced 658 phantom "declared but never read" diagnostics and buried the signal. An unused frontmatter const is also the cheapest defect class there is; a use-before-declaration is not.

Together these took the raw output from **920 diagnostics to 6** — and the 6 were the real defect.

### The shim is excluded from the root `tsconfig.json`

`declare module "*.astro"` must not reach the main typecheck, or it starts answering for real imports there and hides genuine errors. The shim file also carries no top-level `import`/`export`, because a `.d.ts` with either becomes a module — and `declare module "*.astro"` inside a module is read as _augmentation_ rather than a wildcard, so every `.astro` import fails to resolve anyway. That mistake was made while building this and cost 53 phantom errors; a test now asserts against it.

## Consequences

- Undefined variables, wrong types across every `src/` import, null handling, `await`/async mistakes, and statement ordering are now checked in all 61 files.
- The `astro-files-not-type-checked` divergence is **narrowed, not removed**. What it now covers is exactly one thing: component props at their call sites. The eye-reading instruction in `awcms-testing` and `awcms-pr-review` stays for that class.
- The gate refuses to start when a generated file is left over from an interrupted run. They are gitignored, so an orphan is invisible to git and would otherwise be type-checked in place of a page it no longer matches.
- Reported line numbers are relative to the block; the failure message says to add 1 for the page's opening `---`.

## Alternatives considered

**Downgrade TypeScript to 6.x so `astro check` runs.** Rejected: it buys prop checking on 61 files at the cost of regressing the compiler under ~156,000 lines and 33 gates. The ratio is the wrong way round, and ADR-0068 already reasoned this out.

**Wait for `astro check` to support TypeScript 7.** That is the status quo the divergence records, and it is what let a screen 500 for weeks. Waiting remains correct for the prop-checking half, which is why the entry survives — but it was not correct for the whole.

**Check the whole `.astro` file with a custom parser.** Rejected: a parser that disagrees with Astro's own is a source of errors that are not in the page, and of silence where there are. Extracting a region verbatim and handing it to the real compiler has neither failure mode.

## Amendment — 23 August 2026: the symptom is a 404, not a 500

Building the render smoke test that complements this gate
(`tests/e2e/admin-screens-render.e2e.ts`) meant reintroducing the `/admin/seo`
fault and watching a real server answer. It does **not** answer `500`.

When a frontmatter throws, the `ReferenceError` goes to the **server log** and
the browser is handed a **404**. This ADR originally said 500 throughout, and
every document repeating it has been corrected.

The correction matters because it changes how the class is hunted. Asking
"which admin screens return 5xx?" finds nothing and concludes the fleet is
healthy — a screen that throws on every render is indistinguishable, by status
alone, from a route that was never built. The smoke test therefore asserts
`200` exactly (the seeded owner holds every permission, so every admin screen
owes it a rendered page) rather than merely "not 5xx", which would have passed
straight over the defect it was written for.
