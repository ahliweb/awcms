---
"awcms": patch
---

Confine AWCMS development to `ahliweb/awcms` and `ahliweb/awcms-astro` (ADR-0055), and re-anchor the compatibility manifest.

ADR-0047 froze `awcms-mini`/`awcms-micro` as references that could still be ported OUT. That half position had a running cost: the manifest still declared `standard: awcms-mini`, and its nine `intentionalDivergences` each carried a `reviewDate` that turns CI red on expiry — scheduling this repo to keep re-justifying its differences from a repo nobody develops. The backlog framed work as moving existing code rather than deciding what to build, and the four most recent foundation features (ADR-0046, -0049, -0053, -0054) were all built here anyway. The written rule had fallen behind the actual one.

`awcms-mini` and `awcms-micro` are now archives: readable as history, never a scheduled source of ports. Wanted capabilities are built here with their own admission ADR, judged on today's need.

The manifest stays gated and self-anchored — its 23 contract-version checks against real source constants are untouched, because the mechanism was never the problem. `intentionalDivergences` is emptied and the nine entries are preserved verbatim in `docs/awcms/family-compatibility.md`, where their ADR links are still verified to exist by `check:docs`.

ADR-0047 §4 (record every foundation feature as a divergence as it lands) is retired: the ADR is the record, and the duplicate was only ever another thing to keep in step. Every other §3 guardrail stands — ADR for standard changes, extra security review for `auth`/`access`/`sync`, full `bun run check`, OpenAPI/AsyncAPI in sync, `FORCE` RLS, ABAC default-deny, applied migrations immutable.

Docs-only: no runtime code changes.
