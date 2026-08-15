🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](program-model-keanggotaan-2026-08-09.id.md)

# Membership model program — aligning user/role/RBAC/ABAC with Cloudflare's model

> **Status: PLAN.** This document schedules work, it does not describe code that
> already exists. Every table, endpoint, gate, and `bun run` target mentioned
> below **does not exist yet** unless explicitly called out as "today".
> Written 9 August 2026. The official continuation point remains
> [`docs/PROJECT_STATE.md`](../PROJECT_STATE.md) §4.

## 1. Why this program exists

The original question: study the Cloudflare documentation
[_Manage members_](https://developers.cloudflare.com/fundamentals/manage-members/)
and [_Tenant API_](https://developers.cloudflare.com/tenant/), then adapt AWCMS
user/role/RBAC/ABAC management so it is more proper, ready for multi-tenant
Cloudflare integration, and ready to act as a SaaS / IaaS / EaaS operator.

Mapping both sides gave an unexpected answer: **the AWCMS authorization engine
is stronger than Cloudflare's.** Cloudflare has no dynamic policy evaluator with
_deny-overrides_, no _Segregation of Duties_, no per-tenant Row Level Security at
the database layer, and it does not publish a per-decision decision log. AWCMS
has all four —
[ADR-0033](../adr/0033-abac-dynamic-policy-evaluator.md),
[ADR-0031](../adr/0031-segregation-of-duties-conflict-enforcement.md),
`sql/017`, and `awcms_abac_decision_logs` — guarded by 36 gates in the
`bun run check` chain.

What is missing is not the engine. What is missing is **the shape of
membership**: the layer that makes a system sellable as a service.

| Capability                        | Cloudflare                                  | AWCMS today                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One human, many accounts          | yes — global member                         | **no** — `awcms_identities.tenant_id NOT NULL`, `UNIQUE (tenant_id, login_identifier)` (`sql/004`)                                                                                                                                        |
| A grant carries its own scope     | yes — Policy = actor + role + resourceGroup | **no** — `awcms_access_assignments` has no scope (`sql/005`); `awcms_business_scope_assignments` (`sql/027`) is separate and **not used by any route yet** ([ADR-0060](../adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md)) |
| A role declares its attach level  | yes — account/domain/resource-scoped        | **no** (= PROJECT_STATE §4 **R8**)                                                                                                                                                                                                        |
| User Groups                       | yes, SCIM-syncable                          | **does not exist at all**                                                                                                                                                                                                                 |
| Invite by email + pending status  | yes                                         | **does not exist** — only self-registration + approval (`sql/074`)                                                                                                                                                                        |
| List & revoke sessions            | yes                                         | **no surface**                                                                                                                                                                                                                            |
| Plan / subscription / entitlement | yes                                         | **zero**                                                                                                                                                                                                                                  |
| Suspend a customer                | yes                                         | the `suspended` enum has existed since `sql/002`, **never enforced outside login**                                                                                                                                                        |

## 2. Four decisions that lock the scope

1. **Target: a global principal.** One human, one credential, many tenants.
   Executed last, as a promotion of authority that does not move a single foreign
   key.
2. **Cloudflare is used as a MODEL, not as an integration target.** The partner
   Tenant API **is not built** — it demands a signed Channel/Alliance agreement
   and an entitlement granted by Cloudflare. What is pursued: an AWCMS membership
   model that is **isomorphic** with Cloudflare's, so that if that agreement ever
   exists, the integration becomes a table mapping — not a redesign.
3. **The full commercial layer**, including partner/EaaS: entitlement, metering,
   quota, partners, delegated access.
4. **Start from Wave 0** — eight PRs that only tighten.

## 3. The isomorphism map

The contract no wave is allowed to violate.

| Cloudflare                                                 | AWCMS after this program                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| User (global, one email)                                   | `awcms_principals`                                                                              |
| Account                                                    | `awcms_tenants`                                                                                 |
| Member                                                     | `awcms_tenant_users` (unchanged; now means membership)                                          |
| Policy `(actor, permission_groups[], resource_groups[])`   | one `awcms_access_policies` row                                                                 |
| PermissionGroup                                            | `awcms_roles` + `awcms_role_permissions`                                                        |
| ResourceGroup / scope                                      | `(scope_type, scope_id)`; `'tenant'` = account-wide (already exists: `TENANT_WIDE_SCOPE_TYPE`)  |
| account/domain/resource-scoped role                        | `awcms_roles.attachable_scope_types text[]`                                                     |
| User Group                                                 | `awcms_user_groups` + `awcms_user_group_members`                                                |
| Invite / "Invite Pending"                                  | `awcms_invitations` + `awcms_invitation_policies`                                               |
| API token + policy `effect`/`resources`/`condition`/expiry | `awcms_machine_credentials` (`sql/082`), extended: action classes, IP conditions, scope binding |
| Tenant → Account (partner)                                 | `awcms_partners` + `awcms_partner_managed_tenants`                                              |
| Subscription `rate_plan` + `component_values`              | `awcms_tenant_subscriptions` + `awcms_tenant_entitlements`                                      |
| _(deferred)_ `POST /accounts` + `unit_tag` + KYC           | `awcms_provider_accounts` — **not built**                                                       |

One difference is **deliberate and not adopted**: Cloudflare's effective
permission is purely additive (union, no deny). AWCMS keeps its ABAC
**deny-overrides**. Union applies only on the _grant_ side (role ∪ group ∪
delegation); a deny policy still wins.

## 4. Nine verified findings that shape the design

All checked directly against the code on 9 August 2026.

1. **184 route files call `authorizeInTransaction` directly** (255 routes in
   total; only 16 go through `defineTenantRoute`). Every new input **must** go
   through the `options?` bag, never a positional parameter.
2. **`scripts/access-chokepoint-check.ts` locks onto the literal
   `fetchGrantedPermissionKeys(`** as the signal "this handler decides a
   permission". Renaming that function makes the gate **green while blind** — the
   defect class already recorded in PROJECT_STATE §4 R9. The name is kept; it is
   **its return type** that changes.
3. **31 `src/pages/admin/*.astro` screens decide with `permissions.has()`
   alone** (R3) — bypassing `evaluateAccess`, `resolveModuleEnabled`, and
   `recordDecisionLog`. **Two** gates are blind to them, not one:
   `access:chokepoint:check` (`ROUTES_ROOT` = `src/pages/api/v1`) and
   `api:tenant-route:check` (`ROUTES_ROOT` = `src/pages/api`).
4. **`awcms_tenants.status='suspended'` is not enforced at the chokepoint.** It
   is read only on the login/reset/registration/SSO-start paths and in the public
   host resolver. The consequence: a tenant's public site dies immediately, while
   admin sessions already issued keep full access until they expire on their own,
   and machine credentials are not touched at all.
5. **`awcms_abac_decision_logs` has no retention whatsoever** (~8.6 million
   rows/day at 100 rps) **and** is the cursor source for the `reporting`
   projection, whose description calls that table "append-only — never deleted".
   Retention and projection authority are **one** decision, not two.
6. **`awcms_business_scope_assignments` (`sql/027`) already has every column a
   Cloudflare Policy needs** — effective dating, expiry, revocation,
   grantor/approver, an append-only event log, composite FKs. It is a Policy table
   that just happens to have only ever been pointed at one kind of subject.
7. **Business-scope coverage today is permission-agnostic.** `evaluateAccess`
   asks "does the subject have a scope fact that covers this scope?", never "for
   THIS permission". That is the real gap versus Cloudflare, and closing it is a
   one-clause change that **can only deny more**.
8. **Login lockout is per-`(tenant, email)`.** An attacker rotating the
   `x-awcms-tenant-id` header gets N × `AUTH_LOGIN_MAX_ATTEMPTS` against the same
   human. A global principal **fixes** this rather than burdening it.
   → **CLOSED 12 August 2026** by
   [ADR-0086](../adr/0086-the-lockout-counter-is-global.md) (`sql/113`, #525);
   [#430](https://github.com/ahliweb/awcms/issues/430) closed. Its prerequisite,
   `awcms_principals`, landed the same day via
   [ADR-0085](../adr/0085-one-human-one-credential-many-tenants.md) (#524).
9. **`policy-cache.ts` calls `parseAbacCondition(row.conditions)` without a
   version argument**, so a row with `dsl_version: 1` that uses a next-version
   attribute will pass validation. This must be fixed **before** the ABAC
   attribute list grows at all.

## 5. Nine waves

±43 atomic PRs. Each PR = one issue: migration + OpenAPI + tests + changeset +
docs + regenerated inventory, the full `bun run check` green. **[R]** = a gate
that will go red and must be fixed in the same PR.

### Wave 0 — ratchet & honesty (1 + 8 PRs)

Nothing widens; everything tightens. Each PR is worth landing on its own.

| PR  | Issue       | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [R]                                                                                        |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0.0 | #423 (epic) | This document + a PROJECT_STATE §4 entry + 9 GitHub issues. Docs-only, changeset-exempt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `check:docs`                                                                               |
| 0.1 | #424        | `api:tenant-route:check` `ROUTES_ROOT` covers `src/pages/admin`; seed the 31 screens into `NOT_YET_MIGRATED`. **One line** — from then on a new admin screen cannot open its own transaction                                                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                          |
| 0.2 | #425        | `tests/access-chokepoint.test.ts` made **rename-proof**: replace the two `not.toMatch` assertions based on a variable-name literal with structural assertions — exactly **one** `return { allowed: true }` in the body of `authorizeInTransaction`, at an index > the index of `evaluateAccess(`. Add `deciding.length > 0` to the gate's `main()`                                                                                                                                                                                                                                                                   | —                                                                                          |
| 0.3 | #426        | New gate `access:decision-log:coverage:check` — every terminal `return` in `access-guard.ts` is preceded by `recordDecisionLog(` in the same lexical branch. Green today, protects every wave that follows                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                          |
| 0.4 | #427        | Retention ADR for `awcms_abac_decision_logs` + resolution of the `reporting` projection-authority dispute. Migration: ascending `(tenant_id, created_at)` index + `GRANT DELETE … TO awcms_worker` (`sql/022` only granted SELECT, so today's purge job **cannot** delete). `dataLifecycle` descriptor `identity_access.abac_decision_logs`, `retentionClass: audit_security`, 90 days by default, legal-hold `overrides_retention`. New gate `data-lifecycle:high-volume-coverage:check`                                                                                                                            | `data-lifecycle:registry:check`, `repo:inventory:check`                                    |
| 0.5 | #428        | Move `resolveClientIp` from `visitor-analytics/domain/client-ip.ts` to `src/lib/security/` — a pure move, body byte-identical, 9 call sites change only their import line. Cross-module imports from `identity_access` are forbidden by [ADR-0011](../adr/0011-capability-ports-for-cross-module-collaboration.md)                                                                                                                                                                                                                                                                                                   | `modules:*:check`                                                                          |
| 0.6 | #429        | ADR: `suspended` becomes a **service** status, not a login status. `resolveTenantContext` also returns the tenant status (it already reads the tenant-user row — one extra column, not a new query); a new deny branch `403 TENANT_SUSPENDED`, `matchedPolicy: "tenant_suspended"`, **before** the permission is looked up. The allow-list of actions that stay alive during suspension is written as a constant commented "widening this needs an ADR" — mirroring `MACHINE_CREDENTIAL_ALLOWED_ACTIONS`. Suspend/restore endpoints are `scope: 'platform'` ([ADR-0053](../adr/0053-platform-scoped-permissions.md)) | `access:permissions:enforcement:check`, `admin:screen-coverage:check`, `db:fk-index:check` |
| 0.7 | #430        | `bun run identity:principals:preflight` — a **read-only** script, zero migrations: a census of `lower(btrim(login_identifier))` collisions **within** a single tenant (legal today, impossible after principals), non-email identifiers, identities with no mailable address. Prerequisite for Wave 7, run months ahead of it                                                                                                                                                                                                                                                                                        | `scripts:inventory:check`                                                                  |
| 0.8 | #431        | ADR: a role declares its scope (**closes R8**). Migration: `awcms_roles.attachable_scope_types text[] DEFAULT '{tenant}'` + `permission_scope text DEFAULT 'tenant' CHECK IN ('tenant','platform')`. `listPermissionCatalog` gains a `scope` predicate; `grantPermissionToRole` re-checks on the server — the picker is UI, the check is the control                                                                                                                                                                                                                                                                 | `tests/platform-scoped-permissions.test.ts`, `api:*:check`                                 |

### Wave 1 — R3: admin screens go through the chokepoint — **DONE (#450)**

> **Status as of 10 August 2026: CLOSED.** Verified by RUNNING both of its gates,
> not by reading their comments —
> `access:chokepoint:check` reports _"33 admin screens, all routed through
> loadAdminScreen (R3 closed; ledger: 0)"_ and `admin:screen-coverage:check`
> _"33 screens claim 137 of 208 declared permissions"_. Both ledgers are zero.
>
> **Three corrections to the plan below**, recorded because the next reader could
> conclude this wave has not started when it is in fact closed:
>
> 1. the helper is called **`loadAdminScreen`** (`src/lib/auth/admin-screen.ts`),
>    not `defineAdminScreen` — the name was changed when it landed because
>    `.astro` frontmatter has no handler to wrap, so "define" would promise a
>    shape that does not exist; the reasoning is written in the file header;
> 2. `extractScreenClaims` lives in **`scripts/admin-screen-coverage-check.ts`**,
>    not in `admin-screen-coverage-ledger.ts` — that file never existed;
> 3. there are **33** screens, not 31 (32 top-level + `tenant/domains.astro`).
>
> What still holds from this plan is its reasoning, and it points forward:
> `ssr.permissions` (the raw RBAC union) is still assembled on every render and is
> still read in three places inside the transaction — e.g.
> `listProjectionSummariesForTenant(tx, tenantId, ssr.permissions)`. Once a grant
> carries a scope in Wave 3, that union stops meaning "may read this".

**Must be finished before Wave 3.** Once grants are scoped,
`ssr.permissions.has()` reads a cross-scope union — R3 changes from "no ABAC and
no log" into real read-side _over-disclosure_.

**PR 1.0** — a `defineAdminScreen({ workClass, authorize, load })` helper in
`src/lib/auth/`. _(Landed as `loadAdminScreen` — see the corrections above.)_ That directory already imports `identity-access/application` and
is already in the `SCAN_ROOTS` of `logging:lint:check`, so no new boundary is
crossed. The helper **must** mirror `defineTenantRoute`: one `withTenant`,
`authorizeInTransaction`, and `load` **inside the same transaction** — if the
helper returns and then the screen opens a second transaction, the decision and
the read are not atomic and the scope filter is missed, which is exactly the hole
being closed.

A deny renders a denied state, **not** a redirect: 20+
`tests/admin-*-page-contract.test.ts` files assert ids such as `#users-denied`.

The gate **extends** `access-chokepoint-check.ts` with a second root, it is not a
new script — two scripts means two exception lists that drift apart. For `.astro`
the slicing is **per file**, because one `.astro` file is one render path; that
reasoning is written in the script header so it is not mistaken for a repeat of
the mistake recorded in [ADR-0063](../adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md) §3.
The `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` ledger may only shrink, plus a stale-entry
check.

**[R] required in the same PR:** `extractScreenClaims` has to recognize the
object-literal shape its helper uses. Without that, permission claims collapse and
the gate goes red for the wrong reason. _(Landed: that function lives in
`scripts/admin-screen-coverage-check.ts`, and it recognizes `loadAdminScreen`.)_

**PR 1.1–1.7** — ±5 screens per PR, each PR deleting its rows from the ledger, the
`admin-*-page-contract` files **not** modified.

### Wave 2 — session & credential surface (2 PRs)

`awcms_sessions` cannot be listed today — there is no fingerprint column.

**PR 2.1** — a migration adds `client_ip_hash`, `user_agent_summary`,
`origin_auth CHECK IN ('password','sso','handoff','switch')`, and
`switchable boolean DEFAULT true`. Filled by `hashClientIp`/`summarizeUserAgent`
which `login.ts` **already** imports. **No `last_seen_at`** — writing on every
request on the authorization read path is write amplification for a cosmetic
column.

Endpoints: `GET /auth/sessions`, `DELETE /auth/sessions/{id}`,
`POST /auth/sessions/revoke-all?exceptCurrent=true`,
`POST /auth/password/change` (aal2 step-up + the old password),
`GET|POST /users/{id}/sessions[/revoke-all]`.

`read` and `revoke` are **two separate permissions**, following the reasoning
`identity-access/module.ts` already writes down for `machine_credentials`: during
an incident you want people who can kill a leaked credential without being able
to print one.

`POST /auth/password/change` closes a real gap — today the only way to change a
password is a forgot/reset round-trip through email.

**PR 2.2** — `revokeAllSessionsForIdentity` gains a per-principal sibling (used by
Wave 7); `origin_auth` is filled in by all three session issuers.

### Wave 3 — the Cloudflare Policy shape (5 PRs) — highest risk

**PR 3.1** — ADR _a grant carries its own scope_. Table
`awcms_access_policies`: `subject_type CHECK IN ('tenant_user','user_group')`
plus an XOR over the two subject columns, `role_id`, `scope_type`, `scope_id`,
full effective dating, status `active|expired|revoked`, **six composite FKs
carrying `tenant_id`**, `UNIQUE (tenant_id, id)`, a partial unique on active,
ENABLE + FORCE RLS. Plus an append-only `awcms_access_policy_events`.

Those composite FKs are mandatory, not stylistic: PostgreSQL runs referential
integrity checks as the **table owner** and **bypasses RLS**, so a bare
`REFERENCES awcms_tenant_users (id)` can point at another tenant's row even with
FORCE RLS on. The full reasoning is in the `sql/027` header.

**A new table, not an extension** — three reasons, in order of weight:

1. `UNIQUE (tenant_id, tenant_user_id, role_id)` on `awcms_access_assignments` is
   precisely what has to die (one role in three scopes = three rows). Dropping a
   unique index on a live authorization table also silently removes the `23505`
   that `assignRole` maps to a 409.
2. Extending `awcms_business_scope_assignments` in place means rewriting the two
   SoD readers in the same PR — and SoD is the only subsystem whose wrong answers
   are invisible until an auditor asks.
3. A third table makes _expand / migrate / contract_ possible **without
   dual-write**.

`fetchGrantedPermissionKeys` **keeps its name** (finding #2); its return type
becomes `{ keys: Set<string>; scopes: Map<string, …> }`. Its body is a
`UNION ALL` over three tables — with the new table empty, the result is
**exactly** today's data. 11 call sites become `.keys`, checked by the compiler.

Proof: a differential oracle against the old query over a random subject corpus,
run while both sources are still alive.

**PR 3.2** — every grant writer writes a Policy. Endpoint
`POST /api/v1/access/policies`; the old `/access/assignments` stays and
delegates. **[R]** the `WRITE_MARKER` in
`tests/access-assignment-writers.test.ts` moves to `awcms_access_policies`.

**PR 3.3** — backfill the two old tables into Policy **preserving `id`** so audit
references survive, then `REVOKE INSERT, UPDATE, DELETE` from `awcms_app` so both
become read-only history. The oracle is run once more **after** the backfill.

**PR 3.4** — **scope qualification.** `BusinessScopeFact` gains
`permissionKeys?: ReadonlySet<string>`; one clause is added inside the coverage
predicate:

```ts
if (fact.permissionKeys !== undefined && !fact.permissionKeys.has(key))
  return false;
```

With `undefined` — which every legacy-derived fact carries — the expression is
identical to today's; once filled, the only possible change is `true → false`.
**There is no input, in any order, that it could turn from a deny into an allow.**
That is the entire security argument, and it can be checked by reading four
lines.

Kill switch: a **build-time** constant `SCOPE_NARROWING_ENABLED`, not an env var —
two instances in one deployment could disagree, and the policy cache is already
per-process. The admin surface that **writes** scoped grants must be a PR
**after** the resolver: as long as no non-tenant-wide grant exists, rollback is
"flip the constant, redeploy".

**Reviewer note:** every existing business-scope test must pass **unchanged**. If
one needs editing, the change is wrong.

**PR 3.5** — User Groups ADR. `awcms_user_groups` (with
`source CHECK IN ('local','scim')` and `external_id` as the sync key —
**not** `group_code`, because renaming a group in the IdP must not orphan it)
plus `awcms_user_group_members`. Subjects are resolved through a single
`UNION ALL` CTE, so **the query count stays at one** and the hot path does not
slow down.

Groups **grant roles**, and roles grant permissions, so that `subject.roles`,
`fetchGrantedPermissionKeys`, and the SoD fact resolver all stay on one axis of
membership.

**This is this wave's silent failure mode.** If a group granted permissions
without granting roles, a tenant policy `subject.roles in ["editor"]` would
silently stop matching — a **deny becoming inert**, which is a widening — and SoD
would stop detecting conflicts for group-derived grants, precisely the grants the
group feature exists to create. No test asserts that a policy **does** match, so
nothing would catch it. A new gate `access:sod-fact-parity:check` requires both
resolvers to refer to one shared `grantSourceTables()` constant.

SCIM: a `source='scim'` group rejects membership mutations and renames through the
admin API with `409 GROUP_EXTERNALLY_MANAGED`, mirroring Cloudflare's immutable
SCIM groups. **SCIM is not built** — it is merely not obstructed.

### Wave 4 — invitations (2 PRs)

**PR 4.1** — `awcms_invitations` (`status pending|accepted|revoked|expired`,
`resend_count <= 5` as a database CHECK, `skip_email_confirmation`) plus
`awcms_invitation_policies` — **the invitation carries its Policy**, exactly like
Cloudflare.

Token: a new file `src/lib/auth/invitation-token.ts` mirrors the construction of
`reset-token.ts` (32 bytes CSPRNG base64url, `sha256:` hex hash) but with
**different function names** — the precedent is already written in the
`reset-token.ts` docblock: a separate pair of names so that one token type can
never be mistaken for another at a call site.

Resend **rotates** the token and invalidates the old link; without rotation,
"resend" is a token-multiplication surface.

`skip_email_confirmation` may only be used by a permission with `scope:
'platform'`, or when the target principal is already verified. Otherwise any
tenant admin could mint an unverified **global** principal for
`ceo@othercompany.com` — and a global principal is the one object where that
matters.

**PR 4.2** — acceptance. `materializeMembership()` is introduced here as **one
function** that Wave 7 later redirects.
`GET /auth/invitations/{token}` (preview: tenant name + inviter name, **never**
the email) and `POST …/accept`, both unauthenticated →
**`checkSharedRateLimit` is mandatory** ([ADR-0066](../adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md)).

An expired token is answered with a **404, not a 410** — do not build a status
oracle. An invitation naming an `is_system` role is rejected at creation time
**and** re-checked at acceptance; the precedent is `approveRegistrationRequest`.

Invitations and self-registration **both stay**: their directions are opposite —
registration is _pull_ (a stranger asks), an invitation is _push_ (an admin
offers) — and each has its own permission and its own audit story.

**[R] `tests/shared-rate-limit.test.ts` goes from 11 → 13 surfaces.** ADR-0066
says "eleven"; mention the change in the changeset.

### Wave 5 — entitlement (SaaS) (4 PRs)

**PR 5.1** — Global without RLS, with `awcms_permissions` as precedent:
`awcms_entitlements`, `awcms_plans`, `awcms_plan_entitlements`. Tenant + FORCE
RLS: `awcms_tenant_subscriptions`, `awcms_tenant_entitlements`. Both **must** be
registered in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` **and** in the privilege map in
`scripts/security-readiness.ts` — `tests/repo-inventory.test.ts` asserts that the
two sides match, so an undeclared global table turns two gates red.

`resolveModuleEnabled` becomes `resolveModuleAvailability` — a `LEFT JOIN` on a
query that **already** runs, so zero extra round-trips. A new deny
`403 ENTITLEMENT_REQUIRED`, `matchedPolicy: "entitlement_required"`, placed
**after** `module_disabled` (a tenant that turned its own module off deserves to
be told that, not offered an upgrade) and **hard-exempt** for the platform
tenant, `isCore` modules, and every descriptor without an entitlement. The
platform tenant must be hard-exempt: an overdue subscription must not lock the
operator out of its own control plane.

**Lands inert:** zero descriptors declare `requiresEntitlement`. A golden test
proves the guard chain is byte-identical to before, including the same decision
log rows.

`MODULE_CONTRACT_VERSION` goes to 2.6.0 (purely additive — declaring no
entitlement means "unrestricted", which is what every descriptor means today),
paired with a bump of `awcms-family-compatibility.yaml`.

A new gate `access:entitlement:deny-only:check` — the entitlement evaluator
exports no function that can return `{ allowed: true }`. This is exactly the
mutation class recorded in ADR-0063.

**PR 5.2** — `evaluateSubscriptionTransition(now, subscription, policy)`,
**pure, no database**: `trialing → active → past_due → grace → suspended`,
connecting to the suspension gate from PR 0.6. A job is its only writer.

**PR 5.3** — the grandfathering machine: `bun run entitlements:backfill`
(dry-run by default, the `skippedAsDeliberate` rule taken from
`identity-access/domain/owner-permission-backfill.ts`), a **blast-radius** report
in `bun run security:readiness` — _"N tenants will start receiving 403
ENTITLEMENT_REQUIRED for module X"_ — which must be run **before** the descriptor
lands, not after. That is the check that will catch the original mistake before it
ships.

One thing makes this acceptable as a blanket migration, unlike a permission
backfill: an entitlement **never existed to be revoked**, so its absence can never
mean a deliberate decision. That asymmetry is what makes the difference.

**PR 5.4** — the first real entitlement attachment on one non-core module,
`409 ENTITLEMENT_REQUIRED` on the `module_management` enable endpoint (courtesy,
not the control), and the `/admin/subscriptions` screen.

### Wave 6 — metering & quota (IaaS) (4 PRs)

**PR 6.1** — ADR: **quota is admission control, NOT authorization.** Four
reasons, and no single one of them is enough on its own:

1. A quota is not a subject fact. It is mutated by the action being authorized,
   so it needs `SELECT … FOR UPDATE` in the same write transaction; the chokepoint
   runs before the handler and cannot hold that lock.
2. Counting resources means knowing their tables. Putting that at the chokepoint
   forces `identity_access` to import every module's schema — exactly what
   ADR-0011 forbids, and `modules:table-writes:check` would reject it.
3. It poisons a security signal: `awcms_abac_decision_logs` is a security record.
   Writing `deny` rows there for a business capacity condition makes "authorization
   denial anomalies" unreadable.
4. The answer is a different HTTP class. `409 QUOTA_EXCEEDED` is actionable
   ("upgrade"); `403 ACCESS_DENIED` is not.

So: **capability** (boolean, derived from the plan, request-free) at the
chokepoint; **volume** through `_shared/ports/quota-port.ts`, called by the
application layer of the owning module, inside its own write transaction.

Three tables with designed cardinality, not accidental:

| Table                  | Written when                                                  | Cardinality                           | Retention                                                       |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `awcms_usage_counters` | on every metered event, `INSERT … ON CONFLICT DO UPDATE`      | tenant × meter × period — **bounded** | 90 days, `generic`                                              |
| `awcms_usage_records`  | **only** for meters with `itemized: true` — never per request | one row per billable event            | 2555 days, `financial_tax`, `jsonl` archive, legal-hold applies |
| `awcms_usage_rollups`  | by a job, from the counters                                   | daily/monthly per tenant per meter    | long, `financial_tax`                                           |

The hot path touches **one row per tenant per meter per period**, never an append.
`itemized` is a descriptor flag so that "does this meter write a ledger row"
becomes a decision reviewed in code, not a call-site habit.

All three must have a `dataLifecycle` descriptor **in the same PR** — the PR 0.4
gate enforces it. `MODULE_CONTRACT_VERSION` goes to 2.7.0.

**PR 6.2–6.4** — the rollup job + retention proof; the first real meter; the usage
API and the `/admin/usage` screen.

### Wave 7 — the global principal (4 PRs) — highest structural risk

Executed as **a promotion of authority that does not move a single foreign
key.** `awcms_identities` is demoted in meaning while staying physically
identical: a nullable `principal_id` column is added; authority (credentials, MFA,
lockout, email ownership) is raised one PR at a time; `awcms_identities.id` and
the eight FKs into it do not move. `resolveTenantContext` and
`authorizeInTransaction` **never learn that principals exist**.

**PR 7.1** — ADR _one human, one credential, many tenants_.
`awcms_principals` global without RLS.

The sentence that makes the absence of RLS defensible, required verbatim in the
ADR: **"a principal is an AUTHENTICATION fact, never an AUTHORIZATION fact."**
`awcms_permissions` is the precedent for a global table — but it is a catalogue
that grants nothing merely by existing; a credential table is not that. So
**four controls replace RLS**:

1. **Database privileges narrowed.** `REVOKE ALL` then
   `GRANT SELECT, INSERT, UPDATE` — **never DELETE**.
2. **A read-shape invariant, machine-checked.** A new gate
   `identity:principal-access:check`: only files on an allow-list may name the
   table, and every query there is keyed on `id =` or `email_normalized =` —
   never an unbounded scan, never `LIKE`. RLS restricts _rows_; this restricts
   _call sites_.
3. **A projection invariant.** `password_hash` never leaves the store module.
4. **The authorization boundary does not change.** Holding a principal grants
   nothing; authorization still goes through `awcms_tenant_users` under FORCE RLS.

Backfill: one principal per distinct normalized email; `password_hash` stays
**NULL**. The credential is **promoted** on the first successful login (verify
against the identity hash, then write to the principal). That is what makes the
backfill safe: it moves not one secret and cannot lock anybody out. The migration
fails hard if the PR 0.7 census found collisions.

**PR 7.2** — login authenticates the principal; the credential is promoted on
first use; **lockout becomes global**. Regression test: rotating the tenant header
does not reset the counter — that is the fix for finding #8.

**PR 7.3** — MFA moves to the principal (same encryption as `sql/024`). A
consequence that **must be written in the ADR**: an MFA reset by an admin of
tenant A is now global, and is therefore audited in **both** tenants' logs. This
is the only place where a tenant admin's action reaches outside its own tenant, so
it must be a deliberate, permissioned, recorded action.

**PR 7.4** — login without a tenant header → `409 MEMBERSHIP_SELECTION_REQUIRED`
plus a **principal token** (a new hash namespace, ≤120 seconds, single use) →
`POST /auth/session/tenant`; plus `POST /auth/session/switch`.

**The most dangerous invariant in the whole program:** a principal token must
**never** authenticate `authorizeInTransaction`. Copy
[ADR-0049](../adr/0049-machine-credentials-and-session-introspection.md) exactly
— the bearer kind is carried by its hash namespace, `isPrincipalTokenHash()` is
checked **before** `resolveTenantContext`, and a principal hash produces a hard 401. Test: present a principal token to five guarded endpoints, assert 401 on all
of them **and zero decision log rows**.

**The non-switchable rule:** a session born from a tenant IdP
(`awcms_external_identities`, `sql/025`) or from break-glass **must** be
`switchable = false`. Without that rule, the IdP administrator of tenant B could
assert `alice@corp.com`, receive a session, and then switch into tenant A — a
complete cross-tenant takeover through a feature that looks like a convenience.

**[R]** `tests/shared-rate-limit.test.ts` goes from 13 → 15.

### Wave 8 — partner / EaaS + delegated access (5 PRs)

**PR 8.1** — ADR: **`ModulePermissionScope` stays `{tenant, platform}` — there is
no `partner` value.** The reasoning goes on the record because the next person
will propose it again: `scope` governs who may _hold_ a permission; partnership
governs _which objects_ it touches. Merging the two produces a permission held
correctly and executed against the wrong tenant — and no RLS policy would object,
because the actor really is legitimately authenticated somewhere.

Instead: **a partner is an ordinary tenant** (`awcms_partners`,
`awcms_partner_managed_tenants`). ADR-0053 uses the same argument to reject a
global superadmin. Reach is **data**, not permission.

**PR 8.2** — delegated access ADR. An approved grant **mints an ordinary
`awcms_tenant_users` row** in the target tenant, bound to a limited `support`
role and an `awcms_delegated_access_grants` row with `expires_at NOT NULL`.
Everything downstream works **without change** — RLS, decision log, audit, SoD,
business-scope facts — because the actor genuinely is a tenant user there. The
precedent is [ADR-0050](../adr/0050-bff-session-handoff-code.md), which likewise
mints a fresh session from a short-lived hashed artifact instead of storing a live
credential.

The grant row is RLS'd on the **TARGET** tenant: a customer must be able to see
and revoke every access into its own tenant; the partner's view goes through a
narrow `SECURITY DEFINER` function, precedent `sql/048`. That asymmetry is
deliberate — the customer's view is the authoritative one.

Sessions derived from a grant: `switchable = false`, a bounded TTL, and they die
together with the grant in the same transaction (the pattern already used by
`setTenantUserStatus`).

**PR 8.3** — two-sided attribution: every decision log and audit row under a grant
carries `grant_id` plus the originating identity, and `awcms_audit_events` gains
`actor_tenant_id`. This closes the open follow-up in
[ADR-0054](../adr/0054-tenant-provisioning.md): _"a tenant that is created does
not see the record of its own birth."_

**PR 8.4** — the `/api/v1/partner/tenants/**` surface, authorized by
`awcms_partner_managed_tenants` **and** an active grant — never by a permission
alone.

**PR 8.5** — machine credential write classes (Cloudflare: a token has its own
policy). The ceiling stays **in code**: `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS`
intersected with the per-credential column. If actions became a pure column, one
backup restore, one hand-written INSERT, or one provisioning path that lost its
`WHERE` could mint a catalogue-wide write credential with every gate green.

Proof: a test computing `WRITE_ALLOWED ∩ HIGH_RISK_ACTIONS = ∅` **from the live
constants**, not from a literal list that will drift the moment a new high-risk
action exists.

Plus IP conditions (**must deny when `clientIp` is unavailable** — otherwise every
route not yet migrated silently disables the condition), scope binding, and
`MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS = 30`.

The `machine_credential_readonly` sentinel is **kept verbatim** — it exists in the
decision log history and in ADR-0049; replacing it rewrites the past for log
consumers.

## 6. Cross-wave rules

1. **The chokepoint step order that must not move.** The structural gates
   (machine-credential, `module_disabled`, `entitlement_required`,
   `platform_scope_required`, `tenant_suspended`) **must** sit above
   `fetchGrantedPermissionKeys`. All of them answer "the caller's grants must not
   influence this". Moving any of them below turns a structural gate into a
   permission-shaped gate, and the failure is invisible: one grant row that should
   not exist becomes sufficient.
2. **`narrowPermissionKeys` stays between the fetch and the `ownershipGrant`
   widening.** Once write credential classes exist, the `!machine` clause carries
   far more weight than it does today.
3. **Every new gate is deny-only.** None of them may produce `allowed: true`.
4. **Claims of the form "X runs before Y" must be tested at the SOURCE level**,
   because a behavioral test can be satisfied by the correct arrangement _and_ by
   the mutated one. This generalizes ADR-0063, where a mutation moving the RBAC
   check above the ABAC block **kept every test green**. And every source
   assertion must be **rename-proof**, or paired with an existence assertion for
   the identifier — otherwise it passes vacuously.
5. **A widening only lands after the narrowing that bounds it.** A schema column
   that changes evaluation inputs lands with a backfill that makes it a no-op,
   **plus a test proving that no-op-ness**.
6. **No new ABAC attributes except two**, and only if their wave lands:
   - `subject.principalKind` (`string`: `user|machine|delegated`, source
     `subject`). Without it a tenant **cannot** write "a partner may not
     approve", and the only alternative is a hard-coded rule no tenant can tune.
   - `resource.scopeType` (`string`, source `resource`) — a pure reprojection of
     the `requiredScopeType` the guard already reads. Zero new I/O.

   **Rejected:** `subject.groups` (groups are modelled as role granters, so
   `subject.roles` already suffices; two axes means every old policy has to be
   rewritten, and the ones that are not become silent holes);
   `subject.entitlements` / `env.planTier` (entitlement is a deny-only structural
   gate — exporting it means a tenant could write an `allow` conditioned on an
   entitlement, and _allow-as-constraint_ semantics would make a plan downgrade
   deny through another code path with another sentinel: two answers to one
   question); `resource.ownerTenantId` / `subject.partnerTenantId`
   (`tenant_isolation` already owns the cross-tenant reasoning and runs first; an
   attribute that could express a cross-tenant comparison invites policies that
   _look like_ they loosen it); and **wiring up a real `env.ipTrusted`**
   (hard-coded `false` in two places today — wiring it flips every leaf that reads
   it, a live authorization change disguised as infrastructure work; its own PR,
   with a before/after decision log diff, never bundled).

   Prerequisite before the attribute list grows at all: fix finding #9.

## 7. Ledger of gates that will go red

| Gate / test                                                                              | Goes red at                       | Cause                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access:permissions:enforcement:check`                                                   | 0.6, 0.8, 2.1, 3.5, 4.1, 5.x, 8.x | its exception list is **empty** (score 203/203); every new permission needs an enforcer **in the same PR** — [ADR-0058](../adr/0058-unenforced-permissions-disposition.md) makes one exception entry cost one ADR                                                                       |
| `admin:screen-coverage:check`                                                            | 0.6, 0.8, 1.0, 2.1, 3.5, 4.1, 5.4 | a new permission must be claimed by a screen or enter the one-way ledger; **plus** `extractScreenClaims` has to recognize the screen helper (landed as `loadAdminScreen`)                                                                                                               |
| `tests/access-assignment-writers.test.ts`                                                | 3.2                               | `WRITE_MARKER` names the old table                                                                                                                                                                                                                                                      |
| `tests/shared-rate-limit.test.ts`                                                        | 4.2 (11→13), 7.4 (13→15)          | **the easiest one to forget — it lives in a test file, not in `scripts/`**                                                                                                                                                                                                              |
| `tests/repo-inventory.test.ts`                                                           | 5.1, 7.1                          | every new global table must be declared in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` **and** in the `security-readiness.ts` privilege map                                                                                                                                                     |
| `tests/platform-scoped-permissions.test.ts`                                              | 0.6, 0.8, 4.1, 8.x                | binds code ↔ database in both directions                                                                                                                                                                                                                                                |
| `db:fk-index:check`                                                                      | every PR with a table             | [ADR-0064](../adr/0064-foreign-key-columns-must-be-index-reachable.md): one index per FK column                                                                                                                                                                                         |
| `api:consumer-contract:check`                                                            | 8.5                               | `/access/machine-credentials` is part of the frozen surface [ADR-0065](../adr/0065-awcms-astro-consumer-contract-is-frozen.md); **design the write-class field as a pure addition** whose default reproduces today's read-only behaviour — an additive subset passes, a rename goes red |
| `family:conformance:check`                                                               | 5.1 (2.6.0), 6.1 (2.7.0)          | every `MODULE_CONTRACT_VERSION` bump is paired with `awcms-family-compatibility.yaml`                                                                                                                                                                                                   |
| `tests/adr-implementation-status.test.ts`                                                | every PR with an ADR              | an ADR must drop the "not yet implemented" qualifier in the PR that lands its artifacts                                                                                                                                                                                                 |
| `skills:check`                                                                           | 1.x, 2.1, 5.4, 6.4                | rule 5: every backticked `/admin/…` URL must resolve; naming a screen that has not been built turns it red                                                                                                                                                                              |
| `check:docs:translation`, `changeset:policy`, `repo`/`project-state`/`scripts` inventory | every PR                          | mechanical; regenerate within the PR                                                                                                                                                                                                                                                    |

**A gate that will NOT go red even though it should:**
`access:chokepoint:check` stays green if `fetchGrantedPermissionKeys` is renamed,
while reporting "0 handlers decide a permission". PR 0.2 adds the
`deciding.length > 0` assertion for exactly that.

**Six new gates:** `access:decision-log:coverage:check` (0.3),
`data-lifecycle:table-coverage:check` (0.4 — **landed with a different name and
shape than planned here**; see the note below),
`access:grant-readers:check` (3.1 — only the two resolver files may read the
grant tables; today **six** files assemble their own joins, and that is how they
drift), `access:sod-fact-parity:check` (3.5),
`access:entitlement:deny-only:check` (5.1), `identity:principal-access:check`
(7.1).

**A correction to this plan, written where the plan lives (#437).** Gate 0.4 was
planned as `data-lifecycle:high-volume-coverage:check` — a gate over HIGH-VOLUME
tables. Three ways of deriving "high volume" from repo artifacts were built and
measured, and all three fail against this schema:
_append-only at the source_ (46 tables; `INSERT … ON CONFLICT DO UPDATE` reads as
an append), _no delete path_ (94 tables; this repo uses `ON DELETE CASCADE` in
**one** migration only, so "no cascade" distinguishes nothing), and
_unbounded-by-schema_ (121 of 128; the genuinely bounded tables are keyed on
curated text such as `module_key`, which cannot be told apart from free values by
reading the DDL). A gate whose exception list is 90% of the schema is a
hand-written list in disguise.

So the question was replaced: instead of deriving WHICH tables are high-volume —
which demands knowing how the product is used — just derive that a table EXISTS,
then make its obligation impossible to skip. A new table must carry a
`dataLifecycle` descriptor or a reasoned exception; the 114 existing tables sit in
a legacy ledger that may only shrink. What it **cannot** do, and does not claim:
tell you that an OLD table in that ledger is eating disk. That is a question about
traffic, and its honest home is `security:readiness` against a real database — not
a pure gate in the `check` chain.

## 8. What this program does **not** do

- **A provisioning module / the Cloudflare Tenant API.** Struck out per the
  _shape-only_ decision. The existing `tenant_domain` DNS adaptor stays as it is —
  it is deliberately confined to one zone, whereas the Tenant API demands partner
  credentials that can **permanently delete** a customer account; that is a blast
  radius of another category, so a second module, not an extension.
  The last row of the isomorphism table (`awcms_provider_accounts`, `unit_tag`,
  KYC at most 120 characters per field, and the mandatory ordering "delete the
  Logpush job, the Zero Trust Gateway configuration, and the Access organization
  **before** the account") is a **deferred design that must not be
  contradicted**.
- **SCIM.** Merely not obstructed: the `source` and `external_id` columns and
  per-tenant-user membership are the shape that `/scim/v2/Groups` will write into
  later.
- **SAML and WebAuthn.** Out of scope; `provider_type` stays `{oidc}`,
  `factor_type` stays `{totp}`.
- **Wiring up a real `env.ipTrusted`.** Its own PR, its own before/after
  decision.

## 9. How to continue

1. Read [`docs/PROJECT_STATE.md`](../PROJECT_STATE.md) §4 — the official
   continuation point.
2. Work Wave 0 in order: epic #423, children #424–#431.
3. Every PR: `DATABASE_URL="" bun run test`, then `bun run build`, then the
   **full** `bun run check` (36 segments, not a subset).
4. The DB-gated suite needs a local PostgreSQL, and the connection **must** be as
   `awcms_app` — not the migration owner. As the owner, FORCE RLS is inert and
   every tenant isolation test passes falsely.
5. For any gate you add: **mutate its source locally and make sure the gate goes
   red.** A coverage gate can be green while every one of its answers is wrong.
