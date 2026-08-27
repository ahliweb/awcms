---
"awcms": minor
---

feat(newsletter): the subscribe endpoints answer a reader's browser on another origin, and resolve that origin's tenant

The `newsletter` module shipped on 21 August with three anonymous public
endpoints built to be called from a public page. Per ADR-0070 that page is not
in this repo — it is a statically built `awcms-astro` site on another origin —
and from there **not one of the three was reachable**. Four blockers, measured
against this repo's own source, each hiding the next:

1. **No `OPTIONS`.** The contract is JSON, so every cross-origin POST is
   preflighted. Nothing answered, so the POST was never sent.
2. **No `Access-Control-Allow-Origin`.** An answered preflight would have been
   followed by a POST this server accepted and the browser discarded.
3. **The tenant resolved from the HOST, which is this CMS.** A subscription from
   a site would have landed in whichever tenant owns this deployment's hostname,
   or in `PUBLIC_DEFAULT_TENANT_ID`. Not a failure anybody would have seen — a
   **wrong success**, and FR-NWL-002's isolation defeated by the request meant to
   be bound by it.
4. **The confirmation link was built on THIS origin**, where
   `/newsletter/confirm` does not exist. Every confirmation email ever sent
   linked to a 404 here, so `consent_at` could never be written and no
   subscriber could ever become `active`. Double opt-in was not partly
   reachable; it was unreachable.

`site_search` met blockers 1–3 and solved them in ADR-0107. The newsletter's own
docblock claimed to mirror that module "exactly" — it mirrored the half that did
not have the problem.

## What changed

**ADR-0118** follows ADR-0107 rather than inventing a second cross-origin
policy.

- `domain/newsletter-cors.ts` — `content-type` is the only allowed header (it is
  what keeps the request out of Astro's form-like branch, where `checkOrigin`
  answers 403), `POST, OPTIONS` the only methods, never `*`, and **no
  `Access-Control-Allow-Credentials`**: the deliberate difference from the visit
  beacon, which needs one for its cookie. Nothing here reads or sets a cookie,
  and a wider grant on endpoints that send mail is bought for nothing.
- `application/public-newsletter-preflight.ts` — one `OPTIONS` implementation
  for all three routes. Always `204`: a refusal is the ABSENCE of a grant, never
  a status code, because an origin that learns it was refused has learned that
  some other origin would not have been. Classified from the header first and
  rate-limited **before** the domain lookup, under the POST's own key.
- `withPublicNewsletterTenant` — resolves a cross-origin request's tenant with
  `resolvePublicTenantByHost` and nothing else: no env default, no setup-state
  default. A refused origin pays the same latency pad an unresolved host does.
- The confirmation link is built on the **granted** origin, safe to echo
  precisely because the request only reached that branch by resolving a tenant
  through `awcms_tenant_domains`.
- The three paths enter `COMMITTED_PATHS` with the fixture regenerated, so the
  shape is frozen before `awcms-astro` makes the call real.

## What this deliberately does not fix

A deployment with **no site in front of it** still cannot confirm: the
same-origin link keeps pointing at `/newsletter/confirm` here, and this repo
serves no such page. Adding public reader pages here would contradict ADR-0070.

A `429` and a validation `400` carry no CORS grant — both are answered before
the origin is classified, because the limiter deliberately runs before any
database read. Following ADR-0107 both still carry `Vary: Origin`.
