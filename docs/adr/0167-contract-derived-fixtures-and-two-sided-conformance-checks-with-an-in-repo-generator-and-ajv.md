🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0167-contract-derived-fixtures-and-two-sided-conformance-checks-with-an-in-repo-generator-and-ajv.id.md)

# ADR-0167 — Contract-derived fixtures and two-sided conformance checks, with an in-repo generator and `ajv`

- **Status:** Accepted
- **Date:** 2026-11-20
- **Decision maker:** ahliweb (owner; chosen from a set of options on 2026-11-20)
- **Related:** Issue #1386 (this ADR), #1379 (research), #1377 (audit), #1385 (429 and idempotency in the contract); ADR-0156 (development flow v2); ADR-0166 (WCAG 2.2 AA on public pages); `docs/awcms/research-openapi-mock-and-two-way-contract-tests-2026-11-20.md`; `docs/awcms/audit-alur-v2-adr-0156-2026-11-20.md`; `docs/awcms/alur-pengembangan.md` steps 8 and 11.1

## Context

Step 8 of the development flow requires a mock **generated from the contract**, and step 11.1 builds the frontend against it. Research #1379 (revalidated against the repository on 2026-11-20) found why neither can be done today:

- Only **1 of 742** operations carries a response example, there is no `204` anywhere, and an operation's permission is not recorded in the contract (R1).
- The contract has defects a typed client or a validator exposes: `BookingPolicy.policy` declares no properties (R2), and `nullable: true` is used 869 times in a document that declares `openapi: 3.1.0`, where it is no longer a keyword; 19 locations carry it without a `type` (R3).
- A schema is only as strong as its `required` list: 267 of 460 component object schemas declare none, so a renamed property on `Office` was not caught (R4).
- Spec and handler drift exists and the gate does not see it: `api:spec:check` compares only the set of path templates (R5). Provider-side response tests exist for a handful of endpoints, hand-rolled (R6).
- Each consumer carries a hand-written second specification of the API (R7). A generator is feasible on the existing `yaml` dependency (R9).

The research evaluated types-only generation, a mock server (Prism), replay tools, Mock Service Worker, an in-repo generator without a new dependency (C), the same generator plus `ajv` (C′) and consumer-driven pacts. The numbers and trials are in the report and are single runs on one machine; they are evidence for this choice, not a conformance claim.

## Decision

**Option C′: an in-repo, Bun-native contract-conformance kit, with `ajv` as its single new dev dependency, and no mock server.** The owner chose it on 2026-11-20 together with the contract policy below.

