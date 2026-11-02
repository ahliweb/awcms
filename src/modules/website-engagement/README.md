🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `website_engagement`

Tenant-scoped **website lead and contact capture** and inbound website interaction events (Issue #1153, [ADR-0155](../../../docs/adr/0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.md); design and security notes in [`docs/awcms/website-engagement.md`](../../../docs/awcms/website-engagement.md)).

A tenant's website posts a contact request, a lead or an interaction to ONE public, unauthenticated-by-design endpoint, `POST /api/v1/website-engagement/submissions`. A request is accepted only with an opaque per-**source** token (stored only as a keyed hash, shown once) **and** an `Origin` host registered for that source, within per-address and per-source rate limits, behind an optional Turnstile challenge, against a **closed, versioned** field set. It is stored with **explicit consent provenance** and source attribution, its contact details encrypted at rest, and announced by an outbox event that a CRM adapter consumes.

**Intake only.** It is not a CRM, a lead pipeline, a forms engine or a chat widget; it creates, matches and merges no person, infers no visitor identity (no fingerprint, cookie, IP or user agent is stored), accepts no HTML or upload and makes no outbound request while ingesting. The embeddable widget was assessed and **not built** (see the design doc).

- **Tables** (`sql/325`): `awcms_engagement_sources`, `awcms_engagement_source_domains`, `awcms_engagement_submissions`; RLS `FORCE`, `WITH CHECK`; integrity guards in `sql/327`; permissions in `sql/326`.
- **Events**: `awcms.website_engagement.submission.received` and `...submission.withdrawn` (AsyncAPI), carrying an opaque reference, never the visitor's details.
- **Admin API**: sources (create, change, rotate, revoke, delete), masked submission reads, an audited **reveal**, and the controller's **withdrawal**; every route is default-deny and `experimental` with no navigation entry until the screen lands.
- **Retention**: declared in `module.ts` through `data_lifecycle` (default 180 days).
- **Configuration**: `WEBSITE_ENGAGEMENT_KEYS` (required to store anything; fail closed) and the rate-limit variables in `.env.example`.

Layout: `domain/` (pure: token, validator, origin policy, events, messages), `application/` (source and submission directories, the intake, the public handler), `module.ts`. Routes live under `src/pages/api/v1/website-engagement/`.
