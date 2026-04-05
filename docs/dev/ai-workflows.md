> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) → [AGENTS.md](../../AGENTS.md)

# AI Workflow Standards

## Purpose

Standardize how AI agents interact with the AWCMS codebase: prompt structure, iteration loops, and safety gates.

## 1. Prompt Template

All significant AI-assisted changes should follow this structure:

```text
Role: [Your role, e.g., "Senior AWCMS engineer"]
Context: [Relevant files, docs, constraints]
Task: [Specific, measurable objective]
Constraints: [Non-negotiable rules from SYSTEM_MODEL.md]
Output: [Expected deliverables]
```

## 2. Atomic Prompting

- **One objective per prompt** — don't combine migration + UI + docs
- **Small diffs** — prefer multiple small, reviewable changes over monolithic PRs
- **Verify between steps** — build/lint/test after each change before proceeding

## 3. Plan Mode Triggers

**Plan mode required** (explain approach before coding) for:

| Category | Examples |
|----------|----------|
| Migrations | Any `supabase/migrations/*.sql` change |
| RLS/ABAC | Policy creation, modification, or permission changes |
| Auth | Auth context, login flows, session handling |
| Storage | Bucket policies, upload handlers |
| Sanitization | Import pipelines, render sanitizers |
| Cross-tenant | Any operation that touches multiple tenants |

## 4. Self-Correction Loop

```text
1. Make change
2. Run build/lint/test
3. If errors → fix → go to 2
4. If clean → verify manually → commit
5. If stuck after 3 iterations → stop, document issue, ask for help
```

## 5. Process Monitoring

- Monitor all background processes during dev sessions
- Enforce maximum runtime (kill stuck processes after 5 minutes)
- Never leave `supabase start` or `npm run dev` running unattended
- Check for port conflicts before starting services

## 6. Available Workflows

See `.agents/workflows/` for step-by-step procedures:

- `migration-workflow.md` — Safe database migration steps
- `rls-change-workflow.md` — RLS/ABAC policy changes
- `ui-change-workflow.md` — UI component changes
- `ci-validation-workflow.md` — Build/lint/test gate

## 6.1 Operator Surfaces for Composition Features

For the new template composition primitives, prefer operator tooling over direct ad hoc SQL when investigating state:

- Site blueprints: use the local MCP tools for blueprint inventory and tenant applied-state inspection
- Reusable sections: use the local MCP tools for section inventory before changing tenant runtime records manually

Current local MCP composition tools:

- `awcms_list_site_blueprints`
- `awcms_get_tenant_blueprint_state`
- `awcms_list_reusable_sections`
- `awcms_apply_site_blueprint`
- `awcms_materialize_reusable_section`

These tools are read-only and are intended to support AI/operator diagnostics and planning around the Phase 2 and Phase 3 composition flows.

For write-capable composition actions, use the Worker-backed MCP tools rather than direct SQL:

- `awcms_apply_site_blueprint`
- `awcms_materialize_reusable_section`

These require `AWCMS_OPERATOR_BEARER_TOKEN` plus a configured edge base URL.

For extension sandbox planning, rely on manifest diagnostics and documented metadata rather than inventing new execution paths. Phase 5 currently supports metadata-only sandbox profiling, not live sandbox execution.

## 7. Available Rules

See `.agents/rules/` for guardrail playbooks:

- `tenancy-guard.md` — Tenant isolation enforcement
- `rls-policy-auditor.md` — RLS coverage audit
- `abac-enforcer.md` — Permission naming and enforcement
- `migration-guardian.md` — Migration safety
- `no-secrets-ever.md` — Secret prevention
- `sanitize-and-render.md` — Content sanitization
- `release-readiness.md` — Pre-release checklist

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) — Authoritative constraints
- [AGENTS.md](../../AGENTS.md) — Coding standards and patterns
