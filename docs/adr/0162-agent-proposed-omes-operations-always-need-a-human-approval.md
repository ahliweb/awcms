🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0162-agent-proposed-omes-operations-always-need-a-human-approval.id.md)

# ADR-0162 — Agent-proposed OMES operations always need a human approval

- **Status:** Proposed
- **Review:** needs the owner's decision on the questions in §Open questions. Docs only; nothing here is built until it is Accepted and split into issues.
- **Date:** 2026-11-14
- **Decision maker:** @ahliweb (proposed, not yet decided)
- **Related:** Issue [#1336](https://github.com/ahliweb/awcms/issues/1336); prerequisite [#1335](https://github.com/ahliweb/awcms/issues/1335); [ADR-0122](0122-omes-control-center-domain-module-admission.md) (`omes_control` admission and pinned contracts), [ADR-0031](0031-segregation-of-duties-conflict-enforcement.md) (SoD), [ADR-0049](0049-machine-credentials-and-session-introspection.md) and [ADR-0092](0092-machine-credentials-may-write.md) (machine credentials and their write ceiling), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md) (domain-event consumers), [ADR-0143](0143-reporting-quantity-metrics-tie-safe-pages-and-booking-projections.md) (reporting metrics), [ADR-0144](0144-workflow-decisions-append-only-and-terminal-instances-immutable.md) (immutable workflow decisions), [ADR-0145](0145-idempotency-keys-are-scoped-per-actor-and-the-request-hash-is-keyed.md) (idempotency); `ahliweb/omes` ADR-0029 (AI data boundary), ADR-0032 (multi-agent control boundary), `contracts/observability/v1/policy-decision.schema.json` (#274)

**Docs only.** No module, migration, API path, permission, contract or dependency changes in this ADR.

## Context

OMES runs a probabilistic agent runtime (Hermes Agent) next to a deterministic host-control plane. The next step being discussed is an agent that **proposes** a host remediation — for example "restart the gateway on server X" after reading `omes doctor` evidence — which a person then accepts or refuses. In OMES the rule is already written: model output is data, not authorization, and the typed `operation-request` is the only mutation boundary (OMES ADR-0032). This ADR decides where the human decision lives in AWCMS and what an agent proposal looks like here.

What exists today (verified on `main` @ `ff426cc`):

- `omes_control` records intent and never executes anything on a host. Operations are a closed list, `OMES_OPERATION_CODES` (`status`, `preflight`, `start`, `stop`, `restart`, `update`, `backup`, `rollback`), copied byte for byte from the OMES contract (`domain/operations.ts`).
- **Safe operations are auto-approved on submit** (`application/operation-submission.ts:152`, `approved_by` = the requester). Only `stop`, `rollback` and backup restore go through `workflow-approval` (workflow key `omes_control.destructive_operation`).
- `awcms_omes_operation_requests.requested_by` is always a human tenant user. There is **no proposer kind** and no column that could say "an agent asked for this".
- The self-approval guard (`identity-access/domain/access-control.ts`) knows a requester; it has no notion of a proposer distinct from the requester.
- Machine credentials can write only `create`/`update`, and never a high-risk action (`MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS` in `identity-access/domain/machine-credential.ts`, ADR-0092). `operate` and `rollback` are high-risk.
- The OMES `operation-request` contract allows `actor.type` `user|service` only. OMES `observability/v1/policy-decision.schema.json` (#274) already allows `agent` and carries `approval_ref`, but it is not vendored here, and the vendored pin (`src/modules/omes-control/contracts/v1/PIN.json`, `a4026e6`, 2026-10-02) is behind OMES `main`.
- **A human verdict on an `omes_control` workflow does not reach the request row today** (#1335). Anything in this ADR depends on that fix.
- There is no AI module, no AI tool-call audit table and no RAG or evaluation code in this repository.

Threats this decision answers: indirect and direct prompt injection (MITRE ATT&CK v20 T1698/T1699), poisoned retrieval results (T1608.007), and excessive agency (OWASP Top 10 for LLM Applications 2025, LLM06). An agent that can turn its own output into an executed operation turns each of those into host impact.

## Decision

**D1 — An agent proposal is an operation request, not a new module.** It is a row in `awcms_omes_operation_requests` with a proposer of kind `agent`. No second table, no `ai_agent_actions` module, no second queue. The worker poll, job, lease, result and audit paths stay the ones that exist.

**D2 — The proposer is recorded separately from the accountable requester.** Two new columns: `proposed_by_kind` (`human` | `agent`, default `human`) and `proposed_by_ref` (an opaque identifier of the agent and session, e.g. a machine-credential id plus an agent session id; never a prompt, transcript or model output). `requested_by` keeps meaning "the accountable human principal": for an agent proposal it is the human who owns the machine credential the agent used (see §Open questions Q1).

**D3 — Every agent proposal goes through a workflow. Nothing is auto-approved.** A new workflow key, `omes_control.agent_proposed_operation`, is started for every agent proposal, **including** `status` and `preflight`. If no definition is active the submission is refused with `409 APPROVAL_WORKFLOW_NOT_CONFIGURED`, as destructive operations are today. The verdict reaches the row through the settlement consumer from #1335; promotion to a job stays in `worker-job-queue`.

**D4 — Segregation of duties covers the proposer.** The accountable requester of an agent proposal, and any person recorded as having driven that agent session, may not approve it. This is added to the SoD registry (ADR-0031) as a rule on the new workflow key, so the existing guard enforces it rather than a new check in `omes_control`.

**D5 — A new, non-high-risk action `propose`, reachable by machine credentials.** Permission `omes_control.deployments.propose`. `propose` creates a pending request and nothing else; it can never approve, dispatch or cancel. ADR-0092's ceiling is extended to `create`, `update`, `propose` (a code change to `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS`, reviewed as an auth change). `operate`, `rollback` and `approve` stay out of reach of machine credentials.

**D6 — The proposal carries no free text.** The body is the existing closed shape (`serverId`, `operation`, optional `deploymentId`, schema-validated `parameters`) plus a closed `reasonCode` and up to a bounded number of `evidenceRefs` (ids of health snapshots, jobs or OMES evidence records that exist in this tenant). No model prose is stored, rendered or forwarded. The approver's screen shows the referenced evidence from AWCMS's own records, not the agent's explanation.

**D7 — Contract and pin.** The dispatched job keeps `actor.type: "service"` toward OMES (AWCMS is the service that decided), and gains an `approval_ref` to the workflow instance plus the proposer kind, aligned with OMES `policy-decision` (#274). This needs an OMES contract change and a re-pin (`bun run contracts:omes:sync`) before implementation; the OMES job runner keeps re-deriving its own allowlist and approval decision.

**D8 — Audit.** Proposal, verdict, settlement and dispatch are audited with the same correlation id, the proposer kind and reference, and no raw prompt, transcript or model output (the existing `findDisallowedEvidenceKeys` rule applies).

**D9 — Evaluation metrics are a separate, later decision.** RAG and agent evaluation results (retrieval quality, faithfulness, latency percentiles, tool-call counts, injection success rate, unapproved actions) are not decided here. `reporting` cannot express ratios or percentiles today (ADR-0143). The expected direction is a read-only `omes_control` view fed by a worker-pushed, aggregate-only contract, following the AI privacy posture view; it gets its own ADR when an evaluation pipeline exists.

## Options considered

| Criterion       | **Operation request with a proposer + mandatory workflow (chosen)**               | New `ai_agent_actions` module                                       | Auto-approve safe operations for agents too                 | Agent calls OMES directly, AWCMS only observes          |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Security        | One mutation boundary; every agent action needs a person; SoD covers the proposer | Second path to the same jobs, two places to get authorization right | Injection reaches `start`/`restart`/`update` with no person | No tenant authorization, no approval, no audit in AWCMS |
| Performance     | One extra workflow instance per proposal                                          | Same plus a second queue                                            | Fastest                                                     | Fastest                                                 |
| Maintainability | Reuses submission, workflow, settlement, worker and audit code                    | Duplicates them                                                     | Small change, large policy debt                             | Splits authority across repos                           |
| Scalability     | Bounded by the existing job queue                                                 | Same                                                                | Same                                                        | Unbounded agent writes                                  |
| UI/UX           | Approvals appear in the existing `/admin/approvals` inbox                         | A new inbox                                                         | No inbox                                                    | None                                                    |
| Compatibility   | Needs an OMES contract change (D7)                                                | Same                                                                | Same                                                        | Breaks OMES ADR-0032 rule 6                             |
| Long term       | Same model for any future agent, not only Hermes                                  | One module per agent kind                                           | Hard to tighten later                                       | Not reversible without a migration of trust             |

## Consequences

- **Positive:** an agent can never turn its own output into an executed operation; every agent action has a named accountable person and a different named approver; the approval inbox, audit trail and worker path stay single.
- **Negative / trade-off:** even harmless read operations proposed by an agent wait for a person, so agent-driven diagnosis is slower; one extra workflow definition per tenant must be published before agents can propose anything; D5 widens the machine-credential ceiling by one non-high-risk action, which needs an auth review.
- **Neutral:** human-submitted requests are unchanged (`proposed_by_kind` defaults to `human`); the OMES side must accept the contract change before AWCMS can ship D7.

## Implementation outline (after acceptance)

1. #1335 merged (settlement consumer).
2. OMES: extend `operation-request` with `approval_ref` and proposer kind; release; re-pin here.
3. Migration: `proposed_by_kind`, `proposed_by_ref` with a CHECK constraint; permission `omes_control.deployments.propose`; workflow key registration.
4. Submission path for agent proposals (D3, D6), SoD rule (D4), machine-credential ceiling (D5), audit (D8).
5. Approval screen shows the proposer kind and the referenced evidence.
6. Tests: an agent proposal is never `approved` without a human decision; the accountable owner cannot approve; free-text fields are refused; a machine credential cannot `operate`.

## Open questions for the owner

- **Q1.** Who is the accountable requester of an agent proposal: the human who owns the machine credential, or a role (for example "OMES agent owner") assigned per tenant?
- **Q2.** Should an agent be allowed to propose `rollback` and backup restore at all, or only lifecycle operations (`status`, `preflight`, `start`, `restart`, `update`, `backup`, `stop`)?
- **Q3.** Is a single approver enough for agent proposals, or should destructive agent proposals need two (`quorum`)?
- **Q4.** Should an unanswered agent proposal expire (for example after 24 hours) rather than wait indefinitely?
