🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0170-an-external-account-id-is-claimed-by-verification-where-a-connector-can-prove-it-with-a-platform-release-action-for-disputes.id.md)

# ADR-0170 — An external-account id is claimed by verification where a connector can prove it, with a platform release action for disputes

- **Status:** Accepted
- **Date:** 2026-11-22
- **Decision maker:** ahliweb (owner). Decision K2 of Issue [#1215](https://github.com/ahliweb/awcms/issues/1215), 22 November 2026: options **A + C**, option B rejected; the owner delegated the choice to the orchestrator with the priority order scalability, performance, security. Recorded on #1215 and in `docs/PROJECT_STATE.md` section 4 (PR #1434).
- **Amends:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) invariant **I1** (an external account is unique per `(tenant, provider, external id)`; a second tenant claiming it is refused), **only** as stated below: "unique per live id" becomes "unique per **claimed** id".
- **Extends:** [ADR-0053](0053-platform-scoped-permissions.md) (platform-scoped permissions), [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (a cross-tenant action is a platform gate, never a tenant permission), [ADR-0091](0091-two-sided-attribution.md) (an action by the platform is written in the affected tenant's trail without the individual), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md).
- **Related:** Issue #1215 (M4 of the first review, "external-id squatting"; the options were written up there), the module README [`src/modules/channel-accounts/README.md`](../../src/modules/channel-accounts/README.md), migration `sql/416`.

## Context

`channel_accounts` registers a tenant's connected external accounts (a page id, a WhatsApp phone number id, a bot id, a sender address, a StarSender device id). ADR-0148 I1 made the pair `(provider, external id)` unique **across tenants** for every live row, by `awcms_channel_accounts_live_external_key` (`sql/318`). A registration starts `pending`, **unverified**, and a `pending` row held that global claim.

That is a squatting defect (M4 of the first review). A tenant can register someone else's public id first, and the real owner then gets `409 ACCOUNT_ALREADY_REGISTERED`, the same answer a tenant gets for its own duplicate (so it is not an oracle, but it also leaves no recourse). Registration is cheap (`accounts.create`, no proof), and the ids are public.

The three options written on #1215:

- **A: claim only when verified.** The global unique index becomes partial on verified rows; a per-tenant unique remains for the rest.
- **B: claim expiry.** A platform job soft-deletes `pending` rows older than N days.
- **C: platform release action.** A platform-scoped, step-up, audited action that releases a contested claim after an out-of-band proof.

What the repository can prove today, found by reading the connectors (not assumed):

- `telegram_engagement`'s connector calls `getMe` with the account's own bot token and refuses the endpoint unless the returned bot id equals the account's external id (`BOT_IDENTITY_MISMATCH`); only then does it report the account healthy, which moves it to `connected` through `recordAccountHealth`.
- `email`'s sender verification asks Mailketing which senders it has verified for the account's token and connects a sender only when its address is on that list.
- No other connector reports health `ok`. The Graph API paths (`meta-cloud-provider`, `facebook-pages-adapter`) send; they do not bind an id to a connection's token. StarSender documents no side-effect-free status call, so `attest-device` is an operator's attestation, not proof. A Mailketing `esp_account` proves "this token works", not "this id is that token's account". A Telegram `channel` is not checked by `getMe`.
- Every move of an account into `connected` goes through ONE function, `recordAccountHealth`.

## Decision

### 1. The claim has a basis, and the basis is a column

`awcms_channel_accounts.claim_basis` (`text NOT NULL DEFAULT 'registration'`, `CHECK` in `('registration','verification')`) says how the row holds the global claim:

- `registration` (the default, and fail-closed): the row holds the claim from the moment it is live, in every status, until it is soft-deleted. This is exactly the behaviour of `sql/318`.
- `verification`: the row holds the claim only while its status is `connected` or `degraded`, i.e. after a connector proved control of the id. A `pending` row of this basis holds nothing against other tenants.

The application chooses the basis at INSERT from one code table (`claimBasisFor`, `VERIFIED_CLAIM_KINDS` in `provider-matrix.ts`). A trigger refuses any later change, for every role. Every row that exists when the migration runs keeps `registration`: **a claim is never released by a migration.**

### 2. The indexes

- `awcms_channel_accounts_live_external_key` is rebuilt as a partial unique on `(provider, account_kind, external_id) WHERE deleted_at IS NULL AND (claim_basis = 'registration' OR status IN ('connected','degraded'))`. **The kind is part of the key** (audit H1): without it a `telegram` `channel` registered with a bot's id would hold the claim the real owner's `bot` verification then loses, and a Mailketing `esp_account` named after a sender address would block that `sender_identity`; the same holes were also an existence oracle for verified ids.
- A new `awcms_channel_accounts_tenant_external_key` is unique on `(tenant_id, provider, account_kind, external_id) WHERE deleted_at IS NULL`. It is wider than the "`pending` rows" the decision named (it covers every live row of the tenant) because that is exactly today's behaviour for "yours" and avoids a second, narrower rule. Registration uses `ON CONFLICT DO NOTHING` with no target, so whichever index a row collides with answers the same.

The first to become `connected` wins and the unique index decides it, with no application lock: race-safe. A `pending` duplicate across tenants is accepted at registration with **no oracle**: a tenant cannot learn that another tenant holds, or even registered, an id of a `verification`-basis kind.

### 3. Which `(provider, kind)` claims by verification

Only the two pairs whose id a connector in this repository proves:

| `(provider, kind)`             | Basis          | The proof                                                                                               |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------- |
| `telegram` `bot`               | `verification` | `getMe` with the account's own token; bot id equals the external id; then health ok                     |
| `mailketing` `sender_identity` | `verification` | the provider's own verified-sender list holds the address; then health ok                               |
| every other pair               | `registration` | no call in the repository binds the id to the credential; the claim is held from registration as before |

"Every other pair" is WhatsApp Cloud (`waba`, `waba_phone_number`), Facebook, Instagram, Threads, TikTok, YouTube, LinkedIn, StarSender `device`, Mailketing `esp_account` and Telegram `channel`. A provider enters the `verification` table **in the same change as the connector call that proves it**; `tests/channel-accounts-claim-basis.test.ts` pins the table and the two proofs, so widening it on a hunch fails the build.

#### The shape of an external id (audit H1)

Keying the claim by kind removes the cross-kind squat; validating the shape of the id per kind keeps the namespaces from being made to overlap on purpose. A registration is refused with `422 EXTERNAL_ID_INVALID` unless the id has the shape of its kind, a check that depends only on the input and so answers the same for a held and a free id (no oracle):

- `telegram` `bot`: a positive integer; `telegram` `channel`: `-100<digits>` or `@username`, never a bare integer.
- `mailketing` `esp_account`: a label that is never an address (no `@`); `sender_identity`: the lowercase address.
- `whatsapp_cloud` `waba` and `waba_phone_number`: digits (5 to 25), as the connector already requires; `facebook` `page` and `instagram` `professional_account`: digits; `starsender` `device`: the device id pattern the connector already requires.
- Every other provider and kind (TikTok, YouTube, LinkedIn, Threads) is left open: this repository has not verified an official id format for them, and an over-tight guess would refuse a real account.

One spelling per id (audit L-d): a Telegram username is case-insensitive, so `@VictimChannel` is stored (and looked up by the release action) as `@victimchannel` and two spellings are one claim; numeric ids refuse a leading zero in their shape rather than being rewritten (`0123` and `123` cannot be two claims); a Mailketing sender is refused unless it is already lowercase. Left as written, because the provider semantics are not documented here: the Mailketing `esp_account` label and the StarSender device id (case-sensitive labels of the deployment, not public identifiers a victim owns).

The release action never schedules `deleteWebhook` for the Telegram bot of a loser (audit L-b): revoking a bot endpoint schedules the provider-side delete only when that endpoint was ever activated AND its account still holds the claim, because Telegram has one webhook per bot and an endpoint that never set it must not be able to switch off the winner's. The ticket reference is `^[A-Z]{2,10}-[0-9]{1,10}$` (audit L-a), so it cannot carry a phone number or an email-shaped token into the holder's trail; the erased-ciphertext flag in the audit rows is named `ciphertextErased` because key-name redaction prints any `credential...` or `secret...` attribute as `[REDACTED]`.

### 4. What the loser sees

`recordAccountHealth` runs the move to `connected` in a savepoint. When the unique index refuses it, the function returns `claim: "lost"`: the account stays `pending`, its health row becomes `failing` with reason `ACCOUNT_ALREADY_REGISTERED` (the same code a refused registration answers, naming no tenant), and the caller maps it to what it owns: the Telegram endpoint becomes `failed` with that code, an email sender is counted as not verified (and logged), and `attest-device` would answer `409 ACCOUNT_ALREADY_REGISTERED`. The account row itself is not written on a lost claim, because the connector roles that report health are held by RESTRICTIVE policies to `connected`/`degraded` writes; the signal is the health row. **The Telegram connector claims BEFORE it calls `setWebhook`** (audit L1): `getMe` proves the token, then `recordBotHealth` takes the claim in its own transaction, and only the winner goes on to `setWebhook`; the loser never calls Telegram again, so it cannot overwrite the winner's webhook.

### 5. The platform release action (option C)

`POST /api/v1/channel-accounts/claims/release` with `{ provider, accountKind, externalId, reasonCode, ticketRef?, reason }` ends the account of the tenant that holds the claim, so the real owner can register and verify. The operator verifies the claimant out of band; the action does not decide who is right.

- **Authority.** A new PLATFORM-scoped permission, `channel_accounts.account_claims.revoke` (`scope: "platform"` in the descriptor, `'platform'` in the seed, granted to the setup tenant's owner only, in no catalogue seeded to a tenant role; `tests/platform-scoped-permissions.test.ts` lists it). The chokepoint refuses it unless the acting tenant is the platform tenant, so a tenant owner receives the same uniform `403` as anyone without the grant. It also declares `requiresMfaEnrolment` (audit L3: a destructive, cross-tenant, `critical` action is never exercised on a password alone): an operator with no active factor is refused with `MFA_ENROLMENT_REQUIRED`, and the route then demands a fresh step-up unconditionally (`STEP_UP_REQUIRED`), which is safe because the enrolment gate already admitted only people who have a factor. A machine credential is refused; `Idempotency-Key` is required; a free-text `reason` of 10 to 500 characters is mandatory and may not contain an email address or a phone number. The only grant path is the migration, to the setup tenant's owner: `identity-access:permissions:backfill` filters `scope = 'tenant'` and never grants a platform permission, so a deployment whose platform tenant is not the setup tenant grants it with an explicit role-permission row there.
- **How it crosses the tenant boundary without bypassing RLS.** One narrow SECURITY DEFINER **read**, `awcms_find_channel_account_claim_holder(provider, account_kind, external_id)`, in the `sql/048`/`sql/119` shape: a NOLOGIN memberless owner role (`awcms_channel_claim_locator`), a SELECT policy for that role only, a fixed column list (eight columns, never the display name or a credential reference), EXECUTE for `awcms_app` only. It requires all three arguments (equality), returns at most the one row the unique index allows, and never writes. The release itself then runs in the **holder tenant's own RLS context** (the shape ADR-0091 gave the tenant birth record) with the steps a tenant's own delete takes, minus its "not while connected" refusal: credential ciphertext and webhook secrets erased, soft delete with the fixed reason `CLAIM_RELEASED_BY_PLATFORM`. The platform tenant is rebound before anything else is written. **Children (audit M1):** the locator never finds a `pending` verification-basis child, so a container with one would be unreleasable; the release therefore ends, in the same transaction and context, every live child that holds NO claim (its credential erased, a trail row each), while a child that DOES hold a claim still blocks the release (`409 HAS_CHILD_ACCOUNTS`) and is released by its own id.
- **Audit.** `critical` `channel_accounts.claim.release` in the platform tenant's trail (with the operator and the free-text `reason`) and `warning` `channel_accounts.account.claim_released` in the holder's trail, one per ended account (naming the platform tenant, not the individual, because the customer cannot resolve the operator's id). **The holder is the opposing party (audit M2)**, so its trail carries only the closed `reasonCode` (`ownership_dispute_resolved`, `registered_in_error`, `abuse_confirmed`) and an optional ticket reference of a narrow pattern, never the operator's free text, which stays in the platform trail. No row carries the external id or any credential.
- **Not built:** the operator screen. The permission is in `NOT_YET_SCREENED`.

### 6. What is deliberately not decided here

- **Option B is rejected.** See Alternatives.
- A Graph API account is not made verifiable here. When its connector reports health `ok` through `recordAccountHealth`, that change adds the pair to the table.

## Consequences

- **Positive:** the squat is closed for the two providers where a proof exists (the cases that matter most for a bot and a sender), with no new job, no new role that writes, no timer and no policy constant (option B's N). The conflict is decided by one unique index, so it scales with the number of accounts, not with a sweep. Every other provider keeps today's fail-closed behaviour, and now has a dispute path where it had none. The release action cannot be reached from a tenant, and the cross-tenant read it needs is the narrowest the repository already uses.
- **Negative / trade-off:** two classes of provider now behave differently, and a reader has to know which (the table above, pinned by a test). For a `verification` kind a tenant can have a `pending` row for an id it does not control; it can never connect it, but it keeps an unusable row until it deletes it. A `registration`-basis squat is still possible until the operator releases it. The release action needs a person (an operator) and an out-of-band decision; it does not scale to many disputes, and that is acceptable only while disputes are rare. The loser of a `verification` race learns it lost (a health reason on its own account), not who won.
- **Neutral:** `security:readiness` pins the column, its CHECK, both indexes and the locator (role, columns, owner, `search_path`, body, EXECUTE) exactly, and runs a rolled-back probe of the whole behaviour including the cross-kind cases; the access guards pin the immutability trigger. The external id of every kind is validated for SHAPE at registration (below), independent of any stored data, so the refusal is the same for a held and a free id.

## Alternatives considered

- **B: claim expiry (a platform job soft-deletes `pending` rows older than N days).** Rejected by the owner. It narrows the window and does not remove it (re-register every N days); it is a cross-tenant job, so it needs a dedicated role, the dedicated-role job class and a cross-tenant read of other tenants' claims that RLS forbids by design; and N is a policy constant someone must choose and defend. It also deletes a legitimate slow registration. It scales worse than a unique index (a sweep over all tenants) and gives a weaker guarantee.
- **Verification for every provider, with unverifiable ones claiming on `connected` too.** Rejected. For StarSender and the Graph API providers `connected` is an operator's attestation or nothing at all today, so claiming at that moment would let a squatter attest first. It would trade the squat for a worse one (the first liar wins) while looking like a fix.
- **Make the basis a function of the provider matrix instead of a column.** Rejected: an index predicate cannot read application code, so the global index would need a hard-coded provider list in SQL that a migration must change with every connector, and the immutable per-row basis is what lets a row keep the claim it was created under.
- **A global claim registry table maintained by triggers.** Rejected: a second source of truth for the same fact, written by a definer function with write privilege across tenants, to avoid a single partial index.
- **Release by deleting through a definer function that does everything.** Rejected: the credential ciphertext and the webhook secrets live in other tables with their own RLS, so a definer that erases them needs write privileges on those tables, widening the cross-tenant surface far beyond one read. Running the release in the holder's own RLS context reuses the tenant's own delete code.

## Evaluation against the 11 criteria

| #   | Criterion                    | Assessment                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Advantages and disadvantages | **+** Removes the squat where a proof exists, no oracle, no new job, race-safe by a unique index, every other provider unchanged and now with a dispute path. **−** Two behaviours to know, a manual and rare dispute path, a `pending` row an owner of nothing can hold for a `verification` kind.                                                                                                                 |
| 2   | Security                     | Fail-closed default basis (registration) and an immutable column; a row cannot choose to hold less. The only cross-tenant read is one equality lookup of eight columns by a NOLOGIN owner; the action is platform-scoped, step-up, idempotent and audited in both trails. Pinned by exact `security:readiness` checks and a probe.                                                                                  |
| 3   | Performance                  | One partial unique index lookup per registration or verification; the existing path is unchanged for `registration` rows. The per-tenant index adds one small index. No sweep, no job. `recordAccountHealth` adds one savepoint on the `ok` path.                                                                                                                                                                   |
| 4   | Maintenance                  | One small code table (`VERIFIED_CLAIM_KINDS`) changed together with its connector and pinned by a test; one migration; the guards live with the existing channel-account pins.                                                                                                                                                                                                                                      |
| 5   | Scalability                  | The conflict is decided in the index at write time, independent of the number of tenants; no cross-tenant scan. The release action is human-paced by design.                                                                                                                                                                                                                                                        |
| 6   | Accessibility                | No UI change. The operator screen is not built; when it is, it carries the WCAG contract of the other platform screens (labelled reason field, step-up prompt, confirmation naming the consequence).                                                                                                                                                                                                                |
| 7   | SEO                          | Not applicable: no public page changes.                                                                                                                                                                                                                                                                                                                                                                             |
| 8   | UI/UX                        | A loser of a verification sees the existing health surface (`failing`, reason `ACCOUNT_ALREADY_REGISTERED`) rather than a silent pending. The release flow is API-only for now.                                                                                                                                                                                                                                     |
| 9   | Compatibility                | Forward-only migration; existing rows keep `registration`; the registration answers are unchanged for every existing provider; the new endpoint and the `claim: "lost"` result are additive. OpenAPI documents the new route and the `409` on `attest-device`.                                                                                                                                                      |
| 10  | Operational complexity       | No new job or environment variable. One new NOLOGIN role (owner of a read-only function), one platform permission that requires an enrolled MFA factor and is granted by the migration to the setup tenant's owner only (the backfill job never grants it; a platform tenant other than the setup tenant needs an explicit role-permission row). A runbook line for the operator: verify out of band, then release. |
| 11  | Long-term implications       | The table is the checklist for every future connector: a provider that can prove its id moves from `registration` to `verification` in the same change. The platform release action and its locator generalise to any future cross-tenant dispute. Rows created under `registration` keep that claim for their lifetime.                                                                                            |

## Open questions

None blocking. Two follow-ups are recorded in the module README:

1. A Graph API account joins `VERIFIED_CLAIM_KINDS` in the change in which its connector reports health `ok`.
2. (Closed in this revision, audit L1.) The Telegram connector now claims before `setWebhook`.
