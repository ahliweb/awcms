🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0053-platform-scoped-permissions.id.md)

# ADR-0053 — Platform-scoped permissions, held by the default tenant's owner

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision maker:** @ahliweb
- **Refines:** [ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md) — restores the HTTP surface for region dataset activation/rollback, now behind the gate that ADR set as its precondition. Its operator job **remains**.
- **Fulfils:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) §Decision items 1–3 (a platform-scoped gate for cross-tenant actions) — normative until now without a primitive
- **Related:** [ADR-0046](0046-idn-admin-regions-module-admission.md) (`idn_admin_regions` admission), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (read-only machine credentials), [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) §3/§4 (foundation features pioneered here + must be recorded as a divergence)

## Context

ADR-0051 wrote this rule down as a norm:

> An action whose effect crosses tenant boundaries **must have a platform-scoped gate**, not merely tenant RBAC. A cross-tenant action **must not** enter the catalogue seeded to tenant roles.

The rule is correct and already in force — but **its primitive never existed**. That is why ADR-0052 could not gate region dataset activation/rollback; it could only **delete them**, noting that the operator screen may come back "if it is genuinely needed one day… this ADR only refuses to ship the surface before its gate exists".

That screen is now needed, and this is its gate.

### The defect that was never actually fixed

`sql/084` deleted two permission rows. What **produces** the defect is still intact, in `bootstrapPlatformTenant`:

```ts
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT ${tenantId}, ${roleId}, id FROM awcms_permissions
```

Every tenant created receives the **entire** catalogue. Deleting two rows closes one instance of it; **the class comes back with the next cross-tenant action anyone adds**. As long as that statement cannot exclude a population, the only protection left is that nobody ever declares such a permission again — and that is not a protection.

## Decision

### 1. `awcms_permissions.scope` — `tenant` | `platform`

`sql/085` adds the column, `DEFAULT 'tenant'` (which is exactly what every existing permission means, so its backfill is zero hand-written rows). `ModulePermissionDescriptor.scope` declares it in code; `MODULE_CONTRACT_VERSION` rises to **2.5.0** (MINOR — additive, omitting it means `tenant`).

The bulk grant is now `WHERE scope = 'tenant'`. The intended consequence: **the next platform permission is safe from the moment it is declared** — with nobody needing to remember.

### 2. The platform tenant = the default tenant, resolved env-first

`PLATFORM_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE` → `awcms_setup_state.tenant_id`.

Its default is **deliberately the same chain** as the public resolver: in a single-tenant deployment both are the same tenant, and a second answer would only be a second thing to keep in sync. The authority falls to that **tenant's `owner` role** — no new role, no new flag.

One asymmetry against the public resolver, deliberate: a `PLATFORM_TENANT_ID` that is **set but cannot be resolved** (not a UUID, tenant does not exist, tenant inactive) yields `null` and **refuses every platform action** — it never falls through to the next step. For RENDERING, falling to the next candidate is graceful; for AUTHORITY, it hands the right to a tenant nobody named.

### 3. The gate is at the chokepoint, not at the screen

`authorizeInTransaction` refuses a platform-scoped permission unless the acting tenant **is** the platform tenant — decided **before** permissions are looked at, in the same class as the read-only refusal for machine credentials (ADR-0049 §3). So a stray grant row (a restored backup, a hand-written `INSERT`, a future provisioning path that forgets the filter) becomes **inert**, not sufficient.

Its trigger is read from the **code declaration**, not from the DB column. If both came from the DB, a single `UPDATE` flipping `scope` back to `'tenant'` would revoke the gate and the filter at once — a cross-tenant action with no guarding whatsoever, with every check still green. The DB column decides **who is granted**; the code decides **whether the gate is asked**. `tests/platform-scoped-permissions.test.ts` binds the two in both directions.

### 4. Tenancy mode is derived, never configured

`single` while the platform tenant is the only active tenant; `multi` from the second one onwards. There is no toggle: a stored flag would have to be flipped by whoever provisions the second tenant, and forgetting means the deployment keeps behaving as if one tenant owns everything — exactly the assumption that has to stop holding.

**Mode never loosens the gate.** Enforcement is identical in both modes; `single` only changes what the screen explains. Otherwise the security posture would depend on the result of a `COUNT(*)`.

### 5. The surface that comes back

`POST /api/v1/idn-regions/datasets/{id}/activate` and `/rollback` are restored behind a platform permission, plus the `/admin/idn-regions` screen.

ADR-0052's audit objection is **answered, not ignored**: `recordAuditEvent` is tenant-scoped, which used to mean the row landed in the log of whichever tenant happened to press the button. Now it can only land in the **platform tenant's** log — where a platform action should be recorded.

Its operator job (`bun run idn-regions:activate` / `:rollback`) is **kept**: CI, recovery shells, and deployments whose platform tenant cannot log in all need a non-HTTP path.

## Consequences

- **Positive:**
  - The class of defect is closed, not the instance. The bulk grant can no longer leak cross-tenant authority, today or for the next platform permission.
  - Two independent mechanisms (the grant filter + the chokepoint gate), so failure of either one is not enough.
  - A genuine SaaS precondition. The tenant provisioning path — which does not exist yet — now has the right place to stand: it inherits the `scope` filter instead of repeating the defect.
- **Negative / accepted trade-offs:**
  - **While `PLATFORM_TENANT_ID` is empty, `PUBLIC_DEFAULT_TENANT_ID` is a security control.** Repointing which site is served on an unmatched host also repoints platform authority. This is a conscious decision (one knob while the two really are the same tenant), made safe to leave behind through a separate variable that only needs filling in — and **made visible**: `security:readiness` reports which tenant holds that authority.
  - One extra query per request — **only** for platform-scoped permissions. Ordinary requests do not touch it at all.
  - `awcms_permissions` gains a column: every new permission seed now has a question that has to be answered. That is the point.
- **Neutral:**
  - Zero behaviour change for single-tenant deployments: the bootstrap tenant is the platform tenant, and its owner receives both permissions through `sql/085`.

## Alternatives considered

- **Leave it job-only (ADR-0052's status quo)** — rejected for the reason ADR-0052 itself called temporary: a legitimate platform operation must not demand shell access forever, and the absence of a gate is a shortcoming that can be fixed, not a law of nature.
- **Gate it with machine credentials** — rejected again, on ADR-0052's reasoning: machine credentials are **read-only** (ADR-0049 §3), so widening them would let a leaked build token replace a global dataset. Worse than the defect being fixed.
- **A global "superadmin" role/flag** — rejected: it introduces a subject outside the tenant model, so RLS, the decision log, and audit all need special cases. The platform tenant as an ordinary tenant keeps the entire existing chain applicable as-is.
- **A pure DB anchor (`awcms_setup_state` only, no env)** — proposed and **rejected by the decision maker** in favour of one definition of "default tenant" shared with `awcms-astro`. The risk is stated in §Consequences and made separable without a migration through `PLATFORM_TENANT_ID`.
