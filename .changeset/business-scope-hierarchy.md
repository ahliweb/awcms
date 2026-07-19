---
"awcms": minor
---

Business-scope hierarchy generic authorization layer (Issue #180, epic #177
Wave 2). Ports the generic business-scope FOUNDATION from awcms-mini (SoD
enforcement #181 and the organization-structure domain module are deliberately
excluded, with clean seams).

- **Schema** (`sql/027` + seed `sql/028`) — two tenant-scoped, RLS
  `ENABLE`+`FORCE` tables: `awcms_business_scope_assignments` (subject→scope
  grant with effective dating, temporary expiry, revocation) and its
  append-only `awcms_business_scope_assignment_events` lifecycle history.
  Subject/role/actor FKs are COMPOSITE `(tenant_id, …)` (with new
  `UNIQUE (tenant_id, id)` on `awcms_tenant_users`/`awcms_roles`) so a
  cross-tenant subject/role cannot be referenced even though PostgreSQL RI
  checks bypass RLS (GHSA-r7cx-c4jh-cvvw / sql/020).
- **Capability port** — `BusinessScopeHierarchyPort` (`_shared/ports/`, ADR-0011):
  `scope_type`/`scope_id` are GENERIC references; validity/ancestry come from a
  resolver a DERIVED app provides. The base ships a default NO-OP resolver
  (`resolved: false` for every scope type), so a pure-base deployment fails
  closed (assignment create denies `scope_unresolved`; scope-gated high-risk
  actions deny). `identity_access` declares `capabilities.consumes`
  (`business_scope_hierarchy`, optional); the in-repo fixture derived module
  provides a working dummy resolver.
- **`evaluateAccess` integration** — new optional `businessScopeFacts` parameter
  (fully backward-compatible) with exact/descendant/ancestor/tenant-wide
  coverage. Unknown/unresolved/stale scope → default-DENY for high-risk actions
  (`resolved: false` is never treated as "no restriction"). Revocation/expiry
  takes effect immediately at the next decision (effective dating is the
  authoritative gate, not `status`).
- **API** — `GET`/`POST /api/v1/identity/business-scope/assignments` and
  `POST …/{id}/revoke` (create/revoke high-risk, `Idempotency-Key` required,
  self-grant denied, audited). New permissions
  `identity_access.business_scope_assignments.{read,create,revoke}`.
- **Job** — `identity-access:business-scope:expiry` transitions elapsed
  assignments to `expired` (append-only events + aggregate audit per tenant).
- Docs: ADR-0030, ERD/data-dictionary, threat model (privilege expansion,
  stale cache, hierarchy cycle, scope spoofing), identity-access README, and
  derived-application guide (how a derived app provides the hierarchy resolver).
