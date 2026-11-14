🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](website-engagement.id.md)

# Website engagement — lead and contact intake (Issue #1153, ADR-0155)

Implements [ADR-0155](../adr/0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.md) (Accepted). The module is `website_engagement`, type `system`, status `experimental`, in [`src/modules/website-engagement/`](../../src/modules/website-engagement/README.md). Migrations `sql/325` (schema), `sql/326` (permissions), `sql/327` (integrity guards). The OpenAPI fragment is `openapi/modules/website-engagement.openapi.yaml`; the event contract is in `asyncapi/awcms-domain-events.asyncapi.yaml`.

## What it is, and is not

A tenant's website posts a **contact request**, a **lead** or an **interaction** to one public endpoint. The module stores it with its **provenance** (which source, which verified host, what challenge protected it) and its **consent** (what the visitor explicitly ticked, against which exact copy version, on which page), and announces it with an outbox event. A downstream CRM adapter (`awcms-one`) consumes that event.

It is **intake only**. It is not a CRM, a lead pipeline, a forms engine or a chat widget. It creates, matches and merges **no person** (ADR-0148 I7), infers **no visitor identity** (no fingerprint, cookie, IP or user agent is stored), does **no CRM conversion**, accepts **no HTML and no upload**, and makes **no outbound request while ingesting** (so it has no SSRF surface). Stages, owners, scoring and deduplication belong downstream (ADR-0153).

## Audit of what existed

| Module          | Why it is not the home                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `form_drafts`   | An authenticated multi-step draft store, not a public intake.                                                                    |
| `newsletter`    | Anonymous, but its object is a subscriber list with double opt-in and neutral identical answers (ADR-0103).                      |
| `comments`      | Moderated public content with a timing token and Turnstile.                                                                      |
| `site_profile`  | Per-site settings. There is no first-class "website" entity; a website is a **source** here.                                     |
| `tenant_domain` | Host to tenant resolution. **Reused**: a source lists `awcms_tenant_domains` rows, and the host bootstrap answers the preflight. |
| bot protection  | `src/lib/security/{rate-limit,request-body-limit,request-origin,turnstile,field-encryption}` are **reused**, not copied.         |

## The public contract (v1)

`POST /api/v1/website-engagement/submissions`, `Content-Type: application/json`, no `Authorization`, no tenant header. A **closed** field set; an unknown key is a `400` and is never echoed.

