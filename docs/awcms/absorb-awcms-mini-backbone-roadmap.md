🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](absorb-awcms-mini-backbone-roadmap.id.md)

# Roadmap for Absorbing the awcms-mini Backbone → awcms

> **Read through the lens of [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md) (2 August 2026):**
> `awcms-mini`/`awcms-micro` are now **archives**, so this document is a list of
> **capability needs**, not a port queue. Each item enters through **its own
> admission ADR and is built in this repo**; archive code may be read as a
> specification/reference, not as a source that gets ported.

> **Companion to** [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md), not
> its replacement. The micro roadmap absorbs the **website/e-commerce** cluster; this
> document absorbs the **business foundation + SaaS control plane** cluster from `awcms-mini`.
> Both share one migration numbering queue; that remains true for any migration
> written here, but it is no longer the order of scheduled work.
>
> **Decision sources:** [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
> (`awcms` = online-first hybrid, **ERP + integrated SaaS ready**) and
> [ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
> (domain modules live **directly** in `src/modules/`, with no derived repo).
>
> `awcms-mini` (`/home/data/dev_react/awcms-mini`) may be read as a historical
> reference. It is **not** a "port source repo": a desired capability is built here
> through its own admission ADR (ADR-0055 §1).

## 1. The finding that produced this document

The 2026-07-25 audit of `docs/adr/` vs `src/modules/` found:

**Five modules are already `Accepted` by an ADR in THIS repo, but there is no code for them.**

| ADR (status `Accepted` in awcms)                                | Module admitted           | Present in `src/modules/`? | Present in mini? |
| --------------------------------------------------------------- | ------------------------- | -------------------------- | ---------------- |
| [0016](../adr/0016-organization-structure-module-admission.md)  | `organization_structure`  | ❌ **no**                  | ✅ mature        |
| [0017](../adr/0017-document-infrastructure-module-admission.md) | `document_infrastructure` | ❌ **no**                  | ✅ mature        |
| [0018](../adr/0018-data-exchange-module-admission.md)           | `data_exchange`           | ❌ **no**                  | ✅ mature        |
| [0019](../adr/0019-integration-hub-module-admission.md)         | `integration_hub`         | ❌ **no**                  | ✅ mature        |
| [0021](../adr/0021-reference-data-module-admission.md)          | `reference_data`          | ❌ **no**                  | ✅ mature        |

In addition [ADR-0020](../adr/0020-erp-extension-readiness-contracts.md) (ERP
extension readiness contracts) has status `Accepted` and has
[`erp-extension-contracts.md`](erp-extension-contracts.md), but there is **no
implementation** of it in `src/modules/_shared/`.

This is the inverse of the usual failure mode: not code without docs, but **repo
rules that already promise a foundation layer that has never been built**. The
practical consequence — an agent (or a human) reading `docs/adr/` will conclude
that `organization_structure` can be called. It cannot.

**The SaaS control plane cluster has not been admitted here at all.** Seven modules
in mini (`service_catalog`, `tenant_entitlement`, `usage_metering`,
`tenant_provisioning`, `tenant_lifecycle`, `subscription_billing`,
`payment_gateway`) run under **mini's own ADR-0022**. Number 0022 in this repo is
used for a different ADR and is already _superseded_
([0022 — ERP modules live in extension repos](../adr/0022-erp-modules-live-in-extension-repos.md),
replaced by ADR-0034). So this cluster **needs a new admission ADR in awcms**
before a line of its implementation may be worked on.

## 2. Absorption rules (mandatory per module)

Same as the micro roadmap — **adapt, do not copy**:

1. **Delta analysis first.** Do not regress awcms capabilities that are already
   further ahead (auth: MFA/OIDC/SSO/ABAC-DSL/business-scope/SoD/Turnstile/break-glass).
2. **Rename the prefix** `awcms_mini_` → `awcms_` (tables, GUCs, constants, env,
   permission catalogue).
3. **Migration numbering continues, tightly packed** from the current highest (as of
   2026-07-25 `sql/068`), sequential with no gaps. Gaps in mini are NOT carried over.
4. **RLS `ENABLE` + `FORCE`** for every tenant-scoped table; test under the
   `awcms_app` **LOGIN** role, not a superuser — a superuser bypasses RLS even with
   FORCE, so verifying as a superuser proves **nothing**.
5. **Per-tenant opt-in, default-disabled** — every module in this document is an
   _Official Optional Business Foundation_. Pure base must keep working without a
   single one of these modules.
6. **Keep the contracts in sync**: per-module OpenAPI fragment + bundle (ADR-0026),
   AsyncAPI for new events, frozen add-only snapshot.
7. **Tests** unit + integration (two-world) + contract + security; module **docs +
   skill**; **changeset**; register it in `src/modules/index.ts`.
8. **Pass the FULL `bun run check`** before the PR.

`MODULE_CONTRACT_VERSION` is raised **one additive MINOR per new contribution
seam**, always accompanied by updating the `contracts.moduleDescriptorContractVersion`
pin in `awcms-family-compatibility.yaml` (or `family:conformance:check` goes red).

## 3. Waves & dependency order

### Wave A — business foundations that are ALREADY admitted (no new ADR)

Worked in order: `reference_data` first because the next three modules consume its
value sets.

| #   | Module                    | Admission ADR (existing) | Port notes                                                                                                                                                                                                                  |
| --- | ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `reference_data`          | ADR-0021                 | **GLOBAL** value sets (no `tenant_id`, a reviewed RLS exemption, ADR-0021 §8) + per-tenant overrides, effective-dated. Note: the RLS exemption here is deliberate and must be carried over intact along with its reasoning. |
| 2   | `organization_structure`  | ADR-0016                 | Tenant-scoped legal entities + organisational units. ADR-0013 §2/§4 vocabulary (tenant ≠ legal entity ≠ unit). Depends on `logging` for audit.                                                                              |
| 3   | `document_infrastructure` | ADR-0017                 | Generic document METADATA only — not a domain document schema. Reconcile with the existing `media_library` (ADR-0036) so that file ownership does not overlap.                                                              |
| 4   | `data_exchange`           | ADR-0018                 | Staged CSV/JSON import/export; per-module contribution descriptor, formula-injection neutralisation, resumable idempotent commit.                                                                                           |
| 5   | `integration_hub`         | ADR-0019                 | Signed inbound webhooks, per-endpoint HMAC + overlapping rotation, replay protection via DB uniqueness. First check whether it collides with `sync-storage`.                                                                |

### Wave B — SaaS control plane (**needs a new admission ADR first**)

> **Governance blocker.** Not a single line below may merge before the awcms SaaS
> control plane admission ADR is `Accepted` (adapting mini's ADR-0022: admission,
> boundaries, trust model, lifecycle contracts). That is the same precedent mini
> enforced through its acceptance criterion #869, and the reason is the same: seven
> modules that consume each other's contracts will harden into the wrong shape if
> their boundaries are only set after three of them are done.

The contract consumption order (from mini) dictates the port order:

| #   | Module                 | Provides / consumes                                                                                              |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `service_catalog`      | Versioned PLANs, immutable-once-published OFFERs, entitlement grants, quotas. The foundation for the other six.  |
| 2   | `tenant_entitlement`   | Resolution of effective entitlements per tenant. The cluster's "heart".                                          |
| 3   | `usage_metering`       | Numeric meter events through the `usage_append` port (the event table = a transactional outbox).                 |
| 4   | `tenant_provisioning`  | Idempotent & resumable provisioning runs. **The automatic subdomain junction point** (§4).                       |
| 5   | `tenant_lifecycle`     | SaaS lifecycle state machine; the `lifecycle_transition` contract.                                               |
| 6   | `subscription_billing` | Subscriptions, periods, immutable invoices, credit notes, dunning. Money = **minor-unit bigint**, never a float. |
| 7   | `payment_gateway`      | Hosted checkout sessions, signed webhooks. LAN/offline/manual mode keeps working without an online gateway.      |

### Wave C — the ERP readiness contracts (ADR-0020) actually implemented

ADR-0020 is `Accepted` but has no code. Implement its seams in
`src/modules/_shared/` (business transaction, posting, period-lock, item,
report-projection) so that the "ERP ready" claim in the README/PROJECT_STATE has
something to stand on.

### Wave D — optional, Indonesia-specific

`idn_admin_regions` (province/regency/district/village master data). Its source is
a third-party community dataset (MIT), **not** an official Kemendagri API — that
caveat must be carried over, do not soften it.

## 4. Junction point: unlimited subdomains backed by Cloudflare DNS

`tenant_domain` **already exists** in awcms (PR #219, `sql/046`–`048`): the
`awcms_tenant_domains` schema, the management API, the admin screen, the public host
resolver, and the optional Cloudflare adapter in
`src/modules/tenant-domain/infrastructure/cloudflare-dns-adapter.ts`.

**What does not exist yet** — and this is what makes "unlimited subdomain
management" incomplete:

1. **The Cloudflare adapter is not called by any route.** It is absent-safe and
   tested, but no flow actually creates a DNS record. Adding a domain today = a DB
   record + manual verification.
2. **Host-resolved public routes are not wired up.** `src/middleware.ts` was
   deliberately left untouched during the #219 port; host resolution is a per-public-route
   concern.
3. **Automatic subdomain provisioning** naturally belongs to `tenant_provisioning`
   (Wave B #4): "new tenant → subdomain → DNS record → verification" is one
   idempotent & resumable provisioning run, not a one-shot endpoint.

**Suggested order:** wire up the Cloudflare adapter + host-resolved public routes
**as a separate PR first** (not dependent on Wave B), then let
`tenant_provisioning` orchestrate it. Reversing the order means writing provisioning
steps against a seam that has not been proven.

> Cache note: once unlimited subdomains are active, the edge cache key
> ([ADR-0042](../adr/0042-varnish-edge-cache-auto-activation.md)) **must** include
> the Host — already enforced in `vcl_hash`. Without it every tenant shares a single
> cache entry for the same path.

## 5. Absorption status (historical snapshot, not maintained)

| Wave | Item                                       | Status                                                                         | PR   |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------ | ---- |
| A    | `reference_data` (ADR-0021)                | ⏳ not yet — ADR is `Accepted`, no code yet                                    | —    |
| A    | `organization_structure` (ADR-0016)        | ⏳ not yet — ADR is `Accepted`, no code yet                                    | —    |
| A    | `document_infrastructure` (ADR-0017)       | ⏳ not yet — ADR is `Accepted`, no code yet                                    | —    |
| A    | `data_exchange` (ADR-0018)                 | ⏳ not yet — ADR is `Accepted`, no code yet                                    | —    |
| A    | `integration_hub` (ADR-0019)               | ⏳ not yet — ADR is `Accepted`, no code yet                                    | —    |
| B    | **SaaS control plane admission ADR**       | ⏳ not yet — **blocks the whole of Wave B**                                    | —    |
| B    | 7 control plane modules                    | ⏳ not yet                                                                     | —    |
| C    | ERP contract implementation (ADR-0020)     | ⏳ not yet — ADR + docs exist, no `_shared` code                               | —    |
| D    | `idn_admin_regions`                        | ✅ live — pioneered here (ADR-0046, `sql/080`–`081`)                           | #312 |
| —    | Cloudflare DNS wiring + public host routes | ⏳ not yet — the adapter exists but is never called; `middleware.ts` untouched | —    |
