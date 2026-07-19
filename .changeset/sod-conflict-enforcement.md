---
"awcms": minor
---

Add segregation-of-duties (SoD) conflict detection and enforcement for ERP (Issue #181, epic #177 Wave 2 authorization), ported from awcms-mini (#746) on top of the #180 business-scope hierarchy.

- **Contract:** additive `SoDRuleDescriptor` family + `ModuleDescriptor.sodRules` (`MODULE_CONTRACT_VERSION` 1.2.0 → 1.3.0). The base ships NO domain SoD rules; a derived application contributes them through the composition seam (the in-repo fixture carries ≥5 illustrative examples).
- **Registry gate:** `bun run identity-access:sod-registry:check` validates the composed registry (owner match, unique ruleKey, ≥2 keys, valid enums, exception-policy consistency), wired into `bun run check` and CI — SoD registry drift makes CI red.
- **Domain/application:** a pure conflict matcher (`sod-conflict-evaluation.ts`), assignment-time evaluation re-inserted at the #180 seam, action-time fail-closed enforcement wired into `authorizeInTransaction` for high-risk actions (deny-overrides-allow), an append-only decision log, and a scope-bound/time-bound/revocable/audited exception (override) flow that can never be self-approved.
- **Schema:** `sql/029` (`awcms_sod_conflict_exceptions` + `awcms_sod_conflict_evaluations`, tenant-scoped RLS `ENABLE`+`FORCE`, composite `(tenant_id, …)` FKs) + `sql/030` permission seed. The scheduled expiry job now also expires elapsed approved exceptions.
- **API:** six new endpoints under `/api/v1/identity/business-scope/` — `GET conflicts`, `GET`/`POST exceptions`, and `POST exceptions/{id}/approve|reject|revoke` (OpenAPI fragment + regenerated bundle/docs).