| Field                                  | Notes                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sourceToken`                          | `wes1.<tenantId>.<sourceId>.<secret>`; the tenant is opened **from the token**                                                     |
| `tenantId`, `sourceId`                 | optional, **never trusted**; refused if they disagree with the token                                                               |
| `eventId`                              | 8 to 64 chars, the client's idempotency key; the same `(source, eventId)` is stored once                                           |
| `kind`                                 | `contact` (needs `contact.message` and an email or phone), `lead` (an email or phone), `interaction` (a closed `interaction.type`) |
| `contact`                              | `name`, `email`, `phone`, `company`, `subject`, `message`; text only                                                               |
| `consent`                              | `purposes` (`respond_to_inquiry`, `marketing_follow_up`), `copyVersion`, `pagePath`                                                |
| `attribution`                          | `landingPath` and `referrerHost` (shape-checked, stored, **never fetched**), five `utm*` fields; no full URL, no query             |
| `locale`, `topic`, `occurredAt`        | `en` / `id` language tag; a topic code; a time within the last 7 days                                                              |
| `challengeToken`, `honeypot`, `fillMs` | the Turnstile response; the honeypot (leave empty); client-reported fill time                                                      |

### Decision order (cheapest first, before database work)

1. per-IP rate limit (`WEBSITE_ENGAGEMENT_RATE_LIMIT_*`), 2. `Content-Type`, 3. a **16 KiB** capped body, 4. **shape** validation, 5. the key ring exists (fail closed), 6. token parse and the tenant/source ids, 7. **proof**: tenant, module switch, source status, the keyed-hash compare inside the token's tenant context, and the verified Origin host against the source's active domains, 8. the source's own rules (accepted kinds, consent), 9. honeypot and fill time (no budget spent), 10. the challenge (outside any transaction; **none for an `interaction`**), 11. **then** the per-source budget (an interaction has its own, lower one), 12. one transaction: insert, `ON CONFLICT DO NOTHING`, outbox event.

Decisions recorded from the independent audit: **H1** the per-source budget is spent only after the challenge succeeds, so a scraped real token with a forged Origin (refused in step 7) or a failing challenge (refused in step 10) spends none of a real source's budget; the per-address key is the **IPv6 /64** prefix. **M1** interactions (`form_view`, `cta_click` ...) never create contact data, so they get no per-event challenge (a widget solve per click is unworkable), a separate lower budget (`WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX`, default 120) and cannot starve leads. **M2** there is no duplicate probe before the challenge (it was an `eventId` oracle for any token holder): a duplicate is decided by the insert and answers like a new submission. The cost is that a double-click on a challenged form can fail the second challenge (a Turnstile token is single-use); the widget re-renders per submit.

### One refusal before proof

An unparseable token, an unknown tenant or source, a wrong secret, a paused or revoked source, a suspended tenant, a disabled module and an unregistered Origin all answer the **same** `403 SUBMISSION_REFUSED` with no CORS grant, and pay the same database round trips and the same keyed-hash computation. A new submission, a duplicate and a honeypot catch all answer the same `200`. After proof the answers are specific (`CONSENT_REQUIRED`, `CONSENT_COPY_MISMATCH`, `KIND_NOT_ACCEPTED`, `429`).

## Provenance: token and Origin (ADR-0155 section 3)

- The **token** is opaque, 256-bit, stored only as an HMAC under the module key ring, shown once at creation or rotation, rotatable (the old one stops at once) and revocable. It is a **bearer secret that sits in page source**, so it is not proof that the caller is the website.
- The **Origin** (or, only when there is no `Origin` header, the `Referer` host) must be **`https`** (plain `http` is accepted only for an explicit localhost dev host: `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`, so the CORS grant never echoes `http` for a production source; **L2**) and must match an **active, non-deleted** domain registered for that source. A present but unusable `Origin` (`null`, an extension) is refused, never downgraded to a `Referer`. A forged `Origin` from a non-browser client is possible, so the Origin check is **defence in depth**, co-equal with the challenge and the rate limits. A server-to-server signed mode is out of scope.
- **Three websites under one tenant are three sources; two tenant domains map to one or more of them** (`awcms_engagement_source_domains`). A source accepts exactly its own hosts.
- CORS echoes the verified origin only, never `*`, never credentialed, `Vary: Origin` on every answer. The preflight (`OPTIONS`, always `204`) grants any active verified tenant domain, shares the POST's per-IP budget and allows only the `content-type` header; the POST then re-verifies the token and the per-source host.
- **Tenant-id substitution** is closed three ways: a body or query `tenantId`/`sourceId` that disagrees is refused, a query `tenant_code` is refused outright, and a token naming a tenant that does not own the source simply finds no row (the lookup happens inside that tenant's RLS context). No `SECURITY DEFINER` bootstrap path was added.

## Anti-abuse challenge (the ADR-0155 section 7 question)

**Turnstile**, recommended in the ADR, reusing `src/lib/security/turnstile.ts`, **verified against the request's own verified Origin host** (not one global hostname, so multi-domain tenants work) with the action `website_engagement`. Per source: `challengeMode` `turnstile` or `none`. Where the deployment does not run Turnstile (offline/LAN, or `TURNSTILE_ENABLED` off) the source runs on the non-third-party controls alone (token, Origin, rate limits, honeypot, fill time); every stored submission records `challenge_outcome` (`turnstile_verified`, `not_required`, `source_none`) and the source list shows `challengeEffective`, so **"none" is never mistaken for "verified"**. Where it is required, a missing token, a missing secret, an outage and a mismatch all fail **closed** with the same refusal. The maintainer's acceptance of ADR-0155 stands as the answer to section 7; a proof-of-work mode can be added later as a second `challengeMode` without changing the contract.

## Consent, opt-out and minimisation (UU PDP)

- A stored `contact`/`lead` requires `respond_to_inquiry` **and** a `copyVersion` equal to the source's current one; `marketing_follow_up` is a separate purpose, never implied. An `interaction` carries no contact details and no consent. The database refuses the other combinations (`awcms_engagement_submissions_shape_check`).
- **Withdrawal** is the controller's audited act (`submissions.withdraw`): mark, **erase** (the encrypted contact blob, the keyed hashes and the masked projections are set to NULL in the same statement and can never be written back; only the consent evidence and the attribution remain; **M3**), one `submission.withdrawn` event (idempotent under concurrency), reveal refused thereafter. The visitor's own channel is a later subject-rights issue (ADR-0094) and is a recorded limitation.
- **Encrypted at rest**: name, email, phone, company, subject and message are one AES-256-GCM envelope bound to purpose, tenant and row id; keyed hashes of email and phone exist for lookup; lists show masked values. Nothing decrypts except the audited **reveal** endpoint under its own permission.
- **Retention** is declared on day one through `data_lifecycle` (`awcms_engagement_submissions`, cursor `received_at`, **default 180 days**, bounds 30-730, hard delete, legal-hold aware). The default is the maintainer's to confirm and the tenant sets the final window. The worker role can find and delete aged rows and read **no** identifier, hash or ciphertext.
- The **DPIA**, the consent copy and the retention window are human sign-offs this change cannot give.

## The outward seam: the CRM event

`awcms.website_engagement.submission.received` (version `1.0`, contract `1`) and `...submission.withdrawn`, through the outbox in the same transaction as the write (ADR-0134 descriptor-declared consumers can subscribe). The payload (schema `WebsiteEngagementSubmissionReceived` in AsyncAPI) carries the opaque `submissionId`, `sourceId`/`sourceCode`, `clientEventId` (the provider-event-id analogue), `kind`, authenticated `provenance`, `consent`, `attribution`, which `identifiers` it holds and a `privacyClass` — **never** a name, address, phone number or message. A consumer reads details from `POST /submissions/{id}/reveal` under `submissions.reveal` (a machine credential may), which is audited. Whatever ADR-0153 becomes subscribes to this event; if it needs a different shape, ADR-0155 must be amended first (ADR-0155 section 6).

## Security notes

| Concern          | Control                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation | `FORCE` RLS on all three tables with `WITH CHECK`; the tenant comes from the token; composite foreign keys; a trigger refuses another tenant's domain |
| Default-deny     | Every admin route is behind a seeded permission; the public POST is the only unauthenticated handler; machine credentials cannot do accountable acts  |
| SSRF             | None: no outbound request while ingesting; `referrerHost` is a shape-checked string; the Turnstile `verifyUrl` is configuration, never input          |
| Origin spoofing  | Origin is one of four co-equal controls; `null` and look-alike hosts refused; no `Referer` downgrade                                                  |
| Token leakage    | HMAC at rest, shown once, never listed, never in an audit row, an idempotency row, an event or a log; replay of a create/rotate omits it              |
| Enumeration      | one pre-proof refusal, same cost; admin ids answer one 404 across tenants; there is no pre-challenge duplicate probe                                  |
| Log redaction    | bodies, tokens, addresses and challenge tokens are never logged; only a coded outcome metric (`website_engagement_submission_total`)                  |
| Replay           | `(tenant, source, eventId)` unique; `occurredAt` limited to the last 7 days; Turnstile is single-use and not spent on a known duplicate               |
| Stored XSS       | text only, markup and control characters refused, escaped on output by whoever renders it                                                             |

## Widget decision (issue scope: only if CSP, SSRF and multi-domain constraints pass)

**Not built.** The embeddable widget would be third-party script executing on a tenant's own pages, which needs a CSP review per tenant domain (a `script-src` opening on every customer site), a hosted-asset and versioning story, a decision on whether the widget may load Turnstile on pages the tenant does not control, and a multi-domain review of its `postMessage`/iframe boundary. None of that is established here, the contract above is complete without it, and a website renders its own form (ADR-0155 section 1 rejects a second forms engine). Revisit as its own ADR if a tenant needs it. **Live chat is out of scope** and needs its own approval.

## Admin screens and their UX contract

**Landed (Issue #1153, follow-up): the read and withdraw/revoke half.** `/admin/website-engagement` (submissions), `/admin/website-engagement/{id}` and `/admin/website-engagement/sources` ship with their navigation entries; the module is `active`. They show masked values only, show the effective challenge as text (and say when a source's `turnstile` is not run on this deployment), list the token **prefix** only, and offer two actions behind their own permissions: the confirmed, `Idempotency-Key`-bearing withdrawal and the confirmed revoke. `sources.read`, `sources.manage`, `submissions.read` and `submissions.withdraw` left `NOT_YET_SCREENED`.

**Still deferred:** creating, editing, pausing and rotating a source (the token must be shown once) and the audited reveal (`submissions.reveal`, which stays on `NOT_YET_SCREENED`). The contract those screens must meet, in the same change as their controls: show the token **once** in a copy-to-clipboard region with an explicit "I have stored it" confirmation and never re-render it; show `challengeEffective` as visible text, not colour alone, and flag `none`; display masked values only and put reveal behind an explicit action with a reason; and meet the WCAG 2.2 AA rules of `docs/awcms/14_ui_ux_design_system.md` (labels, focus order, status announcements, no colour-only meaning). The shipped screens use the shared ADR-0149 data-page primitives, plain-text status pills (never colour alone), labelled controls and a 360 px stacked table.

## Limitations (recorded)

No public withdrawal channel; no server-to-server signed mode; no widget; no live chat; no deduplication or person matching; no screen for source create/edit/rotate or the reveal (API-only); no date-range filter on the list; no source-token grace window on rotation (the old token stops immediately); the per-IP limiter is in-process unless Redis is configured; the host match is by hostname (ports are ignored).

## Operating

Set the two key rings `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS` and `WEBSITE_ENGAGEMENT_HASH_KEYS`, sharing no key (see `.env.example`; a deployment that used the retired single ring `WEBSITE_ENGAGEMENT_KEYS` follows the transition runbook in the module README, Issue #1262), enable the module for the tenant in Module Management (enabled by default), create a source with `POST /sources` listing the tenant's domain ids, give the website the one-time token, the consent copy version it shows and a generated `eventId` per form render. Rotate by `POST /sources/{id}/rotate`; stop a site with `POST /sources/{id}/revoke`.

## Further audit decisions

**L4** Attribution values are a closed charset (`utm*`: letters, digits, space, `_`, `.`, `-`; paths and `consent.pagePath` refuse `%` and `@`, query and fragment), mirrored by a database CHECK, so an address or a phone number cannot ride into an outbox event through them. A free-text-looking value such as `john.doe` still passes: the charset narrows the carrier, it cannot prove a value is not a name. **L1** the same-tenant domain guard fires on `INSERT` and on any `UPDATE` of the link. **L6** switching `challengeMode` to `none` requires an `Idempotency-Key` and every change of the mode writes a warning audit row naming the old and the new mode (fixed codes, no secret).
