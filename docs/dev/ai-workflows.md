> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# AI Workflow Standards

## Purpose

Standardize how AI agents should approach work in the AWCMS repo: prompt shape, planning triggers, iteration loops, safety gates, and current doc/spec/validation expectations.

This document complements the prompt guide and planning workflow. It is about execution discipline, not just prompt wording.

## Current Workflow Model

Current AWCMS AI work should be:

- context-first
- atomic when possible
- validation-backed
- explicit about trust boundaries
- aligned with docs/spec artifacts when documented surfaces change

## Current Prompt Shape

Substantial AI-assisted changes should still identify:

```text
Role: [operator stance if helpful]
Context: [relevant files, docs, runtime boundaries]
Task: [specific measurable objective]
Constraints: [non-negotiable rules]
Validation: [commands or proof expectations]
Output: [expected code/docs/spec/result]
```

For current detailed prompting guidance, use [docs/dev/prompt-guide.md](./prompt-guide.md).

## Current Atomicity Rules

- prefer one coherent objective per prompt when feasible
- prefer small reviewable diffs over broad rewrites
- if a documented route/contract changes, include the related doc/spec updates in the same change set
- if a schema/permission surface changes, include parity/docs implications in the same change set

## Current Planning Triggers

Plan first before coding for high-risk categories such as:

| Category | Examples |
| --- | --- |
| migrations | `supabase/migrations/*.sql`, parity updates |
| RLS / ABAC | policy creation/modification, helper changes, permission families |
| auth | auth contexts, session flows, tenant resolution auth boundaries |
| storage/media | public media contract, signed access, upload/finalize paths |
| sanitization | import/render sanitization, raw HTML paths |
| cross-tenant/platform | onboarding, tenant override, shared-resource changes |
| documented route contracts | public/admin Worker route behavior and OpenAPI surfaces |

## Current Iteration Loop

```text
1. Read the relevant code and docs first
2. Make the smallest coherent change
3. Run the relevant validation commands
4. If validation fails, fix and re-run
5. If the contract/docs changed, align docs/spec artifacts
6. Stop only when the task is complete or a real blocker requires user input
```

## Current Stop-And-Ask Triggers

Stop and ask the user when:

- requirements conflict with the authority docs
- a task would require destructive/revert behavior affecting user changes
- there is a real conflict with unexpected concurrent edits
- the correct path depends on a product decision rather than an implementation choice

## Current Process Monitoring Rules

- do not leave long-running dev processes unattended unnecessarily
- watch for stuck commands and terminate/retry when appropriate
- prefer explicit validation commands over vague “it should work” claims

## Current Workflow Families

Use the repo workflow docs where appropriate:

- `migration-workflow.md`
- `rls-change-workflow.md`
- `ui-change-workflow.md`
- `ci-validation-workflow.md`

Use related maintained docs alongside them:

- [docs/dev/prompt-guide.md](./prompt-guide.md)
- [docs/dev/ai-planning-workflow.md](./ai-planning-workflow.md)
- [docs/dev/review-checklist.md](./review-checklist.md)
- [docs/dev/openapi-quality-checklist.md](./openapi-quality-checklist.md)

## Current Composition / Operator Tooling Notes

For blueprint/reusable-section composition work, prefer the current operator/MCP tooling and documented Worker-backed paths instead of inventing direct ad hoc SQL flows.

Current composition-oriented operator surfaces include the AWCMS MCP tools for:

- listing site blueprints
- inspecting tenant blueprint state
- listing reusable sections
- applying site blueprints
- materializing reusable sections

## Current Rule Families

Guardrail-oriented rules currently include playbooks for:

- tenancy enforcement
- RLS coverage
- ABAC naming/enforcement
- migration safety
- secret prevention
- sanitization/render safety
- release readiness

Use them when the task touches their boundary, not only after a problem appears.

## Current Validation Expectations

AI work should name or run the relevant validation commands instead of ending at code edits.

Typical current commands:

- `cd awcms && npm run build`
- `cd awcms && npm run docs:check`
- `cd awcms-public/primary && npm run check:astro`
- `cd awcms-edge && npm test && npm run typecheck`
- `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff`
- `scripts/verify_supabase_migration_consistency.sh`

## Current Review Alignment

When a workflow ends in a review or a reviewable change set, it should already satisfy the expectations in [docs/dev/review-checklist.md](./review-checklist.md):

- trust boundaries preserved
- docs updated with behavior where required
- negative-path coverage present where relevant
- shared contracts reviewed across affected surfaces

## Related Docs

- [docs/dev/prompt-guide.md](./prompt-guide.md)
- [docs/dev/ai-planning-workflow.md](./ai-planning-workflow.md)
- [docs/dev/review-checklist.md](./review-checklist.md)
- [docs/dev/openapi-quality-checklist.md](./openapi-quality-checklist.md)
- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
- [AGENTS.md](../../AGENTS.md)
