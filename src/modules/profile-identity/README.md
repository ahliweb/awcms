# Profile Identity

Profil person/organization sebagai identitas kanonik lintas modul.

## Schema

- `awcms_profiles` — `profile_type` (person/organization), `status`, `verification_status`, `risk_level`, `merged_into_profile_id`. Soft delete standar.
- `awcms_profile_identifiers` — identifier bertipe (email/phone/whatsapp/national_id/tax_id/external_code/other), disimpan sebagai `normalized_value` (bukan raw), `value_hash` (SHA-256, untuk dedup & resolve), `masked_value` (untuk ditampilkan). Unique per `(tenant_id, identifier_type, value_hash)` selama belum soft-deleted.
- `awcms_profile_entity_links` — pemetaan generik profile -> entitas modul lain (`module_key`, `entity_type`, `entity_id`), diisi oleh modul lain (mis. HR/vendor) lewat kode, bukan endpoint publik di sini.

Skema: `sql/003_awcms_central_profile_schema.sql`.

## Endpoint

- `GET/POST /api/v1/profiles`, `GET/PATCH/DELETE /api/v1/profiles/{id}` — guard `profile_identity.profile_management.{read,create,update,delete}`.
- `GET /api/v1/profiles/resolve?type=&value=` — resolve profile dari identifier (mis. email/NPWP), guard `read`.
- `POST /api/v1/profiles/{id}/identifiers` — tempel identifier baru ke profile, guard `create`.
- `GET /api/v1/profiles/{id}/links` — baca entity link (kosong sampai modul lain menulis lewat kode).

## Belum tersedia

Merge workflow (`awcms_profile_merge_requests` — tabel belum dibuat), channel komunikasi & alamat efektif-tanggal, restore/purge endpoint (permission `restore` sudah di-seed tapi belum ada konsumen), duplicate-candidate detection.
