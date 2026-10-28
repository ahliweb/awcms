---
"awcms": patch
---

Add a versioned OMES worker contract consumer compatibility gate (Issue #1185, partial). `src/modules/omes-control/domain/contracts/compatibility.ts` declares the pinned contract (source commit and an aggregate digest over the PIN file map) and a supported worker range, and evaluates a worker descriptor fail-closed: unknown, missing, future-major, pre-release or out-of-range versions and a mismatched digest are `incompatible`, an unknown capability is `unsupported_capability`. New offline `bun run omes:contract:preflight` (part of `bun run check`) refuses a vendored contract that differs from that declaration or a missing OpenAPI worker route, and can evaluate a worker with `-- --worker <descriptor.json>`. The worker range is declared, not verified against a tagged OMES release; no runtime behaviour changes.
