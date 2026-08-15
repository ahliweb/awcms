🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](02-model-tenant-merchant-otorisasi.id.md)

# 02 — Tenant, merchant, role, and authorization

> Plan. See the [README](README.md) for status.

This document is the security backbone of the Jualanku porting. One sentence must
be held onto: **RLS separates tenants, not merchants.** Everything else below
exists because of that sentence.

## 1. Pilot tenant model

One operator tenant (`JUALANKU_MAIN`). Merchants, memberships, affiliates,
catalogue, and activity are **domain entities inside that tenant** — not tenants
of their own. The consequences:

- The cross-merchant directory, the shared taxonomy, the moderation queue, and
  platform reporting stay ordinary queries within a single tenant.
- Isolation between merchants is **not free** and has to be built (sections 2–4).
- A multi-operator/white-label model stays open for later precisely because
  merchant isolation does not ride on the tenant boundary.

## 2. Six layers of isolation

| Layer      | Separates              | Control                                                                                  | What its failure looks like                                    |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Tenant     | Operator/white-label   | PostgreSQL `FORCE` RLS + tenant context from the server                                  | Cross-operator leak                                            |
| Merchant   | Businesses in a tenant | Merchant as a **business scope** + membership grant + ownership predicate in every query | Merchant A reads/writes merchant B's data                      |
| Role       | Kind of action         | RBAC permissions seeded by migration + `configure`/`approve` separate from `read`        | An editor changes the bank account                             |
| Workflow   | Maker/checker/approver | `workflow_approval` + `sodRules` (ADR-0031)                                              | The payout's creator approves their own payout                 |
| Data field | PII & financial        | Per-purpose projection + masking (`_shared` identifier masking)                          | NIK/bank account leaks through an endpoint that "merely" lists |
| Surface    | Public/portal/internal | Route namespace, session audience, `noindex`, cache policy, security headers             | A private page ends up in the sitemap or in a public cache     |

## 3. Merchant as a business scope

This repo already has a scope-based authorization layer (ADR-0030) with the port
`src/modules/_shared/ports/business-scope-hierarchy-port.ts`. Its base
implementation returns `resolved: false` for **every** scope type, and the caller
must **default-deny high-risk actions** when `resolved: false`. Which means: as
long as no module provides the hierarchy, high-risk merchant actions fail closed —
safe, but also non-functional.

The design:

- `jualanku_directory` **provides** the scope hierarchy capability for the
  `merchant` type. One merchant = one scope; future business groups/networks
  become parent scopes without changing any caller.
- **Merchant membership = a scope grant**, with effective dating (`valid_from`,
  `valid_until`). Revocation takes effect immediately because the evaluation uses
  server `now`, not a boolean column somebody has to remember to set.
- **Assisted onboarding ("Pasukan Semut") = a time-bounded scope grant** to a
  single merchant. The assistant never gets a global role.
- ABAC policies refer to `resource.businessScopeId` — an attribute that
  **already exists** in the allow-list. No new attribute is added for Jualanku
  (see [08](08-koreksi-dokumen-validasi.md) §3).

**Two safety belts, not one.** ABAC is the policy layer; the second layer is the
**ownership predicate in the query**. Every merchant-scoped SELECT/UPDATE/DELETE
carries `merchant_id IN (<resolved scope grants>)`. If one day a policy is
written wrong, the query still returns no rows belonging to somebody else.

## 4. Role catalogue

The role codes below are ordinary `awcms` tenant roles; their permissions are
seeded via migration (a module descriptor alone does **not** give permissions to
an already existing tenant).

| Persona              | Role code           | Main boundary                                                                  |
| -------------------- | ------------------- | ------------------------------------------------------------------------------ |
| SaaS owner           | `platform_owner`    | Governance & break-glass; not a day-to-day role, every use is audited.         |
| Platform admin       | `platform_admin`    | Operational configuration; does **not** approve payouts.                       |
| Merchant verifier    | `merchant_verifier` | Assesses evidence; touches neither payouts nor the catalogue.                  |
| Content moderator    | `content_moderator` | Moderates listings, reviews, complaints.                                       |
| Customer success     | `customer_success`  | Onboarding & support; access to sensitive data is purpose-limited.             |
| Finance maker        | `finance_operator`  | Prepares payouts/invoices.                                                     |
| Finance checker      | `finance_approver`  | Approves payouts; **must not** be their creator (SoD).                         |
| Risk/compliance      | `risk_compliance`   | Legal hold, audit, policy, fraud review.                                       |
| Merchant owner       | `merchant_owner`    | Manages their own merchant + memberships.                                      |
| Merchant editor      | `merchant_editor`   | Content/catalogue; **without** bank accounts, legal identity, plans, or roles. |
| Merchant analyst     | `merchant_analyst`  | Read-only analytics for their own merchant.                                    |
| Affiliate            | `affiliate_member`  | Their own links, conversions, and payouts.                                     |
| Onboarding assistant | `onboarding_agent`  | Only the merchants assigned to them, for the assignment's validity period.     |

The last three roles plus `merchant_*` **never** get any internal module
permission, and have no navigation entry into `/admin/**`.

## 5. Permission shape

The permission key in this repo is `${moduleKey}.${activityCode}.${action}`, and
`action` must be one of the **already existing** `AccessAction` values
(`src/modules/identity-access/domain/access-control.ts`). There is no `submit`,
no `payout`, no `verify` — using an action that is not in the union produces a
permission that is never seeded and a silent deny against even the owner.

