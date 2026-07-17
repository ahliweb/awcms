# Profile Identity

Profil person/organization sebagai identitas kanonik lintas modul.

## Schema

- `awcms_profiles` — `profile_type` (person/organization), `status`, `verification_status`, `risk_level`, `merged_into_profile_id`. Soft delete standar.
- `awcms_profile_identifiers` — identifier bertipe (email/phone/whatsapp/national_id/tax_id/external_code/other), disimpan sebagai `normalized_value` (bukan raw), `value_hash` (SHA-256, untuk dedup & resolve), `masked_value` (untuk ditampilkan). Unique per `(tenant_id, identifier_type, value_hash)` selama belum soft-deleted.
- `awcms_profile_entity_links` — pemetaan generik profile -> entitas modul lain (`module_key`, `entity_type`, `entity_id`), diisi oleh modul lain (mis. HR/vendor) lewat kode, bukan endpoint publik di sini.

Skema: `sql/003_awcms_central_profile_schema.sql`.

### Masking

`maskIdentifierValue` (`domain/identifier.ts`) punya dua bentuk: nilai berbentuk email (ada `@` dengan local part tidak kosong) menyisakan domain + huruf pertama local part (`b***********@example.com`) supaya admin masih bisa membedakan baris di email outbox/suppression list; sisanya (phone/NIK/tax id/...) hanya menyisakan 4 karakter terakhir, dan tidak menyisakan apa pun bila nilainya <= 4 karakter. Cabang email dideteksi dari nilainya sendiri, bukan argumen tipe — modul email memakai fungsi ini untuk alamat yang tidak pernah jadi profile identifier dan tidak punya `IdentifierType` untuk dioper.

## Endpoint

- `GET/POST /api/v1/profiles`, `GET/PATCH/DELETE /api/v1/profiles/{id}` — guard `profile_identity.profile_management.{read,create,update,delete}`.
- `GET /api/v1/profiles/resolve?type=&value=` — resolve profile dari identifier (mis. email/NPWP), guard `read`.
- `POST /api/v1/profiles/{id}/identifiers` — tempel identifier baru ke profile, guard `create`. `409 IDENTIFIER_ALREADY_EXISTS` bila identifier (tipe + nilai) sudah ada di tenant ini — unique index-nya (`23505`) diterjemahkan jadi `DuplicateIdentifierError` di `application/identifier-directory.ts`, lalu dipetakan ke 409 **di dalam** `withTenant` (kalau lolos ke luar, error itu bukan `PostgresError` sehingga ikut menghitung circuit breaker database).
- `GET /api/v1/profiles/{id}/links` — baca entity link (kosong sampai modul lain menulis lewat kode).

## Belum tersedia

Merge workflow (`awcms_profile_merge_requests` — tabel belum dibuat), channel komunikasi & alamat efektif-tanggal, restore/purge endpoint (permission `restore` sudah di-seed tapi belum ada konsumen), duplicate-candidate detection.
