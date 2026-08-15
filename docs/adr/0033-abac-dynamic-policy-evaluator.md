🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0033-abac-dynamic-policy-evaluator.id.md)

# ADR-0033 — Dynamic ABAC policy evaluator (DSL, precedence, cache)

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision-maker:** maintainer
- **Related:** Issue #179, epic #177 (derived ERP foundation readiness, Wave 2 authorization); ADR-0030 (business-scope hierarchy #180) & ADR-0031 (SoD #181) — guards that keep running on this ABAC side; ADR-0026 (modular OpenAPI #182); `src/modules/identity-access/domain/abac-policy.ts`, `abac-evaluator.ts`; `docs/awcms/20_threat_model_security_architecture.md`; ported from awcms-mini Issue #179 (ADR-0023, adapted not copied).

## Context

AWCMS mandates default-deny RBAC + ABAC, but until Issue #179 `evaluateAccess()` had never **consumed** the stored `awcms_abac_policies` rows — authorization relied only on role permissions and the built-in guards (tenant isolation, self-approval, force-decision, business-scope #180, SoD #181). AWCMS already had a flat `awcms_abac_policies` CRUD (Issue #171: `effect`/`is_active`/`description` at `/api/v1/abac/policies`) that the evaluator had never read. For ERP, policies need to evaluate subject, resource, action, environment, ownership, transaction status, organizational unit, and value limit attributes consistently at one chokepoint — without opening the door to dangerous arbitrary expressions (`eval`, templated SQL).

## Decision

### 1. Condition DSL: a constrained, deterministic, versioned jsonb AST

Policy conditions are stored as a jsonb AST (`conditions`) with a `dsl_version` (starting at 1), plus nullable applicability columns (`module_key`/`activity_code`/`action`/`resource_type` = wildcard when null) and `priority` — added by `sql/031` as an additive ALTER over the `awcms_abac_policies` table (sql/005). A **node** is one of:

- `{ "allOf": [node, ...] }` — all true (empty = vacuously true)
- `{ "anyOf": [node, ...] }` — at least one true (empty = vacuously false)
- `{ "not": node }`
- **Leaf:** `{ "attr": "<ns.attr>", "op": "<op>", "value": <literal> }` **or** `{ "attr": "<ns.attr>", "op": "<op>", "valueAttr": "<ns.attr>" }` (attr-to-attr for ownership checks, e.g. `resource.ownerTenantUserId eq subject.tenantUserId`)

**Attribute allow-list** (resolved SERVER-SIDE — a fixed list, anything outside it is invalid/deny):

- `subject.*` (`tenantUserId`, `identityId`, `roles`, `defaultOfficeId`) — from the authenticated `TenantContext`, **never** from the request body. `defaultOfficeId` is optional and not resolved by the base (always absent until a deployment wires it in).
- `resource.*` (`tenantId`, `ownerTenantUserId`, `businessScopeId`, `status`, `resourceType`, `amount`) — from `request.resourceAttributes`, which the endpoint **must** populate from an already verified/persisted resource (ownership is checked against a real row, not a client claim).
- `action` — the request's action.
- `env.*` (`now`, `dayOfWeek`, `ipTrusted`) — **only** server-derived; `ipTrusted` defaults to `false` (fail-closed) until a deployment installs a trusted-network resolver.