The mapping used:

| Business intent                            | Action used         | Reason                                                                    |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| Viewing data                               | `read`              | —                                                                         |
| Creating/editing an entity                 | `create` / `update` | —                                                                         |
| Submitting a verification/payout           | `create`            | A submission = creating a case/request, not a new action.                 |
| Approving a verification/payout/moderation | `approve`           | High-risk; its SoD counterpart is `create`.                               |
| Rejecting                                  | `reject`            | Present in the union; non-high-risk — a negative decision moves no money. |
| Publishing a business page                 | `publish`           | Already used by this repo's content lifecycle.                            |
| Disabling a merchant/affiliate             | `disable`           | —                                                                         |
| Restoring something soft-deleted           | `restore`           | —                                                                         |
| Changing policy/commission/plan            | `configure`         | Not `update` — policy authoring is a class of its own.                    |
| Assigning an assistant/role                | `assign`            | —                                                                         |
| Exporting a report                         | `export`            | Produces an artifact; high-risk for PII/financial data.                   |

Every action in that table already existed in the union when this document was
written (`read`, `create`, `update`, `approve`, `reject`, `publish`, `disable`,
`restore`, `configure`, `assign`, `export`). Adding a new union value needs its
own ADR — and a permission using an unseeded action will _deny_ even the tenant
owner, green in CI because nothing tests it.

## 6. Mandatory ABAC rules

Written with the attributes present in the allow-list (`subject.roles`,
`subject.tenantUserId`, `resource.businessScopeId`, `resource.ownerTenantUserId`,
`resource.status`, `resource.resourceType`, `resource.amount`, `action`,
`env.now`, `env.ipTrusted`).

1. **Merchant ownership.** Access to a merchant-typed resource is only allowed if
   `resource.businessScopeId` is among the subject's scope grants active at
   `env.now`. A `resolved: false` from the hierarchy resolver = **deny** for
   high-risk actions.
2. **An editor is not an owner.** `merchant_editor` is denied on resources typed
   bank account, legal identity, ownership, subscription, and role assignment —
   an explicit deny, because deny beats allow.
3. **An approver is not the creator.** `finance_approver` is denied approving a
   payout whose `resource.ownerTenantUserId == subject.tenantUserId`. This is an
   ABAC deny **and** `sodRules`; both, because just one is a single point of
   failure.
4. **An assistant only has an active assignment.** Same as (1), with a
   time-bounded grant; expiry takes effect at `env.now`, with no cleanup job.
5. **An affiliate must not self-refer.** A conversion whose
   identity/payment-instrument/merchant is classified as a self-referral is
   rejected for attribution and payout.
6. **Break-glass leaves a trail.** `platform_owner` may cross certain boundaries
   only through the existing break-glass path, always audited, and with
   `env.ipTrusted` taken into account.
7. **Resource attributes always come from the real row.** The endpoint reads the
   resource first, then assembles `resourceAttributes`. The `merchantId` in the
   body is validated input, not a trusted claim.

## 7. Negative-authorization test matrix

These tests are written **before** the implementation and must be red first.
Green from the start = the test tests nothing.

| #   | Scenario                                                                     | Expectation                                                                   |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Merchant A reads merchant B's catalogue/leads/analytics                      | 404 anti-oracle (not a 403 that confirms existence)                           |
| 2   | Merchant A changes `merchantId` in the body to merchant B                    | Ignored; the resource owner is taken from the server. No write to merchant B. |
| 3   | `merchant_editor` changes the bank account/legal identity                    | 403 + decision log; no row changes                                            |
| 4   | `finance_approver` approves a payout they created themselves                 | 409/403 `SOD_CONFLICT` + audit                                                |
| 5   | An affiliate opens another affiliate's payout/conversion                     | 404 anti-oracle                                                               |
| 6   | An assistant opens a merchant outside their assignment, or after expiry      | 403; expiry takes effect with no job                                          |
| 7   | A merchant session calls `/api/v1/jualanku/admin/*`                          | 403 before the business service can run                                       |
| 8   | The Jualanku module is disabled for the tenant, the endpoint is still called | 403 `MODULE_DISABLED`                                                         |
| 9   | Another tenant's session is used on the Jualanku host                        | Rejected before the business service                                          |
| 10  | The public API asks for a draft or moderation-rejected merchant/product      | Not found; drafts never enter the public projection                           |
| 11  | The scope hierarchy resolver returns `resolved: false`                       | High-risk actions **deny**, not slip through                                  |
| 12  | A payout is approved twice (retry/double submit)                             | Idempotent: one effect, one ledger entry                                      |
| 13  | Cross-tenant: another tenant's merchant row accessed as `awcms_app`          | 0 rows (RLS proven, tested as the application role, not a superuser)          |

RLS tests **must** be run as the application role (`awcms_app`), not as a
superuser. On a PaaS that makes the default Postgres user a superuser, `FORCE`
RLS is silently inert while migrations stay green.

## 8. Audit & decision log

- Every access decision (allow as well as deny) over a merchant-scoped resource
  goes into the decision log; a deny caused by `resolved: false` is recorded with
  its reason, so that "why can this merchant do nothing" can be answered without
  guessing.
- High-risk actions (verification, moderation, payout, plan change, bank account
  change, assistant assignment, data export) must have an audit event with actor,
  resource, outcome, and correlation ID; PII is reduced/masked in the log payload.
- Personal data export and recovery (restore/purge) follow the `data_lifecycle`
  flow and honour legal holds.
