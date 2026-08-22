---
"awcms": patch
---

fix(gates): five gates were scanning less than they claimed, because a comment stripper ate real code

Eight files carried their own `stripComments`, and the version most of them
carried began by running a block-comment regex over the whole file:

```ts
source.replace(/\/\*[\s\S]*?\*\//g, "")
```

Nothing there knows about strings. A `/*` inside a **string literal** opens a
comment that is closed by the next `*/` anywhere in the file, and everything
between them is deleted. A route glob is enough to trigger it, and route globs
are ordinary:

```ts
const PARTNER_GLOB = "/api/v1/partner/**";

await tx`INSERT INTO awcms_tenant_users (tenant_id) VALUES (${t})`;

/** A docblock whose closing marker ends the accidental comment. */
```

Run through the naive stripper, that `INSERT INTO` **is gone**.

**What it cost on a real file.** `src/modules/blog-content/module.ts` loses 7,260
characters and 57 lines to it — including its entire `jobs:` and `capabilities:`
declarations. Any gate reading that descriptor through the naive stripper was
looking at a module with no jobs, and reporting OK. Across `src/`, 29 files lose
more than 200 characters.

Five gates were built on it: `modules:table-writes:check`,
`access:chokepoint:check`, `config:env:coverage:check`,
`identity:principal-access:check` and `access:grant-readers:check`.

**No gate signal differs today**, which is exactly why this is worth fixing now:
it is a fail-open that grows with every new docblock and every new glob constant,
and reports nothing as it grows. All eight gates were run before and after — same
answers, and `docs/awcms/work-class-registry.generated.json` regenerates
byte-identical.

The implementation now lives once, in `scripts/lib/source-text.ts`: the
string-aware scanner that was local to `i18n-catalog-check.ts`. It blanks
characters rather than removing them, so offsets and line numbers survive and a
removed comment cannot splice two tokens into a third that matches.

`work-class-registry-generate.ts`'s `codeOnly` is folded in too. It was not the
swallowing variety — no whole-file regex — but it was blind the other way: a
block comment whose middle lines do not begin with `*`, or a trailing
`/* … */` after code, survived it and could be read as a call.

`stripComments` stays re-exported from the three scripts that 21 test files
already import it from, rather than editing 21 import lines in a change about
something else.

The test keeps the naive version as an **oracle** — a test that only exercised
the good stripper would assert that it works, which is easy and uninformative.
Comparing both on the same input is what shows the difference is real, and what
notices if somebody reintroduces the shortcut.
