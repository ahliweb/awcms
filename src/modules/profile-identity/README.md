🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Profile Identity

Person/organization profiles as the canonical cross-module identity.

## Schema

- `awcms_profiles` — `profile_type` (person/organization), `status`, `verification_status`, `risk_level`, `merged_into_profile_id`. Standard soft delete.
- `awcms_profile_identifiers` — typed identifiers (email/phone/whatsapp/national_id/tax_id/external_code/other), stored as `normalized_value` (not raw), `value_hash` (SHA-256, for dedup & resolve), `masked_value` (for display). Unique per `(tenant_id, identifier_type, value_hash)` for as long as it is not soft-deleted.
- `awcms_profile_entity_links` — a generic mapping from a profile -> another module's entity (`module_key`, `entity_type`, `entity_id`), filled in by other modules (e.g. HR/vendor) through code, not through a public endpoint here.

Schema: `sql/003_awcms_central_profile_schema.sql`.

### Masking

`maskIdentifierValue` (`domain/identifier.ts`) has two shapes: an email-shaped value (contains `@` with a non-empty local part) keeps the domain plus the first letter of the local part (`b***********@example.com`) so an admin can still tell rows apart in the email outbox/suppression list; everything else (phone/NIK/tax id/...) keeps only the last 4 characters, and keeps nothing at all when the value is <= 4 characters. The email branch is detected from the value itself, not from a type argument — the email module uses this function for addresses that never become a profile identifier and have no `IdentifierType` to pass.

## Endpoints

- `GET/POST /api/v1/profiles`, `GET/PATCH/DELETE /api/v1/profiles/{id}` — guard `profile_identity.profile_management.{read,create,update,delete}`.
- `GET /api/v1/profiles/resolve?type=&value=` — resolve a profile from an identifier (e.g. email/NPWP), guard `read`.
- `POST /api/v1/profiles/{id}/identifiers` — attach a new identifier to a profile, guard `create`. `409 IDENTIFIER_ALREADY_EXISTS` when the identifier (type + value) already exists in this tenant — its unique index (`23505`) is translated into `DuplicateIdentifierError` in `application/identifier-directory.ts`, then mapped to 409 **inside** `withTenant` (if it escapes outward, that error is not a `PostgresError` and therefore counts against the database circuit breaker).
- `POST /api/v1/profiles/{id}/restore` — the counterpart of the `DELETE` above, guard `restore`, `Idempotency-Key` required ([ADR-0058](../../../docs/adr/0058-unenforced-permissions-disposition.md) §A). Clears `deleted_at`/`deleted_by` and stamps `restored_at`/`restored_by`; **`delete_reason` is kept** — the deletion reason stays true after the profile is restored, and it is `restored_at` that states the deletion no longer applies. Its precondition lives in `WHERE … deleted_at IS NOT NULL`, not in a read-then-write: two concurrent restores that both read first will both proceed and write two audit rows for one restoration. A profile that does not exist and a profile that is not deleted answer with **the same 404** — a distinguishable answer would turn this route into a profile-id oracle.
- `GET /api/v1/profiles/{id}/links` — read entity links (empty until another module writes through code).

The admin screen `admin/profiles.astro` now has a create-profile form gated on the permission `profile_identity.profile_management.create` that POSTs to `POST /api/v1/profiles` (cookie auth, CSP-safe external script).

## Profiles for accounts created by other modules

`awcms_identities.profile_id` `NOT NULL` references `awcms_profiles`, so
**creating a login identity structurally requires a profile to exist**.
`application/person-profile.ts` `createPersonProfileForIdentity` is the
only way another module obtains one — this module remains the sole
writer of its tables (ADR-0013 §6), enforced by
`bun run modules:table-writes:check`.

Previously every identity-creating path wrote its own row, and the two had
**already drifted**: SSO JIT provisioning (#185) set
`verification_status='verified'`, while self-registration approval (#276)
left it at the default — two accounts created minutes apart got a different
verification posture without anyone ever having decided it. The argument is
now explicit (`emailVerified`), and `false` (the default) means there is no
evidence yet of control over the address: a reviewer's say-so is not evidence,
the reset link the approval sends is the evidence.

This function deliberately does **not** write an audit event — `createParty`
(its operator-facing sibling) does, and needs `actorTenantUserId`; here it is
the caller that holds the audit over the actual decision (`registration_approved`,
JIT login). `tenant_admin/application/platform-bootstrap.ts` does **not** go
through here (a reasoned exception in the gate: a one-shot wizard that creates
tenant → office → profile → identity → role in ONE transaction, before any
module can be called through its normal surface).

## Not yet available

Merge workflow (`awcms_profile_merge_requests` — the table has not been created), communication channels & effective-dated addresses, restore/purge endpoint (the `restore` permission is already seeded but has no consumer yet), duplicate-candidate detection.