1. **A generator inside the repo.** A Bun script on the existing `yaml` dependency reads the bundled contract and generates examples and a fixtures pack. The contract stays the single source; nothing restates it by hand.
2. **`ajv` is the only new dependency, dev-only.** It validates schemas (a contract lint that compiles every schema), real provider responses and consumer fixtures. The exact version is pinned and enters through the dependency governance rules like any other.
3. **A contract diff beside instance validation.** It classifies a change as breaking or additive, because instance validation cannot catch what the contract does not `require` (R4). The existing `api:consumer-contract` mechanism is the precedent.
4. **No mock server.** The fixtures pack is data, not a service. Consumers pin it and never import this repository's code.
5. **Contract policy for NEW operations** (an operation added after this ADR is accepted):
   - a response **example is required**;
   - a **`required` list is required** on object schemas it declares;
   - null is written as **`type: [X, "null"]`** (OpenAPI 3.1 style), not `nullable`;
   - **`429` is required** when the endpoint is rate-limited (Issue #1385 applies it to the existing storefront operations and is not duplicated here).
6. **Existing operations are fixed gradually, with no mass retrofit.** A file touched for another reason is brought to the policy; the 869 `nullable` uses are not rewritten in one change. The two known defects (R2 and the 19 `nullable`-without-`type` locations) are fixed first because the lint cannot be green without them.
7. **The fixtures pack is published as a pinned artifact for consumers.** Consumers (the other repositories of the family and any implementing project) follow this ADR: they replace their hand-written fakes with the pack or validate their fakes against it, pinned by SHA or tag.

### What this ADR does not decide

- Typed clients (`openapi-typescript` and similar) are a separate, later decision (consumer compile-time safety, one dev dependency per consumer).
- Whether every operation must declare `5xx` is not decided; only `429` for rate-limited endpoints is.
- No implementation is approved here. Each slice goes through step 8 and gate 9 in its own issue.

## Consequences

- **Positive:** the contract stays the single source; defects surface the day the lint lands (46 of 734 success schemas fail to compile today, per the trial); drift in status and shape becomes a red test instead of a surprise; consumers stop maintaining a second specification; the generator runs on what the repository already runs (Bun).
- **Contract defects must be fixed with the gate.** A lint that is red on today's contract cannot land alone; the contract-hygiene issue lands first.
- **Examples and `required` become contract-quality rules** for new operations, enforced by a check that looks at new operations only, so old operations do not turn CI red.
- **One more dev dependency to govern** (`ajv`: MIT, four direct dependencies in the trial; versions and size as read on 2026-11-20 in the report). It enters the lockfile and is covered by supply-chain governance.
- **A mock is not evidence of runtime security.** It shows that a client copes with a `403`, not that the server returns one. Permission, RBAC and ABAC, FORCE RLS and anti-enumeration timing remain tested against the real system. Fixtures are synthetic only (reserved domains such as `example.test`, no real data).
- **Negative / trade-off:** the repository owns a small generator and its upkeep (the report estimates low to medium). Conditional shapes (`oneOf`, for example `view=full` on the blog list) and cyclic schemas need rules or explicit reports; operations the generator cannot handle must be reported with a reason, never skipped silently.
- **Negative / trade-off:** instance validation is still only as strong as `required`; the diff and the new-operation policy narrow that gap, and old operations stay weak until touched.

## Alternatives considered

- **C, the same generator with no new dependency.** Kept as the fallback. Rejected as the choice because it means writing and maintaining a validator subset, and the repository's hand-rolled response validator already shows how that goes (it ignores `required` and extra properties).
- **Types only (`openapi-typescript`).** Valuable and it works under Bun, but it gives no mock and no examples; a separate, later decision.
- **Prism (mock server).** Rejected: it needs Node 24 (the repository is Bun-only), would be starved by the lack of examples, and adds a service.
- **Dredd or Schemathesis (replay or fuzz against a live server).** Rejected for now: one has had no release since 2021, the other is outside the Bun toolchain, and both need a running backend that CI does not provide beyond Postgres.
- **Mock Service Worker.** Rejected for now: one trial under Bun 1.4.4 did not intercept requests. Single trial; revisitable.
- **Pact (consumer-driven contracts).** Rejected: a second source of truth, which the flow says to avoid.
- **Doing nothing.** Rejected: step 8 and step 11.1 cannot be carried out, and three consumers keep their own copies of the API.

## Gate note

This ADR records the owner's decision only. It does not state that gate 9 passed for any implementation, and it adds no code, dependency, route, database object or contract change. Every follow-up is a backlog issue that waits for gate 9 and its Definition of Ready.

## Follow-ups

Backlog issues, not yet implemented, all waiting for gate 9 and the Definition of Ready (epic #1396):

- Contract hygiene: `BookingPolicy.policy` and `nullable` without `type` (#1389).
- Contract lint gate with `ajv` (#1390).
- Response examples for the three representative operations (#1391).
- Generator and fixtures pack with a freshness gate (#1392).
- Provider response-conformance tests (#1393).
- Publish the fixtures pack as a pinned artifact (#1394).
- Contract-policy check for new operations (#1395).
- Declared `429` and optional idempotency header for storefront operations (#1385, existing).
- Consumer repositories adopt the pack in their own issues, following this ADR.
