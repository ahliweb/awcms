🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0102-tenant-site-identity-is-its-own-module.id.md)

# ADR-0102 — Tenant site identity is its own module, and the read composes

- **Status:** Accepted
- **Date:** 2026-08-21
- **Decision maker:** ahliweb
- **Related:** Issue #596; PRD LenteraKalteng §25, §26.2, FR-TEN-004, §41; ADR-0053 (separating authority matters); ADR-0036 (media_library inversion — the reuse-gate precedent); `sql/058` (splitting read from update on blast radius)

## Context

A tenant cannot say who it is. There is no logo, favicon, editorial address, contact email, phone, WhatsApp number, copyright line, tagline or social profile link anywhere in `blog_content`, `theming` or `seo_distribution`.

The consequence is not cosmetic. A footer, a masthead, a contact page and the `Organization` JSON-LD node all have to hard-code the publisher's identity in frontend source — which violates PRD §25 ("tanpa edit source code") and FR-TEN-004 (configuration must be per-tenant), and makes a second tenant impossible without a fork. PRD §41 makes SeputarBorneo exactly that second tenant.

### The reuse gate, run before building anything

ADR-0055 requires asking whether a desired capability is a new module or an extension of one that exists. Three candidates were examined.

**`theming` — rejected outright.** Its charter is PRESENTATION, and its value is the strictness of that charter: token values are validated against a strict CSS grammar and `url(...)` can never reach the emitted CSS. An editorial address is not a design token. Putting it there would abuse the one module whose entire worth is how narrow it is.

**`blog_content.settings` — rejected.** Site identity is not content. A tenant with no articles still has a masthead.

**`awcms_seo_tenant_settings` — the real candidate**, and the one Issue #596's own preliminary recommendation favoured. It already holds `site_name`, `organization_name`, `organization_logo_media_id` and `default_social_media_id` — roughly half the PRD §25 list. The argument for extending it is strong and was stated in the issue: a second module owning the other half means two sources of truth for "who is this site", and consumers must then know which to ask.

### What the examination found

The overlap is real but the two halves are not the same kind of thing.

Every identity-looking field already in `awcms_seo_tenant_settings` is an **SEO output**: `site_name` overrides `og:site_name`, `organization_name`/`organization_logo_media_id` populate the JSON-LD `Organization` node, `default_social_media_id` is the fallback `og:image`. Each is consumed by a renderer that emits meta tags, and each is set by someone who understands index impact.

What PRD §25 asks for is different: an address a reader can visit, a number they can message, links they can follow, a line at the bottom of the page. **Site chrome**, set by whoever runs the newsroom.

ADR-0053 already established that separating those authorities matters.

## Decision

**We decided to build `site_profile` as its own module, owning site chrome, and to pay the cost of that split on the READ side rather than pushing it onto consumers.**

- **Ownership boundary.** `awcms_seo_tenant_settings` keeps what CRAWLERS see. `awcms_site_profile` (`sql/135`) owns what PEOPLE read: tagline, copyright notice, logo, favicon, editorial address, contact email/phone/WhatsApp, and up to 20 social profile links. **Nothing is duplicated across the two**, so no value can drift out of step with a copy.

- **One read for consumers.** `GET /api/v1/site-profile/composed` returns both halves in one answer, with the four SEO-owned fields named exactly as `seo_distribution` names them so it is visibly a passthrough. A build client asks one endpoint and never learns the split exists.

  This is the part that answers the objection. The cost of a second module was never the storage — it was "consumers must know which to ask", and that cost is removed by composing once, here, instead of in every template that would otherwise call two endpoints and drift when one of them forgot.

- **`read` and `update` are separately grantable**, on `sql/058`'s reasoning: changing what every public page's contact block says is a different power from reading it.

- **Nothing is anonymous.** "Public read" in Issue #596 means the public site's BUILDER can read it. The site publishes its own contact details in its own templates; that is the site's decision to make, not this API's to make on its behalf by serving them to anyone who asks. This follows `GET /api/v1/media/public-origin`.

- **Social link URLs are refused, not sanitized**, unless absolute `http(s)`. They are rendered as `<a href>` on every public page, so a `javascript:`/`data:` value there is stored XSS with a very long reach — the same posture `content-validation.ts` takes toward markup.

- **Logo and favicon are media object ids, not URLs.** A URL field would be a second path to the bytes that managed-media enforcement does not govern.

## Consequences

- **Positive:** a second tenant needs no fork. Identity is data, and `awcms-astro` reads it at build time from one endpoint.
- **Positive:** the module boundary matches who edits what. An SEO owner and a newsroom administrator are different people with different permissions, and the split makes that grantable rather than notional.
- **Negative / trade-off:** two tables now store things a reader would call "site identity". The composed read hides that from consumers, but a DEVELOPER still has to know it — which is why the boundary is stated in the module descriptor, the migration header, the admin screen, and here.
- **Negative / trade-off:** the admin screen has to tell an operator that the site name lives on `/admin/seo`. It does, explicitly, because the alternative is an operator hunting for a field that is one screen away.
- **Neutral:** `awcms_site_profile` is entirely nullable beyond its key. A tenant that has filled in nothing is a valid tenant, and the renderer omits what is absent rather than printing a placeholder.
- **Neutral:** favicon is a separate field from logo. One field for both would force every tenant to accept whichever crop the renderer picked.

## Alternatives considered

- **Extend `awcms_seo_tenant_settings` with the missing columns** (Issue #596's preliminary recommendation). Rejected on charter: that table is read by a meta-tag renderer, and an editorial address has no reader there. The concern behind the recommendation — two sources of truth — is real, and is answered by the composed read rather than by merging the tables.
- **Move the four SEO-owned identity fields INTO the new module** and have `seo_distribution` read them through a port, as ADR-0036 did for media. Rejected for this change: it is the cleaner end state, but it is a breaking change to `PUT /api/v1/seo/config` and would fail `api:consumer-contract:check` (ADR-0065) as non-additive. Worth revisiting deliberately, with a coordinated release, rather than smuggling into the change that introduces the module.
- **Put identity in `tenant_admin`.** Defensible — it owns the tenant row — but it would require moving the same four fields out of `seo_tenant_settings`, carrying the same breaking cost, and `tenant_admin` is a platform module whose charter is tenancy, not publishing.
- **Store social links as one column per platform.** Rejected: a `tiktok_url` column is a migration per fashion cycle. `jsonb` with a bounded array and a domain-layer allow-list keeps the set open without letting the value be arbitrary.
