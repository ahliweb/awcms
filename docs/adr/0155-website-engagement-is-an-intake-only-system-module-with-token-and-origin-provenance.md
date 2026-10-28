🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.id.md)

# ADR-0155 — Website lead and contact capture is an intake-only system module, `website_engagement`, with source-token and Origin provenance

- **Status:** Proposed
- **Date:** 2026-10-27
- **Decision maker:** ahliweb (maintainer) — **acceptance is the maintainer's decision, not made by this document**
- **Resolves (when accepted):** the module-admission gate of Issue #1153. Until accepted, #1153 is not ready to implement.
- **Extends:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (§2 invariants I1, I7, I8, I9, I12; §6 contact-linkage rule; §10 Phase C row for #1153), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md), [ADR-0103](0103-newsletter-is-its-own-module.md) (the public-intake pattern), [ADR-0037](0037-data-lifecycle-module-admission.md), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md)
- **Must conform to (not yet decided):** ADR-0153 (Issue #1163, the lead/prospect pipeline). This ADR neither presumes nor pre-empts its outcome; see §6.
- **Related:** Issues #1153, #1139, #1144, #1163; `docs/awcms/21_module_admission_governance.md`

**Docs and governance only. NOT YET IMPLEMENTED IN THIS REPO.** This ADR adds no module, table, migration, route, OpenAPI path, AsyncAPI channel or dependency. Nothing here is evidence that website capture works.

## Context

Verified on `main` at 27 October 2026:

- Issue #1153 asks for a tenant-scoped, publicly consumable website lead/contact event contract with verified tenant origin, source attribution and explicit consent provenance, for a downstream CRM adapter. ADR-0148 admitted the _design_ (Phase C, "independent of C1, conforms to I9") but names **no module, category or home** for it, and says each implementation issue passes its own readiness.
- No module owns visitor-submitted contact data. The audit found:
  - `form_drafts`: an authenticated multi-step draft store. Not a public intake.
  - `newsletter`: an anonymous intake, but its object is a subscriber list with double opt-in (ADR-0103). Its semantics (neutral identical answers, hashed confirmation tokens, `pending`/`active`/`suppressed`) do not fit a one-shot inquiry.
  - `comments`: moderated public content with a timing token and Turnstile.
  - `booking`: reservations.
  - `tenant_domain`: host to tenant resolution. `site_profile`: per-site settings. There is no first-class "website" entity in the repository.
- Reusable building blocks exist and must be reused, not duplicated: `src/lib/security/{rate-limit,request-body-limit,request-origin,turnstile,field-encryption,idempotency-key-bound}.ts`, the `data_lifecycle` registry, `domain_event_runtime` with the outbox, `visitor_analytics` consent handling.
- ADR-0148 §10 and the readiness pack make "anti-abuse challenge decided" a Definition-of-Ready item for #1153, and the #1139 comment says the choice "needs a decision in the PR". It has not been recorded.
- Downstream `awcms-one` commerce owns the CRM customer. Upstream must not create a second customer authority (ADR-0148 context, I7).

## Decision (proposed)

### 1. A new module: `website_engagement`, category **System**, intake only

A new `type: "system"` module (decision tree of doc 21: reusable cross-module capability, not an ERP domain). It owns exactly three things: **sources**, **submissions** and the **outbox event** that announces a submission. It is **not** a CRM, **not** a lead pipeline, **not** a forms engine and **not** a chat widget.

Rejected homes: extending `newsletter`, `comments` or `form_drafts` (each would bend a module whose ADR defines a different object and different public-response semantics; see Options).

Deliberately **out** of the module: stages, owners, scoring, deduplication, conversion, person merge, follow-ups (all #1163 / downstream); arbitrary HTML, file upload, live chat and an embeddable widget (the issue allows a widget only after a CSP/SSRF/multi-domain review, which is a separate later decision); building a second forms engine (the module stores a **bounded, schema-validated** payload; form rendering stays with the website).

### 2. Data model (shape, not DDL; the migration lands with the implementation)

All tables are tenant-scoped with RLS `FORCE` and default-deny RBAC/ABAC (I1).

- **`engagement_sources`**: one row per website/form channel of a tenant: `id`, `tenant_id`, `code` (unique per tenant), `name`, optional `tenant_domain_id` (the host(s) allowed), `status`, `form_schema_version`, `consent_copy_version`, challenge mode, `token_hash`, `token_prefix`, rotation timestamps, soft delete. **Three websites under one tenant are three sources**; two tenant domains may map to one or more sources.
- **`engagement_submissions`**: `id`, `tenant_id`, `source_id`, `event_id` (client-supplied idempotency/replay key), `received_at`, `occurred_at`, `kind` (closed list: `contact`, `lead`, `interaction`), `payload` (bounded, allow-listed fields), `locale`, attribution (`referrer_host`, UTM fields, landing path; no full URL query), consent block (see §5), `privacy_class`, `status`, and **encrypted** direct identifiers (email, phone, name) using the shared field-encryption helper with keyed hashes for lookup (ADR-0137 pattern). Unique `(tenant_id, source_id, event_id)` is the replay key.
- No visitor identity is inferred: no fingerprint, no cookie, no IP stored in clear (only a short-lived keyed hash for rate limiting, which is not persisted on the submission).

### 3. Authenticated provenance: source token plus Origin/host check (conforms to ADR-0148 I9 and the #1139 conditions)

1. The tenant is resolved **from the source token** (an opaque, high-entropy per-source bearer, stored only as a keyed hash, shown once on creation, rotatable and revocable). A `tenant_id`, `source_id` or `tenant_code` in the body or query is **ignored if present and rejected if it disagrees** (tenant-ID-substitution test).
2. The request's `Origin` (falling back to `Referer` host) must match the hosts registered for that source through `tenant_domain`. A mismatch is rejected before any database write. The token is a bearer secret visible in page source, so it is **not** treated as proof that the caller is the website: the Origin check, the challenge and the rate limit are co-equal controls. A forged `Origin` from a non-browser client is possible; therefore the Origin check is defence in depth, never the only gate, and server-to-server submissions use a distinct non-browser mode (signed with a separate secret) that is out of scope until requested.
3. CORS: the endpoint answers preflight only for the source's registered origins (reuse the `newsletter-cors` approach), with no wildcard and no credentials.

### 4. Public intake endpoint behaviour

- `POST /api/v1/website-engagement/submissions` (versioned, public, anonymous; OpenAPI + AsyncAPI in the implementation PR).
- Order of checks, cheapest first and **before database work**: method and content-type, `Content-Length` and streamed body cap, per-IP and per-source rate limit (reuse `rate-limit`), token and Origin check, anti-abuse challenge (§7), schema validation, then one transaction.
- Validation: closed field set per `form_schema_version`, length caps, no HTML (text is stored as text and escaped on output, never rendered raw), no upload, no URL fetch (SSRF: the module makes **no** outbound request while ingesting).
- Idempotent: a duplicate `(source, event_id)` returns the **same** neutral success body and does not create a second row or event. The response never reveals whether a person or address was already known (the ADR-0103 principle).
- Failures use the standard envelope with generic messages; the log and audit record carry a redacted fingerprint, never the payload or address.
- A honeypot field and a minimum-fill-time token (as `comments` does) are cheap additional signals; they do not replace the challenge.

### 5. Consent, opt-out and UU PDP (Law No. 27/2022) minimisation

- A submission is accepted only if the form states the processing purpose. The record stores the **consent provenance**: `consent_given` (explicit boolean, never pre-ticked or inferred), `consent_purpose` (closed list, e.g. `respond_to_inquiry`, `marketing_follow_up`), `consent_copy_version` (the exact text version shown), `consent_source` (source code and page path), `consent_at`. Responding to the inquiry and marketing follow-up are **separate** purposes with separate boxes; marketing consent is never implied by the inquiry (ADR-0148 I8).
- **Opt-out / withdrawal** is a first-class operation by the controller (admin, audited) and by the data subject through a later subject-rights channel (ADR-0094). Withdrawal marks the submission and emits a withdrawal event; downstream consumers must honour it. Raw withdrawal requests from the public are out of this first slice and recorded as a limitation.
- **Minimisation:** collect only the fields the source's schema declares; no national ID numbers, no special-category data (the validator denies those field names, as `form_drafts` denies secret-shaped names); direct identifiers encrypted at rest and masked in admin lists, logs and events (the event carries a reference and a privacy class, not the address, unless the consumer is explicitly granted).
- **Retention:** declared on day one in the migration through the `data_lifecycle` registry (ADR-0148 I12): a default retention window per tenant, expire-then-purge, legal-hold aware, subject-data descriptor per ADR-0094. The ADR proposes a default for the maintainer to confirm; the controller (the tenant) sets the final window.
- The controller's DPIA and the consent copy are **human sign-offs this ADR cannot give** (as in ADR-0148).

### 6. CRM seam that does not presume ADR-0153

The only outward surface is a domain event published through the outbox (ADR-0134 descriptor-declared consumers), e.g. `website_engagement.submission.received`, in the ADR-0148 §6 envelope: `tenant_id`, `source_id` (the channel account analogue), `event_id` (the provider-event-id analogue), `occurred_at`, authenticated provenance (`source_token`, `origin_verified`), `correlation_id`, `privacy_class`, plus the consent block and attribution. The event carries an **opaque submission reference** and the minimum needed; a consumer reads details through a sanctioned port with its own permission.

- No person is created, matched or merged here. Linking a submission to a CRM person happens **only** downstream through `contact_link_evidence` with a deterministic method (the visitor typed the identifier on a first-party form, which is exactly what this module records) (ADR-0148 §6).
- **Whatever ADR-0153 is accepted as governs the consumer side.** If ADR-0153 admits a `lead_pipeline` bounded context, it subscribes to this event; if it composes from existing modules, those subscribe; if it is rejected, the downstream consumer (awcms-one) subscribes. This module's event contract is the stable seam in all three cases. If ADR-0153's accepted outcome requires a different event shape or a different owner of capture, this ADR must be amended before implementation proceeds.

### 7. Anti-abuse challenge: OPEN QUESTION for the maintainer

**Recommended option (not decided by this document): Cloudflare Turnstile**, reusing `src/lib/security/turnstile.ts` (server-side verification with action, hostname and freshness checks, bounded body, no token logging). Required per source and honoured per deployment profile: where `TURNSTILE_ENABLED` is off (offline/LAN) the module falls back to the **non-third-party** controls only (token, Origin, rate limit, honeypot, timing token, proof-of-work optional) and the source is marked `challenge: none`, which the admin UI must show. Default for public deployments: challenge required.

| Criterion               | **A. Turnstile (recommended)**                                                                                | B. Self-hosted proof-of-work (e.g. ALTCHA)                             | C. Honeypot + timing token + rate limit only        | D. Image/puzzle CAPTCHA (reCAPTCHA/hCaptcha)         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Security                | Strong against commodity bots; server-verified; action/hostname binding; one third party sees visitor signals | Raises per-submission cost; weaker vs. determined bots; no third party | Stops naive bots only; trivial for targeted scripts | Strong; heavier third-party data flow                |
| Accessibility (WCAG)    | Usually invisible or one click; no image puzzle; keyboard operable                                            | Invisible to the user; costs CPU on low-end phones                     | Fully invisible; nothing to fail                    | Image/audio puzzles are the worst accessibility case |
| Privacy / UU PDP        | Visitor data processed by Cloudflare, outside Indonesia: controller must disclose (ADR-0148 Art. 56 reading)  | No third party; best fit for strict deployments                        | No third party                                      | Third party plus tracking concerns                   |
| Performance / SEO / UX  | One script on form pages only (CSP origin added only where active); no layout shift when invisible            | No external script; adds hashing time before submit                    | Zero cost                                           | Heavier script, visible friction                     |
| Maintainability         | Adapter exists and is hardened; one more env pair per deployment                                              | New code to own and keep correct; more tests                           | Existing pieces                                     | A second adapter                                     |
| Scalability / operation | Offloaded to the provider; availability dependency fails **closed**, so an outage blocks forms                | Scales with our CPU; no dependency                                     | No dependency                                       | Provider dependency                                  |
| Offline/LAN profile     | Not available (off); falls back to C                                                                          | Works                                                                  | Works                                               | Not available                                        |

Reasoning for A: it is already in the repository and reviewed (ADR for online auth hardening), has the best accessibility and lowest friction, and the issue's acceptance list (forged Origin, malicious payload, duplicate form) is addressed by the other controls in §3 and §4 rather than by the challenge alone. B is the strongest alternative if the maintainer prefers no third-party processing; it can be added later as a second `challenge` mode without changing the contract. **The maintainer decides; acceptance of this ADR with a different answer to this question changes only §7 and the implementation's challenge adapter.**

### 8. Authorisation, audit, admin read access

- Admin read is **default-deny** behind a seeded permission triple (e.g. `website_engagement.submission.read`), plus separate grants for `source.manage` (create, rotate, revoke) and `submission.withdraw`/`purge`. Seeded to the roles the owner decides, enforced by the endpoint and navigation `requiredPermission` (the repo's recurring trap, per AGENTS.md).
- Audit (with redaction): source create/rotate/revoke, token reveal, submission read of decrypted identifiers, withdrawal, purge. The public intake itself is logged as a redacted metric, not as an audit row per anonymous request.
- The navigation entry and its admin page ship in the same change (AGENTS.md rule).

### 9. Sequencing and gates

Implementation (migrations 321-322 reserved to this issue) starts only after: this ADR is **Accepted**, the §7 question is answered, and ADR-0153's direction is known well enough to confirm §6 (or §6 is amended). Then the normal checks: security review (public unauthenticated write surface), full `bun run check`, OpenAPI and AsyncAPI in sync, EN/ID docs, changeset, and the acceptance list of the issue (two domains, three websites in one tenant, forged Origin, duplicate, opt-out, malicious payload, tenant-ID substitution, localisation, WCAG, DB RLS, 2-tenant tests).

## Options considered (module home)

| Criterion        | **A. New `website_engagement` system module (chosen)**                     | B. Extend `newsletter`                                                | C. Extend `comments` or `form_drafts`           | D. Build it downstream only (`awcms-one`)                                       |
| ---------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Security         | One reviewed public write surface; token/Origin/consent owned in one place | Mixes a subscriber list's neutral-response rules with inquiry storage | Moderation/draft semantics unrelated to intake  | Moves the public surface away from the upstream gates (ADR-0055 upstream-first) |
| Maintainability  | Narrow, removable, single responsibility                                   | Dilutes ADR-0103's definition of the module                           | Same dilution, plus coupling to unrelated tests | Every product re-derives it                                                     |
| Performance      | Independent rate limit and retention tuning                                | Shared limits and indexes                                             | Shared                                          | Same as A                                                                       |
| Scalability      | Rows and sources, not queues; outbox for consumers                         | Same, tangled                                                         | Same, tangled                                   | Same as A                                                                       |
| Compatibility    | Additive; inert until a source exists                                      | Changes a live module's contract                                      | Changes a live module's contract                | Divergence from upstream                                                        |
| Operational cost | One more module, flag-free (inert without sources)                         | Lowest new surface, highest coupling                                  | As B                                            | Lowest upstream                                                                 |

## Consequences

- **Positive:** a single, reviewable public intake surface with provenance, consent and retention decided up front; a stable event seam for whichever CRM consumer ADR-0153 settles on; no second forms engine or customer authority.
- **Negative / trade-off:** one more module; a public unauthenticated write endpoint to defend permanently; a bearer token that is public by nature, so Origin, challenge and rate limit must all hold; a third-party dependency if Turnstile is chosen.
- **Neutral:** inert until a tenant creates a source; no change to any existing module; offline/LAN deployments can still capture with the non-third-party controls.
- **Limitations recorded:** no public withdrawal channel in the first slice; no server-to-server signed mode; no widget; no live chat (needs its own approval); no deduplication or person matching.
- **Human sign-off still needed:** maintainer acceptance; the §7 challenge decision; the controller/DPO for consent copy, DPIA and retention window; the security review at implementation.

## Alternatives rejected

- **A second forms engine** that renders and stores arbitrary forms: out of scope, duplicates the website's own form rendering, and widens the validation surface.
- **Trusting the Origin header alone**: non-browser clients forge it.
- **Taking the tenant from the request body or from the Host alone**: the substitution risk the #1139 conditions name; host-only resolution also fails for third-party-hosted forms.
- **Storing full IP addresses, fingerprints or cookies to "recognise" visitors**: violates minimisation and the no-inferred-identity rule.
- **Creating or matching CRM people upstream**: ADR-0148 I7 and the ADR-0153 question.
