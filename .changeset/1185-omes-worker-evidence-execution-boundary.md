---
"awcms": patch
---

test(omes_control): record schema-level evidence for the declared OMES worker range, vendor the producer's compatibility artifacts behind a gate, and pin the module's execution boundary (Issue #1185, partial).

- `DECLARED_WORKER_EVIDENCE` records that the vendored worker schemas are byte-identical to the public OMES `v0.6.0` tag (digest recomputed with the producer's own formula, equal at the tag, at the vendored commit and in this repository). The status is stated as **schema-identical, runtime-unverified**: the v0.6.0 worker does not sign requests, no release publishes a manifest, and `verifiedBuilds` stays empty. `bun run omes:contract:preflight` recomputes the digest from `PIN.json`, so a contract re-sync that changes the worker contract is refused until the evidence is re-derived.
- The producer's compatibility manifest schema, fixtures and consumer decision table are vendored under `contracts/compatibility/v1/` with their own `PIN.json`, a hand-declared commit and aggregate digest, and preflight checks for drift, stray and missing files; mutation tests prove each check goes red.
- New `tests/omes-control-execution-boundary.test.ts`: a parser-based (`Bun.Transpiler`) static tripwire over the module (including `contracts/`), its `/api/v1/omes/**` routes, its `/admin/omes/**` screens and every `scripts/*omes*` script for process spawning, shell/SSH, raw sockets, dynamic code, `fetch` other than a literal `/api/` path, and any `ssrfSafeFetch` use outside one pinned GitHub API call, with a required-red mutant for each shape.
- `evaluateWorkerCompatibility` now attaches the v0.6.0 evidence line only to a worker whose `omes_version` equals that tag; a worker elsewhere in the declared range is accepted with no evidence line instead of inheriting it.
- No behaviour change at runtime. The worker request-signature scheme is NOT changed; the open decision is recorded in the module README.
