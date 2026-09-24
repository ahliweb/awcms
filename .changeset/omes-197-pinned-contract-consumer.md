---
"awcms": minor
---

feat(control-center): consume pinned OMES v1 contracts with fail-closed validation (ahliweb/omes#197)

Vendors a pinned, byte-identical snapshot of `contracts/control-center/v1/**` from OMES commit `0824f9815bd8429781f70ed529787ce5399585c3` into `src/modules/omes-control/contracts/v1/` (schemas, `*.states.json` state machines, event schemas, and every fixture), with a `PIN.json` manifest recording the source repo/commit/version and a SHA-256 hash per vendored file. No network access is used at runtime or test time.

Adds `scripts/sync-omes-contracts.ts` (`bun run contracts:omes:sync` to re-vendor from a local OMES checkout, `bun run contracts:omes:sync:check` for a read-only drift/pin-mismatch gate now wired into `bun run check` right after `api:consumer-contract:check`).

Adds a dependency-free, fail-closed TypeScript validator under `src/modules/omes-control/domain/contracts/` (`schema.ts`) that is a line-for-line port of OMES's own `lib/omes/py/jobs/schema.py` supported-keyword subset and independent raw-secret scanner (issue #172) — no `ajv`/`zod`/other JSON Schema dependency was added. A data-driven state-machine transition checker (`state-machine.ts`) loads `subscription.states.json`/`invoice.states.json` as data rather than duplicating the transition rules as TypeScript. Unknown schema names and unsupported contract versions are rejected before any file is read.

Exports a small public API from `src/modules/omes-control/domain/contracts/index.ts` for `#198`/`#199` to build on: `validateOmesContract`, `validateOmesContractText`, `assertOmesContract`, `scanForRawSecrets`, `getOmesStateMachine`, `OMES_CONTRACT_PIN`.

Documented in ADR-0122's new addendum (and its Indonesian mirror), including the re-sync update procedure.
