🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0118-the-newsletter-endpoints-answer-a-browser-on-another-origin.id.md)

# ADR-0118 — The newsletter endpoints answer a browser on another origin, and resolve that origin's tenant

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decision maker:** ahliweb
- **Extends:** [ADR-0103](0103-newsletter-is-its-own-module.md) — the module's behaviour is unchanged; what is added is who may call it and whose list they reach. Follows [ADR-0107](0107-a-readers-browser-may-search-and-the-origin-names-the-tenant.md) rather than inventing a second cross-origin policy.
- **Related:** `src/modules/newsletter/domain/newsletter-cors.ts`, `src/modules/newsletter/application/public-newsletter-preflight.ts`, `scripts/api-consumer-contract.ts`, [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) (the family's public surface belongs to `awcms-astro`), Issue #745, `awcms-astro` [#79](https://github.com/ahliweb/awcms-astro/issues/79)

## Context

The `newsletter` module shipped on 21 August 2026 with three anonymous public
endpoints — `subscribe`, `confirm`, `unsubscribe` — each built to be called from
a public page. Per ADR-0070 the family's public pages are not in this repo: they
are a statically built `awcms-astro` site on a different origin. The consumer
wrote its caller and could not turn it on.

Four things blocked it, measured rather than supposed, and each one hid the next.

### 1. The preflight was never answered

The contract is JSON, so a cross-origin POST is always preflighted. `OPTIONS` is
in Astro's `SAFE_METHODS` and would have passed `security.checkOrigin` — but no
newsletter route exported one, so the browser never sent the POST at all.

### 2. The answer would have been unreadable

No route emitted `Access-Control-Allow-Origin`. An answered preflight would have
been followed by a POST the server was happy with and the browser discarded.

### 3. The tenant resolved from the HOST, which is this CMS

`withNewsletterTenant` mirrored the **host-resolved** search entry point. The
host of a request from a static site is this deployment, so a subscription from
a site would have resolved through the host chain and landed in whichever tenant
owns this deployment's hostname — or, failing that, in
`PUBLIC_DEFAULT_TENANT_ID`. Not a failure anybody would have seen: a **wrong
success**, and FR-NWL-002's isolation defeated by the request that is supposed
to be subject to it.

`site_search` met exactly this and solved it in ADR-0107. The newsletter's own
docblock said it mirrored that module "exactly"; it mirrored the half that did
not have the problem.

### 4. The confirmation link pointed at a page that does not exist

`buildConfirmationUrl` was given `resolveRequestOrigin(url, request)` — the
origin the API request arrived on, which is this CMS — and
`NEWSLETTER_CONFIRM_PATH` is `/newsletter/confirm`. There is no such page in
this repo: `src/pages/newsletter/` does not exist. Every confirmation email ever
sent by this module linked to a 404 on this origin, so `consent_at` could never
be written and no subscriber could ever become `active`. Double opt-in was not
partially reachable; it was unreachable.

## Decision

**The three newsletter endpoints answer a cross-origin browser, and a
cross-origin request's tenant comes from its `Origin`, verified against
`awcms_tenant_domains`.**

### 1. `OPTIONS` on all three routes, one implementation

`src/modules/newsletter/application/public-newsletter-preflight.ts` answers
every preflight; the routes supply only their own limiter key. Three
implementations would be three chances to grant something one of them did not
mean to.

Always `204`, whatever the decision — a refusal is the ABSENCE of
`Access-Control-Allow-Origin`, never a status code. An origin that learns it was
refused has learned that some other origin would not have been, which is the
oracle the bodies of these endpoints already refuse to be.

The preflight is classified from the header first and rate-limited **before**
the domain lookup, under the same per-IP key as the POST it precedes. A
preflight is part of that request, not a second one, and `Access-Control-Max-Age`
(600s) keeps a reader from paying twice.

### 2. The grant is narrow

`content-type` is the only allowed header — it is what keeps the request out of
Astro's form-like branch, where `checkOrigin` answers 403 — and `POST, OPTIONS`
the only allowed methods. Never `*`: the echoed origin is always one that
already resolved a tenant through `awcms_tenant_domains`.

**No `Access-Control-Allow-Credentials`**, and that is a deliberate difference
from the visit beacon. The beacon needs credentials because its anonymous
visitor key is a cookie. These endpoints read no cookie, set no cookie and
authenticate nobody — a subscription is proven by a token that arrives in an
email. A credentialed grant would be a strictly wider one bought for no benefit,
on endpoints that send mail.

### 3. A cross-origin request's tenant comes from its origin

`withPublicNewsletterTenant` classifies the `Origin` first and, when the request
is cross-origin, resolves the tenant with `resolvePublicTenantByHost` **and
nothing else** — no env default, no setup-state default. A caller naming a
hostname this deployment does not serve is `refused` and gets the same neutral
body as everyone else, never somebody else's list.

A refused origin pays `padUnresolvedNewsletterTenantLatency`, exactly like an
unresolved host. Without it, "this origin is a tenant of this deployment" would
be readable from response TIME even though the body says nothing.

### 4. The confirmation link is built on the granted origin

For a granted cross-origin subscription the token URL is built on the caller's
own origin — safe to echo precisely because the request only reached that branch
by resolving a tenant through `awcms_tenant_domains`. An unverified `Origin`
here would be a way to make this deployment email a stranger a valid token
pointing at a site the sender chose.

For a same-origin subscription it stays what it was.

## Consequences

- **The consumer can turn its caller on.** `awcms-astro`#79 has written the
  subscribe form and held it behind a hard-coded flag; the three paths enter
  `COMMITTED_PATHS` in the same change, so the shape is frozen before the call
  becomes real — the order `scripts/api-consumer-contract.ts` requires.
- **Double opt-in works, on a site.** The confirmation link lands on a page the
  site serves, which posts the token back here.
- **A deployment with no site in front of it still cannot confirm.** The
  same-origin link continues to point at `/newsletter/confirm` on this origin,
  and this repo serves no such page. That is stated rather than fixed: adding
  public reader pages here would contradict ADR-0070, which put the family's
  public surface in the other repo. What changed is that the case which has a
  site now works; the case which has none was never working and is now visible.
- **A 429 and a validation 400 carry no CORS grant.** Both are answered before
  the origin is classified — the limiter deliberately runs before any database
  read — so a cross-origin caller sees a failed request rather than the body.
  Following ADR-0107, both still carry `Vary: Origin`, because a cache must not
  hand an origin-dependent answer to a different origin. The cost is that a
  reader who mistypes an address is told nothing more than the neutral message
  already tells them, which for an anti-oracle endpoint is what they would have
  been told anyway.
- **One more surface is frozen against a consumer.** Changing the request or
  response shape of these three now reddens this repo's CI rather than a
  reader's browser weeks later.

## Rejected

- **Turning off `security.checkOrigin` for these routes.** It cannot be
  exempted per-route from inside the app — Astro installs it ahead of
  `src/middleware.ts` — and turning it off globally would trade a repo-wide
  guarantee for one module's convenience. The same refusal ADR-0107 and #637
  made.
- **`Access-Control-Allow-Origin: *`.** These endpoints send mail. A wildcard
  would let any page on the internet do it.
- **Serving `/newsletter/confirm` and `/newsletter/unsubscribe` from this
  repo.** It would work, and it would put reader-facing pages back in the repo
  ADR-0070 took them out of. The site owns them.
- **Trusting `Origin` for the confirmation link without a domain lookup.** It is
  one header away from having this deployment email a valid token to a stranger,
  pointing at a host the sender chose.
- **A distinct CORS policy per endpoint.** Three grants that must stay identical
  are three grants that will not.
