---
"awcms": patch
---

fix(gate): `build:preview-overlay:check` said STALE when it meant "different Bun"

The gate rebuilds `public/js/blog-preview-overlay.js` in memory and compares
bytes. A minified bundle is the output of a specific bundler, so those bytes
change when the bundler does — which means the comparison was asking two
questions and reporting only one answer: "was the artefact rebuilt after its
source changed", and "is this machine running the same Bun that produced it".

On a developer machine one minor ahead of the `1.3.14` pin it answered
`is STALE` — a claim about the artefact — when the artefact was correct and the
toolchain differed.

## Why that was worse than a false red

- **It failed the test suite too.** `tests/blog-preview-overlay.test.ts` shells
  out to the gate, so the single failure in a 6,869-test run was this, on a tree
  with nothing wrong with it.
- **It hid every stage behind it.** In the `check` chain the gate sits
  immediately before `typecheck && … && test && build`, and `&&` stops there —
  so off the pin, `bun run check` never reached the stages that matter.
- **Its remedy made things worse.** The message names
  `bun run build:preview-overlay`, and running that off the pin writes a bundle
  CI rejects. The gate handed out the instruction that breaks the thing it
  guards, and the resulting commit reddens CI for everyone.

## What changed

The Bun version is now a stated **precondition** instead of a hidden
assumption, read from `packageManager` so the pin is not written down twice.
`family:conformance:check` already asserts CI's `bun-version:` set equals
{`packageManager` pin, `engines` floor}, so that reading cannot drift from the
version CI installs.

- **On the pin** — unchanged, full strength: a byte difference is `STALE` and
  exits 1. This is what CI runs, in every job.
- **Off the pin** — a difference is reported as `UNVERIFIED` and exits 0, saying
  which Bun is running, which is pinned, and that rebuilding here is not the
  fix.
- **`build:preview-overlay` now REFUSES to write off the pin**, rather than
  warning: a warning above a successful write reads as success, and by then the
  wrong bytes are already staged. `--allow-version-mismatch` exists for the one
  legitimate case — deliberately moving the pin, where the new Bun *is* the
  correct builder.
- Two outcomes stay version-independent and still fail anywhere: a **missing**
  artefact, and a **match** (a match is a match, whoever built it).

## Proven in both directions, not just asserted

The strict branch was exercised by pointing the pin at the running Bun and then
introducing a genuine source change: the gate fails, and passes again once the
bundle is rebuilt. The test carries the same precondition rather than accepting
any output — off the pin it asserts the half that was broken (must not claim
staleness, must not exit non-zero); on the pin, which is CI, it demands `OK`
exactly as before.
