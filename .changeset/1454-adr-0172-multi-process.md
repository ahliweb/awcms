---
"awcms": patch
---

docs(adr): ADR-0172 (Accepted, owner decision of 24 November 2026) on running more than one application process per node to reach the ADR-0161 per-node target (Issue #1454 remainder). Documents only: no code, schema or API change. Records the measured one-thread ceiling, the audit of in-process state that assumes one process (including the ABAC policy cache, which has per-process invalidation and no TTL), the verified Bun 1.4.4 behaviour of `Bun.serve` `reusePort`, `node:http` and `node:cluster`, a recommendation, a measurement plan and the owner's answers to its seven questions (default stays one process; gates unchanged).
