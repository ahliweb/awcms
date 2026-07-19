---
"awcms": minor
---

feat(foundation): family compatibility manifest + CI conformance gate against the AWCMS-Mini standard (Issue #183)

Adds `awcms-family-compatibility.yaml` (machine-readable, versioned, schema-validated) declaring AWCMS's conformance to the AWCMS-Mini family standard: family/module/capability/API/tenant-context/audit/idempotency/migration contract versions, validated stack versions (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL), and an explicit intentional-divergence allow-list (reason/owner/reviewDate/ADR). New `bun run family:conformance:check` gate (wired into `bun run check` + ci.yml, parity-tested) cross-references every declared version against the real source and fails on drift or an unreviewed/unbacked divergence, emitting a secret-free pass/fail evidence report. Semantic, mutation-provable contract tests pin the reusable controls (tenant-context fail-closed under FORCE RLS, response envelope, redaction, idempotency, migration immutability/checksum, module composition) so any weakening of default-deny/RLS/redaction/audit/idempotency turns conformance RED. No migration (tooling/docs only); ADR-0032; `docs/awcms/family-compatibility.md`.
