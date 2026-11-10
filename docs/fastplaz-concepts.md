# AWCMS modular backend/tooling — FastPlaz concepts, repository-specific architecture

## Document control
- **Version:** v1.0.0
- **Updated:** 2026-11-10
- **Status:** Proposed architecture / research only; not a production feature.
- **Document Changeset:** First reference and implementation-boundary mapping.
- **Owning issue:** [#1251](https://github.com/ahliweb/awcms/issues/1251).

## Summary and confirmed local baseline
Bun + Astro + PostgreSQL FORCE RLS; existing modular-monolith registry `src/modules/index.ts`, `awcms-new-module`, endpoint/migration/event skills, OpenAPI/AsyncAPI, audit, tenant and permission controls.

## Intent and candidate adaptation
Improve current module scaffolding through a deterministic, reviewable generation specification. Keep API routes in `src/pages/api/v1`; output proposed module descriptor, domain/application/infrastructure skeleton, tests, permissions, subject-data classification, OpenAPI fragment, AsyncAPI links and migration proposal. Never write directly to production schema.

## Authority and prohibitions
AWCMS owns backend/domain modules. Editor context belongs IDE-native tools. Hermes owns agent sessions. OMES owns host operations. AWCMS-One `apps/cms` is downstream subtree; no duplicate generator there.

## Existing related issues and anti-duplication
Module generator research [#1251](https://github.com/ahliweb/awcms/issues/1251).

## Six concrete validation scenarios
1. New inventory module: strict per-route ABAC, FORCE RLS and idempotent movement commands.
2. New site content module: public read cannot mutate tenant/system management.
3. Personal-data module: explicit subjectData descriptors and erasure policies.
4. Domain event module: AsyncAPI/outbox, retry, replay and idempotency.
5. Module registration conflict: reject duplicate key, existing SQL ID or route prefix.
6. Agent diagnostic: parse compiler/test error while excluding `.env` and credentials.

## Proposed checks and test evidence
Read real module registry; build/gates via `bun run check`, `family:conformance:check`, route/API specification parity, subject-data coverage, security and tenant-negative tests. Do not claim results until executed.

## Rollout / handoff
Inventory the current generator skill and existing scripts; design spec schema, dry-run diff and no-overwrite behavior; propose implementation issues only after Gate 9.

## Source reference and limits
This document takes **concepts only** from [FastPlaz](https://github.com/fastplaz/fastplaz): [MCP/AI Agent Plane](https://github.com/fastplaz/fastplaz/blob/master/docs/MCP.md), [IDE workflow](https://github.com/fastplaz/fastplaz/blob/master/docs/AI_AGENT_by_FASTPLAZ.md), and [standalone operator concepts](https://github.com/fastplaz/fastplaz/blob/master/docs/STANDALONE-deployment.md). No Pascal, Lazarus, CGI, MVC/theme engine, or source-code copying. [FastPlaz license text](https://github.com/fastplaz/fastplaz/blob/master/LICENSE.txt) does not demonstrate explicit source-code permissions; independent implementation only.

## Cross-portfolio engineering invariants
Applies the **internal cross-portfolio standard**, alongside this repository's own AGENTS, ADR, CONTRIBUTING and current code reality. Human-approved **Gate 9 (cross-spec Definition of Ready)** precedes production feature code; human-approved **Gate 15 (release readiness)** precedes production. One issue/branch/PR per atomic scope. Never present a specification, green documentation check, or research as working production functionality.

Local MCP/tool connector, if ever required: loopback or authenticated IPC, host/Origin restrictions for HTTP, rotating scoped credentials, canonical-path and symlink protections, read/write/destructive approval tiers, no arbitrary shell, no default SQL/raw DB/secret access, bounded resource/time/cancellation, policy at actual tool/OS runtime, fail-closed unknown and redacted logs. Human sign-off for changes to authorization, production configuration or sensitive data.

## Relevant regulatory and control references
Evaluate applicability, not compliance by assertion: Indonesian UU 27/2022 (PDP), PP 71/2019 (PSTE), Perpres 95/2018 where SPBE applies; ISO/IEC 27001, 27002, 27005, 27017, 27018, 27034, 27701, ISO 22301, ISO/IEC 20000-1, ISO/IEC 42001, ISO/IEC 15408; OWASP LLM/Agentic Security, NIST AI RMF. Obtain independent control evidence and applicable edition before any claim of certification.

## Acceptance evidence rubric
For any follow-on: link spec/ADR and owning issue; record source commit, toolchain/runtime version, commands executed, actual error/result, denied access tests and evidence SHA. Mark unrun checks **NOT EXECUTED**. Approvals and publication/deployment status are distinct. No sensitive personal data or production secrets in prompts, logs or GitHub artifacts.


## Changelog
- **v1.0.0 — 2026-11-10:** Documented evidence-backed, repo-specific adoption boundary, six practical cases and acceptance rubric.
