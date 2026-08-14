---
name: awcms-pr-review
description: Review an AWCMS pull request against the Definition of Done and the project contracts. Use when asked to review an AWCMS PR/diff. Checks atomic scope, migration/OpenAPI/AsyncAPI in sync, tenant/ABAC/RLS, idempotency, audit, masking, tests, and docs per doc 09, 10, 12.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — PR Review

Follow `docs/awcms/12_generator_prompt.md` (PR Review Prompt), `docs/awcms/09_roadmap_repository_commit.md` (PR checklist), and `docs/awcms/10_template_kode_coding_standard.md`.

## Review focus

1. Scope matches the issue; **no unrelated change**.
2. No secrets / real customer data / DB dumps / `.env`.
3. Schema changed → there is a sequentially numbered migration (`awcms-new-migration`).
4. API changed → OpenAPI updated (`awcms-new-endpoint`).
5. Event changed → AsyncAPI updated (`awcms-new-event`).
6. Tenant context + ABAC + RLS for tenant-scoped data.
7. Idempotency for high-risk mutations.
8. Audit for high-risk actions + redaction.
9. Soft delete policy for deletable resources; posted/append-only entities are not deleted.
10. Complete input validation; standard error responses.
11. Sensitive data masked.
12. Relevant tests exist & pass; build passes.
13. Docs updated; commits follow the convention `<type>(<scope>): <summary>`.
14. **Does the diff touch `.astro`? Read the types with your EYES.** `bun run typecheck`
    (`tsc --noEmit`) **cannot parse `.astro`** and skips it silently,
    so a green CI says nothing about those 22,328 lines. What must
    be checked manually: `withTenantOrThrow` (not `withTenant` — the second form
    returns `T | Response` and will render a `Response` as data),
    the shape returned by the application functions the page uses, and
    `null` versus an absent key when one read function is shared by a page AND an endpoint.
15. **Adding/changing a surface consumed by `awcms-astro`?** `bun run api:consumer-contract:check`
    must be green, and **regenerating the contract is not a routine step** — it means
    "the consumer has to change too", so the PR must state what has to be
    done in the neighbouring repo. The list is **already split** (ADR-0068) in
    `scripts/api-consumer-contract.ts`: `CONSUMED_PATHS` is derived from the marked block
    in the `awcms-astro` repo (actually called), `COMMITTED_PATHS`
    must name its ADR.
16. **Changes that touch the security or performance posture** (headers, cookies,
    rate limits, cache, indexes, query budgets) must update
    [`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md).
    A line in there without a checker is a claim, not a control.

## Contract consistency

- Migration ↔ ERD (doc 04) ↔ migration matrix (doc 13).
- Endpoint ↔ OpenAPI ↔ error/header table (doc 05).
- Event ↔ AsyncAPI ↔ `module.ts` publishes/subscribes.
- Soft delete ↔ ERD column/index ↔ OpenAPI DELETE/restore/includeDeleted ↔ audit event.

## Output

```text
Verdict: Approve / Request changes / Comment only
Critical issues:
Security issues:
Functional issues:
Data/migration issues:
API/event contract issues:
Testing gaps:
Documentation gaps:
Suggested patch:
```

For sensitive modules, also run `awcms-security-review`.
