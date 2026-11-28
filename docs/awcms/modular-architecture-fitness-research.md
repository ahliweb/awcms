# Modular architecture fitness — evidence and review proposal

Version: v0.1.0 | Date: 2026-11-28 | Status: PROPOSED / research
Document changeset: initial baseline, test plan and extraction evidence matrix. History: v0.1.0 initial.
Tracks #1543; related #1544 and #1545 remain separate research issues. This document does not supersede ADRs.

## Baseline (static, not runtime)
Search snapshot 164d49aecbbab09cad9487fe63be315f0b83fa2b; additional default-branch reads, not a tested checkout.
- ADR-0011 capability ports and owning adapters; composition at approved outer root. ADR-0043 technical src/lib vs module presentation.
- src/modules/_shared/module-contract.ts blob 5555978b4f54842e673ca00dcde09f289db13313; src/modules/index.ts blob 89bcad8fab9fec3d910fab4ade9bb397d31c63c2: existing registry/descriptor, route/event/capability/permission contracts.
- scripts/validate-module-graph.ts blob 18cd72a663c7981895b766a4ba4e749c2fec2058: declared lifecycle DAG and lib namespace checks.
- tests/module-boundary.test.ts blob eb3c4dd201e3edb381feed9d7495088365c8cdce: source edges, type-only imports and reviewed exceptions; partial inspection, not proof of complete resolver coverage. Historical cycles described in comments are not assumed present.
- scripts/table-write-ownership-check.ts blob 52128a7a2050b0422a514a055f4cea71e661ef76: literal SQL single-writer check and descriptor-based exceptions; #1268 closed recursive scripts glob fix. Do not repeat it.
- scripts/validate-module-composition.ts blob 6f35df298c4ef77692e1f6dcd32193d55d52f001 and module-composition-inventory-check.ts blob 89df532cca0ca96bd4adb4f6e9727ed96a34d693: composition and inventory freshness.
- ADR-0013 blob a6bd10441d0fe673eb43858b5471a0e1e8c20f08: §6 ownership and §7 extraction remain applicable, historical derived path superseded. Reuse family:conformance, routes, jobs, consumers, API/AsyncAPI, RLS and existing tests. Do not revive retired extension contracts or duplicate registry.

## Hypothesis and scope (#1543)
Separate graph edge kinds: lifecycle order, actual static source import (value/type/re-export/alias), runtime wiring/capability, data read/write/reference, event publish/consume. Cycles in lifecycle must fail; source cycles require explicit review under existing policy. Bidirectional event interaction or optional capability need not imply cyclic boot order; never flatten graphs blindly.
Audit resolver behavior at pinned HEAD: TS relative/path alias/barrel, Astro script/frontmatter, dynamic literal import, unresolved/nonliteral imports, scripts and composition roots. Inventory all scopes and existing detection; mark unresolved edges, do not claim complete graph. Candidate: extend existing deterministic test/helper only if reproduced gap; use strongly connected components to report actual source cycles, compare with declared graph and exceptions. Graphify/knowledge graph is advisory, reuse #805 if applicable; no new parser/dependency without license/ADR review. Keep runtime boundaries and valid optional modules.
Exception record: edge kind, source/target, rationale and ADR/issue, owner, risk/control, evidence, review trigger/expiry; no permissive blanket allow-list. Do not remove bootstrap/auth exception without preserving invariants.

| ID | Synthetic fixture | Expected result |
|---|---|---|
| F01 | declared lifecycle cycle/missing key | existing gate fails |
| F02 | hidden actual A→B→C→A source cycle | reported by proposed audit; block new unapproved violation |
| F03 | import private implementation via alias/barrel/type | detected or explicitly classified unresolved |
| F04 | legitimate optional capability and composition root | pass under current ADR; no artificial dependency |
| F05 | unauthorized domain hidden under lib | existing namespace and relevant import gate catch |
| F06 | accepted exception vs widened exception | narrow accepted edge passes; mutation is detected |
| F07 | no source files scanned / resolver failure | fail or explicit incomplete result, never green vacuously |

Use labeled fixtures, compare baseline vs candidate precision/recall (TP/(TP+FP), TP/(TP+FN)), unresolved count, false-positive burden, CI time, mutation evidence. Measure first; no current pass/fail claim. Do not admit unrelated module or change semantics.

## Related data/transaction evidence (separate #1544 and #1545)
One canonical writer, not one DB per module. Audit literal/dynamic SQL, views, triggers/functions, SQL role/grants, security definer/search_path, RLS FORCE, worker operations and approved descriptor-based paths. Postgres catalog alone cannot resolve all SQL body dependencies. Classify FK intra-aggregate/module, tenant/canonical identity, cross-module approved invariant, extraction candidate and cascade; preserve necessary constraints. Use tenant-safe composite references where domain requires; FK/unique checks bypass RLS, avoid existence leaks and verify uniform authorized errors. Approved reporting projection/read path may be allowed. Test tenant A/B same logical ID, unauthorized function/cascade, orphan record and rollback, positive legitimate paths. Do not delete constraints merely to avoid coupling.
Local typed port invocation may share a transaction for invariants; remote calls cannot assume local atomicity. Keep existing domain-event runtime, durable outbox and consumer registry. Verify transaction→outbox atomicity; duplicate delivery/effect, versioned schema, per-aggregate order where required, retry/backoff/quarantine, replay, unknown provider outcome and reconciliation. No blanket exactly-once promise. Protect tenant/actor/worker scope; logs and traces no sensitive payload. AW-IRL resource limits separate from module authorization. No new broker or HTTP-for-local rewrite.
Data changes: expand/backfill/reconcile/contract, applied migrations immutable; maintain one canonical writer.

