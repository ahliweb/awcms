🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0073-suspension-is-a-service-state-not-a-login-state.id.md)

# ADR-0073 — `suspended` is a SERVICE state, not a login state

- **Status:** Accepted
- **Date:** 2026-08-09
- **Decision makers:** @ahliweb
- **Related:** Issue #429 (Wave 0 of #423), [`../awcms/program-model-keanggotaan-2026-08-09.md`](../awcms/program-model-keanggotaan-2026-08-09.md), [ADR-0053](0053-platform-scoped-permissions.md) (platform-scope gate + the code-side declaration principle), [ADR-0054](0054-tenant-provisioning.md) §2 (why cross-tenant actions are platform-scoped), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (machine credentials live for up to a year)

## Context

### 1. An enum that was never enforced

`awcms_tenants.status` has accepted `'suspended'` since `sql/002`. That value is
read in **four** places — `identity-access/domain/login-policy.ts`,
`application/password-reset.ts`, `application/self-registration.ts`, and
`pages/api/v1/auth/sso/[providerKey]/start.ts` — plus the public host resolver
and the platform tenant resolver.

`authorizeInTransaction` **never reads it**.

### 2. The asymmetry points the wrong way

| Surface                           | After suspension, before this ADR                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| The tenant's public site          | **dead instantly** (the host resolver demands `status = 'active'`)                             |
| New logins                        | rejected                                                                                       |
| **Already-issued admin sessions** | **full access until they expire on their own**                                                 |
| **Machine credentials**           | **untouched** — their path never touches `awcms_tenants`, and their lifetime is up to 365 days |

A suspended customer loses the thing **their visitors see** and keeps the thing
that **can change their data**. For a suspension due to abuse or a legal order,
"we took the site down but the staff can still write through the API" is not a
suspension.

### 3. Why this is cheap

`resolveTenantContext` does **not** read `awcms_tenants` — the issue's initial
assumption was wrong on that point. But `awcms_tenants` is a root table that is
deliberately RLS-free (ADR-0003), so it can be JOINed onto the tenant-user query
that **already** runs. Its status therefore comes along **with no extra
round-trip**.

### 4. A gate that one UPDATE statement can cancel is not a gate

The same principle is already written down in ADR-0053 §3 for the platform-scope
gate: the database column decides **who is granted**, the code decides **whether
the gate is asked at all**. The allow-list of "what is still permitted while
suspended" is therefore a code declaration, not a setting.

## Decision

We decided to:

**A. Enforce tenant service status at the chokepoint**, for sessions **and**
machine credentials, with `403 TENANT_SUSPENDED` and
`matchedPolicy: "tenant_suspended"`. Decided **before** permissions are looked up
— the same reason the read-only machine credential refusal directly below it uses:
the answer must not be able to depend on what the actor holds.

There is no session revocation sweep, and none is needed: the check is on the
**tenant**, not on the credential, so every live session and every machine
credential is refused from the next request onward.

**B. Treat `inactive` the same as `suspended`.** `sql/002` accepts
`active | inactive | suspended`; the login path already rejects anything that is
not `active`. Enforcing one status while letting the other be served would
reintroduce the §2 asymmetry in a smaller form.

**C. Block the admin shell for tenants whose service has stopped**, in
`resolveSsrContext`. One line there covers all 32 screens, because
`src/middleware.ts` routes every `/admin/*` through it. Without this, the
enforcement in §A stops the API and leaves the entire admin UI alive — which is
most of what an operator sees.

**D. A PERMISSION KEY based allow-list, declared in code.** The unit is the full
key, not an `AccessAction`: allowing `read` would open every read surface in every
module, which is most of the product. Widening that list **requires an ADR**, the
same discipline `MACHINE_CREDENTIAL_ALLOWED_ACTIONS` carries.

**E. The PLATFORM tenant is excluded, in two layers.** A control that can break
its own remedy is not a control.

This demands a new resolver. `resolvePlatformTenant` deliberately demands
`status = 'active'` so that "nobody is the platform" is never read as "everybody
is the platform" — correct for **authority**, and wrong for this exclusion: a
suspended platform tenant would make its resolver return `null`, the exclusion
would evaluate false, and the operator would be denied **every** action including
the one that would lift that suspension.
`resolvePlatformTenantIdIgnoringStatus` answers a different question — "which
tenant holds platform authority" — and grants nothing: platform-scoped permissions
still go through `resolvePlatformTenant` and its active check, unchanged.

The second layer: the `suspend` endpoint **refuses** to suspend the platform
tenant with `409 PLATFORM_TENANT_PROTECTED` — a comprehensible message instead of
a locked door.

**F. `disable` and `restore` are TWO permissions**, both `scope: platform`. During
an incident you want someone who can bring a customer back **without** being able
to cut a customer off — the same split `machine_credentials` already drew between
`create` and `revoke`.

## Consequences

- **Positive:** suspension becomes real across every surface; year-long machine
  credentials stop being a hole; the transition is recorded append-only in the
  **target** tenant's audit trail, so the customer can see their service being
  stopped, by whom, and why.
- **Negative / trade-off:** the SSR block is all-or-nothing, unlike the
  per-permission allow-list at the chokepoint. Today no screen is needed by a
  suspended tenant (billing arrives in Wave 5); when one is, that branch will have
  to grow the same allow-list. Noted in the code so it is found at that moment.
- **Negative:** a suspended tenant opening `/admin` is redirected to `/login`,
  which then also rejects them. The messaging is bad. It is still far better than
  full admin access, and fixing it is screen work.
- **Neutral:** two new permissions reach the SETUP tenant through the migration. A
  deployment whose platform tenant is not the setup tenant must run
  `bun run identity-access:permissions:backfill` — an already-recorded pitfall.
- **Neutral:** the button does not exist yet. `/admin/tenants` already lists every
  tenant along with its status, so this is a screen edit, not a new surface; both
  keys go into `NOT_YET_SCREENED`, which is only allowed to shrink.

## Alternatives considered

- **Revoking all sessions on suspend instead of checking at the chokepoint** —
  rejected. It does not touch machine credentials at all, and a sweep is a one-off
  event that any credential issued afterwards slips past. Checking the tenant
  closes both, forever, with no background work.
- **Enforcing only `suspended`, leaving `inactive`** — rejected, §B.
- **An `AccessAction` based allow-list** — rejected, §D: so coarse as to be
  meaningless.
- **The allow-list as a column/setting** — rejected, §4. A suspension that a row
  can silently cancel is not a suspension.
- **One permission for both suspend and restore** — rejected, §F.
- **Allowing the platform tenant to be suspended, with a warning** — rejected, §E.
  There is no in-band recovery, and a warning is not a control.
