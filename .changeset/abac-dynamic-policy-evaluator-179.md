---
"awcms": minor
---

Dynamic ABAC policy evaluator (Issue #179, epic #177) — the stored
`awcms_abac_policies` rows are now CONSUMED at the `authorizeInTransaction`
chokepoint (default-deny), instead of authorization resting on RBAC + built-in
guards alone. Ported from awcms-mini (ADR-0033).

- **Bounded condition DSL (`domain/abac-policy.ts`).** `conditions` is a
  versioned jsonb AST (`sql/031` adds `dsl_version`/`conditions`/`priority` +
  nullable applicability columns): `allOf`/`anyOf`/`not` composition and
  `{attr, op, value|valueAttr}` leaves over a closed, server-side attribute
  allow-list (`subject.*` from the authenticated context — never the request
  body; `resource.*` from the endpoint-populated verified resource; `action`;
  `env.*` server-derived, `env.ipTrusted` fail-closed `false`) and a fixed
  operator set (`eq/ne/in/nin/lt/lte/gt/gte/exists`). No `eval`, no `new
  Function`, no dynamic import, no templated SQL. The parser/validator is
  fail-closed and allow-list membership is **own-property only**
  (`hasOwnProperty`) so prototype-chain keys (`__proto__`/`constructor`/…)
  cannot slip past the unknown-attribute check (fail-OPEN closed at both the
  authoring validator and the eval-time backstop).
- **Pure evaluator (`domain/abac-evaluator.ts`) + precedence.**
  `evaluateAccess` gains an optional 5th param `abac?: { policies, env }` (after
  `businessScopeFacts`); omitted/empty = ABAC no-op, so every pre-existing ≤4-arg
  call site is behavior-identical. Precedence after the built-in guards
  (tenant isolation, self-approval, force-decision, business-scope #180): explicit
  DENY wins (and an invalid/error policy fails closed) BEFORE the RBAC check; the
  RBAC permission is still required (an allow-policy never creates one); applicable
  ALLOW policies act as a constraint (≥1 must be satisfied). The #181 SoD
  high-risk guard remains additive after the decision.
- **Tenant-keyed cache (`application/policy-cache.ts`)** compiled once per tenant,
  invalidated deterministically after commit by EVERY policy mutation — both the
  new DSL surface AND the pre-existing flat `/api/v1/abac/policies` CRUD (#171),
  which now also invalidates so it can never bypass the evaluator. Per-process
  invalidation is a documented limitation.
- **Two surfaces, one table — but the evaluator consumes ONLY DSL-managed
  policies.** A new `is_dsl_managed` discriminator (`sql/031`, default `false`)
  separates the two authoring surfaces: the flat #171 CRUD (which can set neither
  applicability nor a condition) leaves rows `is_dsl_managed = false`, and the
  cache loads ONLY `is_active AND is_dsl_managed` rows — so a flat row is NEVER
  evaluated and stays inert (its exact pre-#179 behavior). This closes a
  full-tenant lockout: a flat `deny` used to present as a wildcard, always-true
  DENY that bricked every request (including the operator's own
  `access_control.configure` — no in-band recovery); the migration is now
  deploy-safe (a pre-existing inert flat `deny` is not activated on migrate).
  Only the DSL surface sets `is_dsl_managed = true` (INSERT + UPDATE).
  Defense-in-depth: the DSL validator additionally REJECTS an unscoped +
  unconditional (`{allOf:[]}`) deny. See ADR-0033 §3.
- **Admin API.** New `GET/POST /api/v1/access/policies`,
  `GET/PUT /api/v1/access/policies/{id}`,
  `POST /api/v1/access/policies/{id}/{enable,disable}` (guarded
  `identity_access.abac_policies.{read,configure}`, audited, only valid DSL is
  stored), `POST /api/v1/access/policies/simulate` (read-only, guarded `.analyze`,
  audited without a decision-log write), and `POST /api/v1/access/evaluate`.
  Permissions seeded in `sql/032`.
- **Simulation foreign-subject authority gate.** Simulating a DIFFERENT existing
  tenant user resolves that user's real grants — an enumeration oracle — so it
  additionally requires `identity_access.access_control.read` (AWCMS has no
  `user_management` module; reading a user record is guarded by
  `access_control.read`); the probed subject id is recorded in the audit event.
- **Decision log** records policy code + `dsl_version` + a static reason, never
  raw attribute values. Five illustrative ERP example policies ship in
  `fixtures/abac-example-policies.json` (not seeded into the base).