## Extraction evidence (ADR-0013 §7)
ALL six conditions require measured evidence: materially different CPU/IO/concurrency profile; different security/process/network boundary; business-required independent release cadence; clear different on-call owner; separable data ownership and stable API/event contract; business-continuity need for failure isolation. Prerequisites: historical backfill, shadow read, explicit cutover, rollback, no dual write, observability before authority switch. Score cannot compensate for missing condition. Compare modular monolith, worker split and selective service with repeated same workload/seed/build/hardware. Observe throughput, p95/p99, error/queue age, resource/cost, recovery, RPO/RTO and on-call burden. Approval of new ADR and Gate 9 before implementation; no service extraction here.
## Verification / DoD
At implementation: full inventory at HEAD, review current ADRs, tests above, real PostgreSQL security tests, existing modules:dag:check, modules:compose:check, modules:table-writes:check, modules:routes:check, modules:composition:inventory:check, domain-events:consumers:check, family:conformance:check, api/AsyncAPI and full bun run check, with exact commands/results and applicable changeset/en-id docs; no bypass. Check actual script names in package.json. All tests unrun here. No code, migrations, dependencies, ADR status, deployment changes. Rollback docs by revert; future code changes require compatibility and rollout plan. Research motivated by https://www.youtube.com/watch?v=qTfkfel9x1Q (transcript provided; original audio unverified), independent design, no external demo code or assets.
## Bibliography (checked 2026-11-28)
- Parnas, D. L. (1972), On the Criteria To Be Used in Decomposing Systems into Modules, CACM 15(12), 1053–1058. https://doi.org/10.1145/361598.361623 — foundational information hiding; not a modern performance benchmark.
- Garcia-Molina & Salem (1987), Sagas. https://doi.org/10.1145/38713.38742 — compensating transactions; not atomic rollback of external effects.
- Evans (2003), Domain-Driven Design, Addison-Wesley; Cockburn (2005), Hexagonal Architecture, https://alistair.cockburn.us/hexagonal-architecture/ — conceptual models.
- Stepwise migration of a monolith to a microservice architecture (2024), https://www.sciencedirect.com/science/article/pii/S0166531624000166 — contextual migration comparison. 
- Migration of monolithic systems to microservices: A systematic mapping study, Information and Software Technology 177 (2025), 107590. https://www.sciencedirect.com/science/article/pii/S0950584924001952 — 114 of 1,546 candidate studies; mapping not a causal benchmark.
- Modular Monolith Architecture in Cloud Environments: A Systematic Literature Review, Future Internet 17(11), 496 (2025). https://doi.org/10.3390/fi17110496 — searches six libraries, 2020–May 2025; limited empirical benchmarking and shared definitions.
- Developing a Framework for the Quality-Driven Migration to Microservices: A Multi-Method Design Science Study (2026). https://doi.org/10.1002/spe.70062 — interviews with 25 professionals in preliminary studies, quality-driven migration; no AhliWeb performance claim.
- Fowler (2015), https://martinfowler.com/bliki/MonolithFirst.html and https://martinfowler.com/articles/microservice-trade-offs.html — practitioner analysis; Shopify retrospective https://shopify.engineering/a-packwerk-retrospective — costs of boundary maintenance in one organization.
- Spring Modulith verification and events https://docs.spring.io/spring-modulith/reference/verification.html and https://docs.spring.io/spring-modulith/reference/events.html ; ArchUnit https://www.archunit.org/userguide/html/000_Index.html — examples of architecture checks, not dependencies to install.
- PostgreSQL 18 constraints, row security and dependency tracking https://www.postgresql.org/docs/18/ddl-constraints.html ; https://www.postgresql.org/docs/18/ddl-rowsecurity.html ; https://www.postgresql.org/docs/18/ddl-depend.html — verify actual deployed major version; catalog dependencies do not cover all function-body references.
- AWS outbox/saga https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html ; https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-patterns.html — design guidance only.
- OpenTelemetry messaging conventions https://opentelemetry.io/docs/specs/semconv/messaging/ — telemetry concepts, verify maturity of specific conventions.
- ISO catalog: https://www.iso.org/standard/74393.html (42010:2022), https://www.iso.org/standard/78176.html (25010:2023), https://www.iso.org/standard/90219.html (12207:2026), https://www.iso.org/standard/27017 (27017:2026), https://www.iso.org/standard/27018 (27018:2025), https://www.iso.org/standard/27701 (27701:2025). Public metadata, not full licensed clauses or conformity evidence.
- Indonesian context: https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022 ; PP 71/2019; UU ITE as amended by UU 1/2024; Perpres 95/2018 where SPBE applies. Check current amendments, decisions and sector rules with responsible owner. No legal advice or certification claim.
