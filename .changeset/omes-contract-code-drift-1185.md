---
"awcms": patch
---

test(omes): code-vs-contract drift gate for the vendored OMES worker contract (Refs #1185). `bun run omes:contract:preflight` (part of `bun run check`) now also refuses a release whose `OMES_OPERATION_CODES` differs, in value or order, from the vendored `operation-request` and `worker-poll.response` operation enums or is not a subset of the broader operation enums. A new test drives the real worker route handlers and validates every HTTP 200 body against the pinned `*.response` schemas; this found that a rejected `/api/v1/omes/worker/enroll` echoed an empty `tenant_id`/`server_id`, which the contract forbids. It now answers `unknown` for a non-conforming id. No schema, migration or OpenAPI change. Canary/rollback evidence and the upstream release items stay open.