**Operators:** `eq`, `ne`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`, `exists`. `lt/lte/gt/gte` only for numeric/date attributes. No regex, functions, or arbitrary expressions. Values are literals only (string/number/boolean/ISO-date, or an array for `in/nin`). The evaluator is a **pure interpreter** over the AST — no `eval`, `new Function`, dynamic import, or templated SQL.

The parser/validator (`abac-policy.ts`) is fail-closed: an unknown attribute, unknown operator, wrong value type, wrong operand arity, a DSL version newer than supported, or any structural defect → the policy is **invalid** at authoring time (rejected by the CRUD endpoints) so it can never be activated.

Allow-list membership is tested **own-property only** (`Object.prototype.hasOwnProperty.call`, via `lookupAbacAttribute`/`isKnownAbacAttribute`), not `ABAC_ATTRIBUTES[attr]`/`attr in …` which walk the prototype chain. Without this, prototype keys (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, …) would resolve inherited members and **pass** the unknown-attribute check — a fail-OPEN hole: a `deny` with a prototype attribute would be silently skipped, or a `not(exists)` over it would become an always-satisfied allow. The own-property gate applies on both sides: the authoring validator **and** the eval-time backstop (`abac-evaluator.ts` `lookup()`, which also gates the bag produced by `buildAttributeBag` with `hasOwnProperty`), so even hand-crafted stored conditions still fail closed (throw → DENY). Tested: +17 prototype-key tests (validator + eval-time), mutation-proven red without the gate.

### 2. Precedence: fail-closed, deny-overrides, allow-as-constraint, RBAC still mandatory

After all the built-in guards (tenant isolation, self-approval, force-decision, business-scope #180) that still run first and are not weakened, over the set of **active** policies whose **applicability** matches (`module_key`/`activity_code`/`action`/`resource_type`, each nullable = wildcard), inside `evaluateAccess` (pure):

1. **An explicit DENY wins.** If any applicable `deny` policy has its conditions satisfied → **DENY** (beating an RBAC allow and allow policies). An active policy that is **invalid** (fails to compile / `dsl_version` too new) or **any evaluation error** (unknown attribute/operator) → **DENY** (fail-closed). This part is evaluated **before** the RBAC check.
2. **RBAC permission is still mandatory.** If the subject does not hold the `module.activity.action` permission → **DENY** (`default_deny`). An `allow` policy **never** creates a permission the subject does not have.
3. **`allow` policies act as a CONSTRAINT.** If there are applicable `allow` policies, at least one of their conditions must be satisfied, otherwise → **DENY** (`abac_allow_unsatisfied`). If there is no applicable policy at all → ABAC is a no-op and RBAC decides.

`evaluateAccess` gains an **optional 5th param** `abac?: { policies, env }` (`businessScopeFacts` stays the 4th param). If absent/empty → ABAC is a no-op; **every old call site with ≤4 arguments is unaffected** (backward-compatible). This model means an `allow` policy can only **narrow** access already granted by RBAC, never widen it — satisfying the acceptance criterion "a policy cannot create a permission the subject does not have". An attribute that is **valid-but-absent** makes its leaf deterministically `false` — that is **not** an error and not a fail-closed deny; fail-closed applies only to unknown attributes/operators and evaluation errors.

High-risk SoD enforcement (#181) stays at the application chokepoint (`authorizeInTransaction`), additive **after** this decision (deny-overrides). RLS remains mandatory as a defence layer; ABAC does not replace it.

### 3. Two authoring surfaces, one table — but the evaluator consumes only DSL policies

- **The DSL surface (`/api/v1/access/policies*`, #179)** — full CRUD over AST/applicability/priority + simulation, guarded by `identity_access.abac_policies.{read,configure,analyze}` (seeded by `sql/032`). This is the complete surface and the **only** one producing policies that the evaluator **consumes**.
- **The flat surface (`/api/v1/abac/policies*`, #171)** — only `effect`/`description`/`is_active`, guarded by `identity_access.access_control.{read,configure}`. Kept for back-compat with the #171 admin UI. It **cannot** scope (applicability) or condition a policy.

**The `is_dsl_managed` discriminator (column from `sql/031`, default `false`) — that is the separator.** Flat #171 rows stay `is_dsl_managed = false` and are **never read by the evaluator**; **only** the DSL surface sets `is_dsl_managed = true` (on INSERT and on UPDATE — authoring through the DSL promotes a row to DSL-managed). The evaluator cache (`policy-cache.ts`) filters `is_active AND is_dsl_managed`, and so does the hot-path partial index (`WHERE is_active AND is_dsl_managed`). Because flat rows cannot be scoped/conditioned, the **only** shape they can produce is wildcard + vacuously-true; letting them be consumed means a flat `deny` **denies EVERY request** in the tenant — bricking the whole tenant, including the operator's own `access_control.configure` and the DSL disable endpoint (the same chokepoint), with no in-band recovery (DBA only). The discriminator closes this **structurally**: flat rows are inert (exactly the pre-#179 behaviour), and migration `sql/031` is **deploy-safe** — a previously inert flat `deny` row is **not** activated when the DSL columns are added (the backfill is a no-op because those rows are not consumed). A flat `allow` is no longer dangerous either: previously an always-satisfied wildcard allow silently beat every DSL allow-constraint; now it is never evaluated.

**Part B (defence-in-depth in the DSL validator).** `validateAbacPolicyInput` rejects a policy that is **simultaneously** `effect: "deny"` + **unscoped** (all four applicability columns null/absent) + **unconditional** (trivially-true empty `allOf` condition `{"allOf":[]}`). This closes the same footgun if someone tries to build a deny-everything through the DSL surface. This check is **deliberately narrow** (only the empty-`allOf` case) — it is not general tautology detection: a **scoped** `deny` (applicability set), a wildcard `deny` **with real conditions**, and all `allow` policies **pass**. A cleverly crafted always-true `deny` (e.g. `{anyOf:[{allOf:[]}]}`) can still be authored — that is a **self-inflicted admin action**, in the same class as deleting all roles; recovery goes through another admin (see §Residual under Consequences).

Both write the same table; the flat surface **still** calls `invalidatePolicyCache` after commit as a uniform defensive no-op (flat rows are not consumed, so there is no stale snapshot to correct — but the wiring is kept for consistency in case a flat row is later promoted through the DSL).

### 4. Per-tenant cache with deterministic invalidation

Active policies are compiled once per tenant and held in an in-process cache that is **tenant-keyed** (`application/policy-cache.ts`). Every policy mutation (create/update/enable/disable, from **both** surfaces) calls `invalidatePolicyCache(tenantId)`, which bumps the per-tenant version and drops the entry; endpoints call it **after** the transaction commits so the next request never caches a pre-commit snapshot (the TOCTOU trap). Loading always happens inside `withTenant` (RLS + the non-superuser `awcms_app` role, FORCE RLS), so it never reads across tenants. No restart needed. **Limitation:** invalidation is per-PROCESS; a horizontally scaled deployment needs an additional cross-instance signal (LISTEN/NOTIFY or a short TTL) — recorded as a limitation, not assumed away.

### 5. Decision log & simulation

Every decision records `decision`, `reason`, `matched_policy` (code), and `matched_policy_version` (`sql/031`) into `awcms_abac_decision_logs` — without raw PII/sensitive identifiers (only the policy code, version, and a static reason). The read-only simulation endpoint is audited through `awcms_audit_events` (not the decision log) because its decision is hypothetical.

**Simulation & foreign subjects.** Simulating a set of **hypothetical roles** is a pure `analyze` capability. But simulating an **existing, different tenant user** (`subject.tenantUserId` other than the caller's own) resolves that user's **real** roles/grants — a horizontal enumeration oracle for an `analyze`-only principal. Therefore the foreign-subject path **also** requires `identity_access.access_control.read` (AWCMS has **no** `user_management` module; reading user records is guarded by `access_control.read` — see `src/pages/api/v1/users/index.ts`); without it a foreign subject is rejected with `403`. The probed subject id is recorded in the audit (`simulatedSubjectTenantUserId`) so it can be attributed (not silent enumeration). The per-policy trace stays structural booleans only — it never returns the resolved attribute VALUES.

## Consequences

- **Positive:** attribute-based policies (ownership, value limits, status, environment) are expressed as stored, auditable data that takes effect at one chokepoint without redeploying; the attack surface is minimal (pure interpreter, closed allow-list, fail-closed). The flat #171 surface (which cannot be scoped/conditioned) **cannot** brick a tenant: flat rows are inert (`is_dsl_managed = false`), never consumed by the evaluator.
- **Trade-off:** every guarded request reads the active DSL-managed policies (cached); authoring adds an admin surface (`identity_access.abac_policies.*`); two authoring surfaces coexist (flat #171 + DSL #179), both invalidating the cache (flat invalidation is now a defensive no-op).
- **Residual (self-inflicted DoS, accepted):** a **scoped** or **genuinely conditioned** `deny` that locks out access is a **deliberate admin capability** (e.g. temporarily freezing a module). Part B rejects only the trivial footgun (unscoped + empty-`allOf` deny); a cleverly crafted always-true `deny` (e.g. `{anyOf:[{allOf:[]}]}`, or authoring then enabling through the DSL surface a wildcard deny with an always-true condition) remains possible — in the same class as deleting all roles or all permissions. Recovery goes through **another admin** who is unaffected (or, for a truly tenant-wide deny, a DBA/DSL-level correction). General tautology detection was **rejected** (complexity + false positives) in favour of a narrow, mutation-provable syntactic check.
- **Neutral:** the base ships no domain policy at all — the five ERP examples live in `fixtures/abac-example-policies.json`, authored by a derived application through the API.

## Alternatives considered

- **Arbitrary expressions / CEL / a mini-language with functions** — rejected: attack surface and non-determinism; a constrained AST is enough for ERP needs.
- **Allow-policies as permission granters (ABAC-primary)** — rejected: it violates "role permissions stay mandatory"; the allow-as-constraint + deny-overrides model was chosen instead.
- **No cache (read on every request)** — rejected: per-request cost; a tenant-keyed cache with deterministic invalidation gives consistency without restarts.
- **Replacing the flat #171 CRUD with the DSL (a single surface)** — rejected for atomicity: it would touch the #171 admin UI + its tests; keeping flat + adding the DSL was chosen, with cache invalidation on both surfaces.
