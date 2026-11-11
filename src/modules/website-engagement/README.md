🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `website_engagement`

Tenant-scoped **website lead and contact capture** and inbound website interaction events (Issue #1153, [ADR-0155](../../../docs/adr/0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.md); design and security notes in [`docs/awcms/website-engagement.md`](../../../docs/awcms/website-engagement.md)).

A tenant's website posts a contact request, a lead or an interaction to ONE public, unauthenticated-by-design endpoint, `POST /api/v1/website-engagement/submissions`. A request is accepted only with an opaque per-**source** token (stored only as a keyed hash, shown once) **and** an `Origin` host registered for that source, within per-address and per-source rate limits, behind an optional Turnstile challenge, against a **closed, versioned** field set. It is stored with **explicit consent provenance** and source attribution, its contact details encrypted at rest, and announced by an outbox event that a CRM adapter consumes.

**Intake only.** It is not a CRM, a lead pipeline, a forms engine or a chat widget; it creates, matches and merges no person, infers no visitor identity (no fingerprint, cookie, IP or user agent is stored), accepts no HTML or upload and makes no outbound request while ingesting. The embeddable widget was assessed and **not built** (see the design doc).

- **Tables** (`sql/325`): `awcms_engagement_sources`, `awcms_engagement_source_domains`, `awcms_engagement_submissions`; RLS `FORCE`, `WITH CHECK`; integrity guards in `sql/327`; permissions in `sql/326`.
- **Events**: `awcms.website_engagement.submission.received` and `...submission.withdrawn` (AsyncAPI), carrying an opaque reference, never the visitor's details.
- **Admin API**: sources (create, change, rotate, revoke, delete), masked submission reads, an audited **reveal**, and the controller's **withdrawal**; every route is default-deny and `experimental` with no navigation entry until the screen lands.
- **Retention**: declared in `module.ts` through `data_lifecycle` (default 180 days).
- **Configuration**: TWO key rings, `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS` (contact details) and `WEBSITE_ENGAGEMENT_HASH_KEYS` (source-token and identifier hashes), both required to store anything (fail closed) and sharing no key (ADR-0137 section 3, Issue #1262): with each other, enforced at runtime and by `config:validate`; with another module's ring or single-key secret, enforced by `config:validate`; the optional, transitional `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS`; and the rate-limit variables in `.env.example`.

Layout: `domain/` (pure: token, validator, origin policy, events, messages, key rings), `application/` (source and submission directories, the intake, the public handler, key-transition counts), `module.ts`. Routes live under `src/pages/api/v1/website-engagement/`.

## Key rings and the single-ring transition (Issue #1262)

Until Issue #1262 one ring, `WEBSITE_ENGAGEMENT_KEYS`, both encrypted contact details and keyed every hash, which ADR-0137 section 3 forbids: a leaked key exposed the ciphertext and the hash oracle at once. It is now **retired**: if it is still set, every route that hashes or decrypts (the public intake, source create and rotate, and reveal) answers 503 (`KEY_RING_UNAVAILABLE` with a generic "key configuration was refused" message, or the generic public refusal) and logs a fixed cause code (`retired_variable`, `missing_or_invalid` or `conflicting_keys`, never a value); `config:validate` fails by name. It is never silently used for either role. Routes that touch no key material (lists, masked reads, update, revoke, delete, withdraw) keep working.

| Variable                              | Role                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS`  | First key encrypts new contact details; every key decrypts.                                                       |
| `WEBSITE_ENGAGEMENT_HASH_KEYS`        | First key writes every new token and identifier hash; every key verifies.                                         |
| `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS` | Transitional, verify-only: accepted when a source token (or an older identifier hash) is looked up; never writes. |

Rules checked by the same predicate at runtime **and** in `config:validate`:

- the encryption and hash rings share no key;
- a legacy key is neither a current hash key (by material) nor a current hash key id;
- a legacy key is never the **first** (writing) encryption key;
- a legacy key and an encryption key agree exactly: the same id means the same material, and the same material keeps the same id;
- neither ring's first (writing) key uses a legacy key id.

Checked by `config:validate` only: no ring or legacy key shares material with another module's ring or with the deployment's single-key secrets (the runtime does not read other modules' variables).

**Never reuse a key id for new material.** A key id names the material that wrote a row. Writing a NEW key as `k1` while old rows say `k1` makes every old row look current while it no longer opens. Give every new key a new id; the rules above refuse the cases the configuration can see, and `security:readiness` catches the rest by decrypting one sample ciphertext per encryption key id and recomputing one sample identifier hash per hash key id (it reports key ids only, never a value).

**Runbook for an existing deployment** whose old ring was `k1:<OLD>`:

1. Generate two new keys (`openssl rand -base64 32` twice).
2. Set `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS=e2:<NEW_E>,k1:<OLD>` (old key last: it only decrypts old submissions), `WEBSITE_ENGAGEMENT_HASH_KEYS=h1:<NEW_H>` and `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS=k1:<OLD>`; unset `WEBSITE_ENGAGEMENT_KEYS`.
3. Run `bun run config:validate`, then deploy. Every existing source token keeps working: it verifies through the legacy key and, on its first accepted submission, its stored hash is re-written under `h1` (a compare-and-swap, so a rotation that lands meanwhile is never undone). New submissions are encrypted under `e2` and hashed under `h1`.
4. Watch `bun run security:readiness`: "Website engagement source tokens are under the active hash key" lists live sources per key id and fails if a sample does not verify under the configured material. Any token matched under a key other than the active hash key is re-hashed on its next accepted submission (the transition's legacy key, and equally an older key after an ordinary hash-ring rotation). Rotate any source that does not submit (`POST /api/v1/website-engagement/sources/{id}/rotate`). When no live source is left on `k1`, unset `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS`.
5. "Website engagement contact ciphertexts are under the active key" lists stored contact ciphertexts per key id and fails if a sample per key id does not decrypt. Remove `k1` from the encryption ring only when it reaches zero there **and** in every backup you may restore (ADR-0137 section 2).

Identifier hashes (`email_hash`, `phone_hash`) written before the transition stay under `k1`; no reader in this repository looks them up today, and they resolve through `lookupHashCandidates` only while the legacy keys are configured. A future consumer that looks them up must keep the legacy keys until step 5 reaches zero.

**Open decision (fail closed).** There is deliberately **no re-encryption or re-hash job** for submissions: a submission is append-only evidence and the `sql/327` guard refuses any rewrite of its ciphertext or hashes outside a withdrawal. Old rows therefore leave through the retention purge (default 180 days) or a withdrawal, and the old key stays a decrypt-only key until then. Loosening the evidence guard to allow an in-place re-key is a separate decision (it would let the application rewrite stored evidence) and is not taken here.

## Residual risks

- Offline/LAN profile without Turnstile: a leaked token plus a forged non-browser Origin is bounded only by the per-address limit (IPv6 /64 keyed), the per-source budgets and retention.
- The limiters are in-process unless Redis is configured.
- The preflight reveals whether a hostname is an active tenant domain of the deployment (as `newsletter` does).
- Attribution fields are a closed charset but cannot prove a value is not personal.
- A double-click on a challenged form can fail the second (single-use) challenge.
- Audit items L3, L5 and the informational findings are accepted as recorded in the audit report and are not addressed in this slice.
- No public withdrawal channel, no server-to-server mode, no rotation grace window, no admin screen.
