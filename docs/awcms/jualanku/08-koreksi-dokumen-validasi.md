🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](08-koreksi-dokumen-validasi.id.md)

# 08 — Corrections to validation document v1.0

> The PT TIM SIX validation document v1.0 (29 July 2026) partly reasons from the
> repo's documentation, and documentation can be stale. Every line below was
> checked against this repo's **code** on the same date. What is confirmed is not
> repeated here; what differs is recorded in full together with its evidence.

## 1. Module inventory — the finding is right, the cause is different

The document concludes that `news-portal` is "not yet available" and asks that we
not assume it exists. The practical conclusion is correct, but the cause is not
"the module has not been built" — the module was **merged**:

- `news_portal` was **merged into `blog_content`** by
  [ADR-0044](../../adr/0044-merge-news-portal-into-blog-content.md); its features
  (homepage section composer, ad placement with verified media) still exist, they
  only changed owner.
- `src/modules/index.ts` contains **20 modules** and does not include
  `news_portal`.
- What is stale is the prose: `README.md` still lists it among the "foundation
  modules"; `docs/ARCHITECTURE.md` says "20 modules" but **enumerates 21 items**;
  `docs/PROJECT_STATE.md` says 21 modules, 43 ADRs, and
  `MODULE_CONTRACT_VERSION` 2.3.0 — all three lag behind.

**Correction:** those three documents are reconciled together with the change
that brings ADR-0045. The rule used from here on is the same as the validation
document's recommendation: `src/modules/index.ts` is the strongest evidence, the
prose follows.

## 2. "The portal checks the session via SSR — `auth/me` is bearer-only"

Half true, and the half that is wrong changes the design.

- **True:** `GET /api/v1/auth/me` does only accept a bearer token
  (`src/pages/api/v1/auth/me.ts`).
- **Not true:** "`awcms` does not support cookie-based sessions yet". Login
  already sets the httpOnly cookies `awcms_session` + `awcms_tenant_id`, and
  `resolveAuthInputs()` (`identity-access/application/access-guard.ts`) accepts
  **either the header OR the cookie** — that is how the SSR admin that already
  runs today authenticates itself.

**Correction:** the gap is narrower and more specific — there is no **session
introspection contract for a different origin**. The `awcms` cookie belongs to
the `awcms` origin; a browser on `jualanku.info` will not send it. What is being
added is an introspection endpoint called by the **BFF** (see
[05](05-kontrak-sesi-dan-bff.md)), not "cookie support".

## 3. "Merchant isolation via ABAC `subject.merchantIds` / `resource.merchantId`"

The direction is right (ABAC + ownership + server-supplied attributes), but the
concrete shape cannot be implemented as written:

- `ABAC_ATTRIBUTES` (`identity-access/domain/abac-policy.ts`) is a **closed
  allow-list**. An attribute outside that list is **invalid at authoring time**
  and **denied at evaluation time**. `subject.merchantIds` and
  `resource.merchantId` are not in it.
- Adding a per-product attribute pair would turn a bounded allow-list into a list
  that grows on request — the very property that makes it valuable would be lost.

**Correction:** a merchant is modelled as a **business scope** (ADR-0030). The
repo already has `resource.businessScopeId` in the allow-list and a scope
hierarchy port whose base returns `resolved: false` so high-risk actions **fail
closed**. `jualanku_directory` fills that port for the `merchant` scope type.
Details in [02](02-model-tenant-merchant-otorisasi.md) §3.

## 4. "RLS separates tenants" — true, with one operational trap

The document is right that RLS does not separate merchants. What must be added:
RLS can also **silently fail to separate tenants** on certain platforms.

`FORCE` RLS does not apply to a superuser role. A number of PaaS providers make
the default Postgres user a superuser; if the runtime `DATABASE_URL` points
there, tenant isolation is lost entirely **while migrations stay green and the
health check still returns 200**.

**Correction:** isolation verification must be run **as the application role**
(`awcms_app`) and must be part of the tests, not an assumption. This goes into
the P1 gate ([07](07-roadmap-gates-kepatuhan.md) §2).

## 5. "Seven domain modules" → five

Accepted as-is by the validation document itself (Alternative C). Recorded here
because the decision is binding: five bounded contexts, and any further split
only on the basis of measured coupling.

## 6. `awcms-astro`: confirmed facts

All verified against the `ahliweb/awcms-astro` repo:

- `output: "static"`, no server adapter.
- Nginx serves static files (`try_files` to `index.html`).
- Content is pulled at build time; the CMS does not face readers.
- That repo's `AGENTS.md` already states that moving to `output: 'server'`
  **must** go through an ADR first.

**One fact has already changed since the validation document was written.** That
document was right that `awcms-astro` used Node/npm (`engines`: Node ≥ 22.12, npm
≥ 10.9) and therefore rejected the claim "the runtime follows Bun". That claim is
now **true**: that repo has been moved to Bun (ADR-0015 over there —
`packageManager` `bun@1.3.14`, `bun.lock`, `bun test`, the `oven/bun` image,
`setup-bun` in CI). The validation document's correction remains valid for its
date; what no longer holds is the derived conclusion ("keep Node/npm until there
is a migration ADR") — that ADR now exists and has been executed.

Because of that, rendering/runtime changes are designed and decided **in that
repo**, not here. The whole AWCMS family is now Bun-only without exception.

## 7. Rendering terminology

"Hybrid application" is not the right term for modern Astro: `output` is only
`static` or `server`, and mixed capability comes from
`export const prerender = false` per route once an adapter is installed.

**Correction:** the term used across this family's documents is
**static-by-default with on-demand routes** (mixed prerender/on-demand).

## 8. Standard versions

The version corrections in the validation document (WCAG 2.2 / ISO/IEC
40500:2025, ISO/IEC 27701:2025, ISO/IEC 27018:2025, ISO/IEC 15408 Parts 1–5:2026, the ISO/IEC 27017 transition) are **accepted as-is** and become the baseline in
[07](07-roadmap-gates-kepatuhan.md) §6.

One addition: this family's accessibility baseline was previously written as WCAG
2.1 AA in the `awcms-astro` template. Raising it to 2.2 AA is a change that must
be recorded in that repo, not assumed to apply automatically.

## 9. Things the validation document gets right and implementers often forget

Recorded again here because these three are the ones most often lost during
execution:

1. **UI visibility is not a security control.** Hiding a menu does not close an
   endpoint.
2. **Different namespaces must not give birth to three implementations of a
   business rule.**
3. **External providers are not called inside a database transaction** — outbox
   - idempotency key.
