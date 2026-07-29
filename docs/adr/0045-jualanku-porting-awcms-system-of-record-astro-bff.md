# ADR-0045 — Jualanku.info porting: `awcms` is the system of record, `awcms-astro` is the BFF experience layer

- Status: Accepted
- Date: 2026-07-29
- Related: [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  (domain modules live directly in `src/modules/`), [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md)
  (online-first superset positioning), [ADR-0030](0030-business-scope-hierarchy-generic-authorization-layer.md)
  (business-scope authorization layer), [ADR-0033](0033-abac-dynamic-policy-evaluator.md)
  (bounded ABAC attribute allow-list), [ADR-0031](0031-segregation-of-duties-conflict-enforcement.md)
  (SoD), [ADR-0026](0026-modular-openapi-ownership-and-composition.md) (modular
  OpenAPI ownership), [ADR-0009](0009-public-tenant-scoped-routes.md)
  (path-scoped public routes), [ADR-0044](0044-merge-news-portal-into-blog-content.md)
  (one content module). Source of the request: _"Validasi Arsitektur dan Standar —
  Porting UI/UX Jualanku.info ke AWCMS dan AWCMS-Astro"_ v1.0, PT TIM SIX,
  29 July 2026 (`APPROVE WITH CORRECTIONS`).

## Context

Jualanku.info is a merchant directory + seller portal + affiliate programme whose
UI/UX exists only as an Elementor prototype. A steering-level validation document
approved building it on two repositories of this family — `awcms` for the
business platform and `awcms-astro` for the public/portal experience — on the
condition that a set of P0 architecture decisions is recorded first. This ADR is
that record for `awcms`; the rendering/runtime half is recorded in `awcms-astro`'s
own ADR, because the change it describes (adapter, deployment, on-demand routes)
happens in that repository.

Four facts were checked against this repo's code before deciding, because the
validation document reasons partly from documentation and documentation drifts:

**1. The module registry holds 20 modules, and `news_portal` is not one of them.**
The validation document flags an inventory inconsistency (README saying 21,
architecture doc saying 20, `news-portal` documented but absent). The finding is
real, but the cause is the opposite of "a module is missing": `news_portal` was
_merged into_ `blog_content` by ADR-0044, and `README.md`/`docs/ARCHITECTURE.md`
were not updated. `src/modules/index.ts` is the only inventory this ADR treats as
authoritative; the stale prose is corrected in the same change as this ADR.

**2. Session handling is not bearer-only — but it is same-origin.**
`resolveAuthInputs()` (`src/modules/identity-access/application/access-guard.ts`)
already accepts either the `authorization`/`x-awcms-tenant-id` headers **or** the
httpOnly session/tenant cookies the admin SSR shell sets at login. What is
genuinely missing is different and narrower: `GET /api/v1/auth/me` is bearer-only,
and there is no introspection contract a **separate origin** can call on behalf of
a browser it does not share cookies with. The gap is a cross-origin portal session
contract, not cookie support.

**3. Merchant ownership has no home in the ABAC attribute allow-list — but it has
one in the business-scope layer.** `ABAC_ATTRIBUTES`
(`src/modules/identity-access/domain/abac-policy.ts`) is a closed allow-list;
an unknown attribute is invalid at authoring time and denies at evaluation time.
There is no `subject.merchantIds`/`resource.merchantId` in it, and adding bespoke
per-product attributes to a bounded list is how such lists stop being bounded.
There is, however, `resource.businessScopeId`, plus the business-scope hierarchy
port (ADR-0030) whose base implementation returns `resolved: false` for every
scope type so that high-risk actions fail closed until a module supplies the real
hierarchy. Merchants are exactly that kind of hierarchy.

**4. RLS separates tenants, and only tenants.** Every tenant-scoped table is
`FORCE`-RLS'd against the tenant GUC. With one operator tenant holding many
merchants, RLS is silent about merchant A reading merchant B. Nothing in the
current code closes that; it must be built.

## Decision

**1. The two repositories keep the responsibility split, and the browser never
talks to `awcms`.** `awcms` owns domain services, policy, workflow, audit,
reporting, the internal admin SSR shell, and the database. `awcms-astro` owns
public pages, the seller/affiliate portals, and the only Backend-for-Frontend.
`awcms` is deployed on a private origin (or an origin restricted to the
experience layer's service identity); a public route on `awcms` exists only where
this repo already ships one (`/blog/{tenantCode}/*`, the SEO discovery routes,
`/search`).

**2. The BFF orchestrates and projects; it never decides.** `_portal-api/*` in
`awcms-astro` may resolve session, set tenant context, enforce CSRF/Origin, shape
view models, and mask fields. Entitlement checks, ownership checks, state
transitions, ledger writes, and validation invariants live in `awcms` application
services and are re-checked there for every call, including calls that the BFF
believes it already validated.

**3. Jualanku ships as domain modules directly in `src/modules/`, and as five
bounded contexts, not seven.** Per ADR-0034 there is no derived repository and no
extension registry. The modules are `jualanku_directory`,
`jualanku_catalog_growth`, `jualanku_affiliate`, `jualanku_commercial`, and
`jualanku_trust_operations`, each `type: "domain"`, each owning its own tables
under the `awcms_jualanku_*` prefix. Splitting further is a decision to be made
from measured coupling, not from the shape of the org chart.

**4. Merchant isolation is enforced in three places, and never assumed from
RLS.**

- **Tenant layer** — unchanged: `FORCE` RLS keyed on the tenant GUC.
- **Scope layer** — a merchant is a **business scope**. `jualanku_directory`
  provides the `business_scope_hierarchy` capability (ADR-0030) for the
  `merchant` scope type, so the resolver stops returning `resolved: false` for
  merchants and high-risk merchant actions stop failing closed for the wrong
  reason. Merchant membership and time-boxed assisted-onboarding assignments
  become scope grants with effective dating.
- **Query layer** — every merchant-scoped read and write carries an ownership
  predicate derived from the resolved scope grants, and every
  `resourceAttributes` value handed to the ABAC evaluator is read from the
  stored row. A `merchantId` in a request body is input to be validated, never a
  claim to be trusted.

ABAC policies express merchant rules through `resource.businessScopeId`,
`subject.roles`, `resource.status`, and `resource.ownerTenantUserId`. The
attribute allow-list is **not** extended for Jualanku.

**5. `identity_access` gains a session-introspection contract for
cross-origin portals.** A new endpoint returns _safe claims only_ (identity id,
tenant, display name, roles, assurance level, merchant/affiliate scope
references) for a session presented by the BFF; it never returns tokens,
password state, MFA secrets, or PII beyond what a portal header needs. Session
minting, rotation, revocation, and MFA/step-up remain owned by `awcms`; the BFF
holds no identity store, and logout at the portal revokes upstream before it
clears its own cookie.

**6. Public, portal, and admin namespaces are three policies over one service.**
`/api/v1/jualanku/public/*`, `/api/v1/jualanku/portal/{merchant,affiliate}/*`,
and `/api/v1/jualanku/admin/*` differ in authentication, authorization, input
surface, and response projection. They must not differ in business rule, and a
rule implemented twice is a defect regardless of whether the two copies currently
agree.

**7. Internal administration stays in `awcms` SSR under `/admin/jualanku/*`,
default-deny.** Merchant and affiliate principals get no role, no route, no
navigation entry, and no session audience that reaches it. Hiding a menu is not a
control; the endpoint and the server-rendered page are.

**8. Money and trust artifacts are append-only.** Commission entries and payout
ledger movements are inserted, never overwritten; corrections are reversals or
adjustments. Payout preparation and payout approval are distinct permissions,
enforced as an SoD rule (ADR-0031) and a workflow, so the same subject cannot do
both.

**9. The standards baseline is refreshed to the versions current at this date.**
WCAG 2.2 AA (ISO/IEC 40500:2025), OWASP ASVS 5.0 profile L2 for portal and admin
surfaces, OWASP API Security Top 10:2023, ISO/IEC 27701:2025, ISO/IEC 27018:2025,
ISO/IEC 15408 Parts 1–5:2026 applied narrowly to the session/authorization
components, ISO/IEC 27017:2026 on transition watch. No certification is claimed
anywhere in the product or its documentation.

**10. Nothing production-facing is built until the P0 gates close.** The gates
are: this ADR plus the `awcms-astro` rendering ADR accepted; the module inventory
reconciled; the session/CSRF/tenant contract specified and covered by tests; the
merchant/business-scope data model and its negative-authorization matrix agreed;
and the five module descriptors plus table ownership fixed. The design that
implements those gates lives in [`../awcms/jualanku/`](../awcms/jualanku/README.md);
that folder is a blueprint, and no part of it is a claim that code exists.

## Consequences

**Positive.**

- Merchant isolation reuses an authorization layer that is already fail-closed,
  already audited, and already exercised by SoD and business-scope tests, instead
  of a per-product ownership check that would exist only in Jualanku's own code
  paths.
- The ABAC attribute allow-list stays bounded — the property that makes it worth
  having.
- The public site keeps the cache and SEO characteristics of a static build,
  while only genuinely personalized routes pay for on-demand rendering.
- One application service per use case means the public projection cannot drift
  away from the admin's view of the same rule.

**Negative / trade-offs.**

- The BFF is an extra hop, an extra deployment, and an extra place where a
  developer in a hurry can put a business rule. That risk is real and is
  mitigated by review, not by architecture alone.
- Modelling merchants as business scopes couples `jualanku_directory` to the
  scope contract: a change to the hierarchy port becomes a change with a
  Jualanku-shaped blast radius.
- Five modules across two repositories is more coordination than one module in
  one repository would be, and cross-module reads must go through capability
  ports or read models rather than a convenient join.

**Neutral.**

- The single-operator-tenant model (`JUALANKU_MAIN`) is a pilot decision, not a
  platform one. Multi-operator/white-label remains possible precisely because
  merchant isolation was not built on the tenant boundary.
- No migration, module descriptor, route, or OpenAPI fragment is added by this
  ADR. The next unit of work adds them, one bounded context at a time, each with
  its own migrations, permission seed, negative-authorization tests, and
  changeset.

## Alternatives considered

- **One `jualanku` module.** Fastest start, and the fastest route to a permission
  catalogue nobody can reason about: directory reads, payout approvals, and
  moderation decisions would share one activity namespace and one table owner.
- **Seven modules, as originally proposed.** Boundaries drawn from the menu
  structure rather than from invariants and data ownership. It multiplies
  cross-module events and capability ports before there is evidence any of those
  boundaries carry weight.
- **One tenant per merchant.** RLS would then isolate merchants for free — and
  the cross-merchant directory, shared taxonomy, moderation queue, and
  platform-wide reporting that the product exists to provide would all become
  cross-tenant queries, which this platform correctly makes hard.
- **A bespoke `subject.merchantIds`/`resource.merchantId` attribute pair.**
  Direct and readable, but it turns a bounded allow-list into a growing one: the
  next domain asks for its own pair, and the fail-closed guarantee erodes one
  reasonable request at a time.
- **Browser calls `awcms` directly with a bearer token.** Removes the BFF hop and
  puts a token in browser storage, tenant selection in the client's hands, and
  the CORS surface of an ERP API on the public internet.
