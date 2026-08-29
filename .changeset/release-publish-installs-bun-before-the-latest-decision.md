---
"awcms": patch
---

fix(ci): install Bun in the release publish job before deciding the "Latest" badge

`sign-attest-publish` runs `bun scripts/release-latest-flag.ts` to decide the
"Latest" badge (ADR-0119), but that job runs in its own isolated `needs: build`
job — the `Setup Bun` step from `validate` does not carry over, so the
invocation had no `bun` on `PATH`. `.github/workflows/release.yml` now installs
the pinned Bun toolchain in `sign-attest-publish` before that decision step
runs.

A regression test was added (`tests/release-latest-flag.test.ts`) asserting
that `sign-attest-publish` installs Bun (`oven-sh/setup-bun@`) before invoking
`bun scripts/release-latest-flag.ts`.
