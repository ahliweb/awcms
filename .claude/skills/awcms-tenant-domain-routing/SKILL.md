---
name: awcms-tenant-domain-routing
description: Modul tenant_domain SUDAH di-port ke repo ini (dari awcms-micro epic #555). Pemetaan hostname/subdomain → tenant untuk routing publik berbasis host, hidup berdampingan dengan routing berbasis path `/blog/{tenantCode}` (ADR-0009) tanpa meregresinya. Gunakan saat mengubah skema/API/UI tenant domain, resolver tenant berbasis host, fungsi lookup `SECURITY DEFINER`, adapter Cloudflare DNS opsional, atau saat mem-wire rute konten publik ber-resolusi host (masih deferred). Merangkum keputusan desain yang mengikat supaya perubahan lanjutan tidak mengulang/kontradiksi.
---

# AWCMS — Tenant Domain & Host-Based Public Routing

Modul `tenant_domain` memetakan hostname/subdomain publik ke sebuah tenant,
membuktikan kepemilikan (manual-first), dan memilih satu domain **primary**
aktif per tenant. Ia adalah seam data + resolver yang akan dibaca oleh rute
konten publik ber-resolusi host di masa depan untuk menjawab "Host header ini
milik tenant mana?" TANPA `tenantCode` di path.

**Additive, bukan pengganti.** Routing berbasis path `/blog/{tenantCode}`
(ADR-0009) tetap utuh dan tetap jadi mekanisme untuk rute itu. `src/middleware.ts`
TIDAK disentuh — resolusi host adalah urusan per-rute-publik, bukan middleware,
jadi jaminan login/Turnstile/CSP tak berubah.

## Kapan pakai skill ini vs skill generik

Melengkapi (bukan menggantikan) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-new-module`, `awcms-abac-guard`, `awcms-idempotency`. Skill ini
menyediakan konteks lintas-file spesifik `tenant_domain` supaya perubahan
lanjutan tidak meregresi keputusan desain yang mengikat.

## Peta kode (yang SUDAH ada di repo ini — pakai ulang, jangan re-derive)

| Bagian          | Lokasi                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Descriptor      | `src/modules/tenant-domain/module.ts` (`type: "domain"`, terdaftar di `src/modules/index.ts`)  |
| Skema           | `sql/046_awcms_tenant_domain_schema.sql` — `awcms_tenant_domains`                              |
| Permission seed | `sql/047_awcms_tenant_domain_permissions.sql` — `tenant_domain.domains.*`                      |
| Fungsi lookup   | `sql/048_awcms_tenant_domain_lookup_function.sql` — `awcms_resolve_tenant_domain_lookup(text)` |
| Validasi        | `src/modules/tenant-domain/domain/tenant-domain-validation.ts`                                 |
| DNS config      | `src/modules/tenant-domain/domain/tenant-domain-dns-config.ts`                                 |
| Directory       | `src/modules/tenant-domain/application/tenant-domain-directory.ts`                             |
| Cloudflare      | `src/modules/tenant-domain/infrastructure/cloudflare-dns-adapter.ts` (opsional, belum di-wire) |
| Resolver publik | `src/lib/tenant/public-host-tenant-resolver.ts`                                                |
| API             | `src/pages/api/v1/tenant/domains/index.ts`, `[id].ts`, `[id]/verify.ts`, `[id]/set-primary.ts` |
| Admin UI        | `src/pages/admin/tenant/domains.astro` (+ nav di `src/layouts/AdminLayout.astro`)              |
| OpenAPI         | `openapi/modules/tenant-domain.openapi.yaml`                                                   |

## Skema (`awcms_tenant_domains`, migrasi 046)

- `hostname` (raw, case dipertahankan) + `normalized_hostname`
  (`lower(btrim(hostname))`, dijaga CHECK
  `awcms_tenant_domains_normalized_hostname_matches_check`). Unique index
  `awcms_tenant_domains_normalized_hostname_dedup` pada `normalized_hostname
WHERE deleted_at IS NULL` bersifat **GLOBAL (lintas-tenant)** — satu hostname
  cuma boleh milik satu tenant. Soft delete membebaskannya untuk dipakai ulang.
- `domain_type` (`subdomain`|`custom_domain`), `route_mode`
  (`canonical`|`legacy_blog` — kolom disiapkan, belum dikonsumsi resolver).
- `status` (`pending_verification`|`active`|`suspended`|`failed`); soft delete
  (`deleted_at`/`deleted_by`/`delete_reason`) adalah state "tidak resolve"
  terpisah, tidak digabung ke enum.
- `is_primary` + `redirect_to_primary`; satu primary aktif per tenant
  (`awcms_tenant_domains_primary_dedup`, partial unique index).
- `verification_method` + `verification_record_name`/`verification_record_value`
  (nilai DNS PUBLIK yang dipublish tenant — BUKAN secret).
  `verification_token_hash` adalah hash bearer-token internal dan **tidak pernah**
  di-`SELECT`/dikembalikan oleh kode modul manapun.
- RLS `ENABLE` + `FORCE` + policy `tenant_isolation` standar. **Jangan lepas
  FORCE** untuk menyiasati bootstrap gap resolver — itu tugas fungsi 048.
- GRANT ke `awcms_app` otomatis lewat `ALTER DEFAULT PRIVILEGES` (sql/019); tidak
  ada grant `<worker-role>` (modul ini tak punya background job).

**Tidak ada kolom yang menyimpan kredensial provider DNS.** Token/zone Cloudflare
hanya dari env `TENANT_DOMAIN_CLOUDFLARE_*`.

## Fungsi lookup `SECURITY DEFINER` (migrasi 048)

`awcms_resolve_tenant_domain_lookup(p_normalized_hostname text)` — satu-satunya
jalur baca bootstrap yang disahkan untuk resolusi host→tenant SEBELUM ada tenant
context (`app.current_tenant_id` GUC). Kenapa aman — **JANGAN** andalkan asumsi
"owner migrasi superuser → fungsi bypass RLS": itu SALAH di posture hardened
repo ini. Fungsi `SECURITY DEFINER` jalan dengan hak **owner-nya saat dipanggil**,
dan sql/019–022 sengaja menjalankan runtime sebagai role NON-superuser
NOBYPASSRLS; deployment role-separated (dan integration harness, yang men-demote
owner migrasi ke `NOSUPERUSER NOBYPASSRLS` tepat setelah migrasi) tidak
menyisakan superuser yang meng-own fungsi ini. Owner non-superuser tunduk penuh
pada `FORCE RLS` → fungsi akan resolve **0 baris** untuk setiap host. Jadi
keamanan bootstrap **bukan** dari bypass, melainkan:

- **Owner role khusus `awcms_domain_bootstrap`** — `NOLOGIN NOSUPERUSER
NOBYPASSRLS`, dibuat idempoten (pola sama sql/019/022, cluster-scoped). Fungsi
  di-`ALTER FUNCTION ... OWNER TO awcms_domain_bootstrap` → eksekusi sebagai role
  ini. NOLOGIN + **tanpa anggota** (khususnya `awcms_app` bukan anggota; reassign
  owner memakai owner migrasi SUPERUSER, **tanpa** grant membership ke siapa pun)
  → tak ada yang bisa `SET ROLE` ke situ; satu-satunya kode yang jalan sebagai
  role ini adalah fungsi ini.
- **Policy baca ter-scope** `awcms_tenant_domains_bootstrap_read` — permissive
  `FOR SELECT TO awcms_domain_bootstrap USING (true)`, di-OR dengan (bukan ganti)
  `tenant_isolation`. RLS mencocokkan role policy lewat membership, jadi policy
  ini berlaku HANYA saat role adalah/anggota `awcms_domain_bootstrap` — yakni
  HANYA di dalam fungsi ini. `SELECT` langsung `awcms_app` tetap cuma kena
  `tenant_isolation` → fail-closed. `FORCE RLS` + policy `tenant_isolation`
  sql/046 **tidak** disentuh. `awcms_domain_bootstrap` juga butuh `GRANT SELECT`
  eksplisit di `awcms_tenant_domains` + `awcms_tenants` (privilege tabel terpisah
  dari policy RLS).
- Pagar tambahan (bukan sumber utama keamanan, tapi wajib): (1) badan fungsi SQL
  statis, hanya me-return 8 kolom non-sensitif untuk satu `normalized_hostname`
  terparameterkan + `deleted_at IS NULL` — **daftar kolom** itu batasnya, tak
  bisa membaca `verification_token_hash`/`verification_record_value`/`hostname`
  mentah walau policy mengizinkan SELECT seluruh tabel; (2) `EXECUTE` di-`REVOKE`
  dari `PUBLIC`, di-`GRANT` hanya ke `awcms_app`. `awcms_app` tetap tidak bisa
  `SELECT` langsung dari tabel tanpa `withTenant`.
- `SET search_path = public, pg_temp` + `STABLE`.
- JOIN ke `awcms_tenants` (sudah RLS-free, ADR-0003) di dalam fungsi yang sama
  supaya resolver butuh **tepat satu round-trip** untuk setiap outcome — hindari
  timing side-channel antara "host tak dikenal" vs "host ada tapi tenant
  non-aktif". **Jangan** memecah ini jadi query kedua bersyarat.

Diverifikasi terhadap Postgres nyata (docker `psql`, mereplikasi owner
ter-demote `NOSUPERUSER NOBYPASSRLS` seperti harness): `SELECT` langsung
`awcms_tenant_domains` di bawah `awcms_app` dengan GUC fail-closed → 0 baris;
`awcms_resolve_tenant_domain_lookup(...)` → 1 baris (owner fungsi non-superuser);
drop policy bootstrap → fungsi balik 0 baris (bukti policy load-bearing);
`awcms_app` tetap tak bisa baca `verification_token_hash`.

## Resolver publik (`public-host-tenant-resolver.ts`)

`resolvePublicTenantFromRequest(sql, request|host, config, deps?)` — urutan:

0. `mode === "tenant_code_legacy"` → langsung `null` (operator eksplisit opt-out
   dari tebakan tenant default). Mode `undefined` (default offline/LAN) **TIDAK**
   sama — tetap jalankan fallback penuh.
1. host lookup (`resolvePublicTenantByHost`) — HANYA saat
   `mode === "host_default"`, lewat fungsi 048.
2. `PUBLIC_DEFAULT_TENANT_ID` → 3. `PUBLIC_DEFAULT_TENANT_CODE` → 4.
   `awcms_setup_state.tenant_id` → 5. `null` (404 generik).

Langkah 2-4 (safe fallback) jalan untuk setiap mode KECUALI
`tenant_code_legacy`. Hanya `domain_status === 'active' &&
tenant_status === 'active'` yang resolve — kombinasi lain return `null` identik.
`X-Forwarded-Host` dibaca hanya saat `config.trustProxy === true`; header
multi-value dianggap anomali → log + fallback ke `Host` biasa.
`normalizePublicHost()` di-reuse oleh validasi API (bukan opini shape kedua) dan
hanya throw untuk string kosong (pelanggaran kontrak pemanggil).

## API manajemen (`/api/v1/tenant/domains`)

Authenticated, tenant-scoped, guard di chokepoint identity-access
(`authorizeInTransaction`, default-deny ABAC) di dalam `withTenant`. Setiap query
jalan di bawah RLS `FORCE` (defense-in-depth di atas filter `tenant_id`) —
**tidak pernah** lewat fungsi `SECURITY DEFINER` (itu eksklusif resolver publik).

```txt
GET    /api/v1/tenant/domains              list, keyset-paginated (limit 100)
POST   /api/v1/tenant/domains              create
GET    /api/v1/tenant/domains/{id}         read one
PATCH  /api/v1/tenant/domains/{id}         partial update
DELETE /api/v1/tenant/domains/{id}         soft delete (reason wajib)
POST   /api/v1/tenant/domains/{id}/verify        manual-first verify (Idempotency-Key)
POST   /api/v1/tenant/domains/{id}/set-primary   atomic primary swap (Idempotency-Key)
```

Keputusan mengikat:

- `hostname` **immutable** setelah create (re-point = delete + create ulang);
  `is_primary` tak pernah settable lewat `PATCH` generik (satu-satunya jalur =
  `set-primary`); `PATCH` tak pernah bisa set `status: "active"` (pakai verify).
- Duplikat normalized hostname → `409 HOSTNAME_CONFLICT` generik, tak pernah
  membocorkan apakah milik tenant lain. Unknown/cross-tenant/deleted id → `404`
  generik (filter `tenant_id`/`deleted_at IS NULL` + RLS FORCE).
- `verify`/`set_primary` wajib `Idempotency-Key` (scope
  `tenant_domain_verify`/`tenant_domain_set_primary`) dan diaudit, meski
  keduanya **tidak** `HIGH_RISK` (union `AccessAction` diperluas dengan
  `set_primary`; `verify` sudah ada dari news_portal). `verify` manual-first,
  tanpa panggilan DNS/HTTP keluar.
- ⚠️ **RISIKO RESIDUAL M1 (dangling-DNS takeover) — gerbangi sebelum
  self-service custom domain tak-tepercaya.** `verify` mengaktifkan domain tanpa
  bukti kepemilikan outbound; hostname yang di-soft-delete bisa didaftar ulang
  tenant lain (unique index `WHERE deleted_at IS NULL`). Untuk `custom_domain`
  bersama: pertahankan aktivasi **digerbangi operator/manual**, ATAU wire bukti
  DNS-token (`verification_token_hash` + cek TXT/CNAME via `checkVerificationStatus`)
  sebelum mengizinkan verifikasi self-service. Lihat README modul §Security
  residual risk + follow-up di `docs/awcms/absorb-awcms-micro-roadmap.md`.
- `set-primary` atomic (unset-lama-lalu-set-baru dalam satu transaksi); race
  first-time-primary konkuren dipetakan ke `409 CONCURRENT_UPDATE`
  (`setPrimaryTenantDomain` menangkap pelanggaran
  `awcms_tenant_domains_primary_dedup`).

## Keyset pagination — jebakan µs vs ms

`listTenantDomains` MEMBANGKITKAN cursor SENDIRI (bukan di rute) via
`to_char(created_at AT TIME ZONE 'UTC', ...)` sebagai `created_at_cursor` lalu
`encodeKeysetCursor(created_at_cursor, id)`. Ini karena `timestamptz` menyimpan
MIKRODETIK tapi JS `Date` cuma milidetik — cursor dari `Date` melewatkan baris
yang berbagi milidetik itu (Issue #158). Jangan membangun cursor dari
`view.createdAt`.

## Adapter Cloudflare DNS (opsional, BELUM di-wire)

`infrastructure/cloudflare-dns-adapter.ts` — `resolveTenantDomainDnsProvider(env)`

- `createCloudflareDnsProvider`. Tak ada rute yang memanggilnya. Tanpa
  `TENANT_DOMAIN_DNS_PROVIDER=cloudflare`, resolver mengembalikan provider
  misconfigured-result yang bersih (tak pernah throw) — awcms build & jalan tanpa
  kredensial Cloudflare. `validateDnsRecordInput` menolak recordName di luar
  `TENANT_DOMAIN_PLATFORM_ROOT_DOMAIN`, CR/LF injection, dan CNAME target non-host.
  `recordName` shape sengaja BUKAN reuse `normalizePublicHost()` (nama record DNS
  lazim underscore-prefix, mis. `_acme-challenge.example.com`); `normalizePublicHost`
  tetap dipakai untuk target CNAME. Timeout via `resolveTenantDomainCloudflareTimeoutMs`
  (env `TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS`, default 8 detik, tak pernah gagalkan
  boot). Secret Cloudflare hanya dari env — tak pernah di DB/response.

## Yang BELUM ada (deferred, terdokumentasi)

- **Rute konten publik ber-resolusi host** (permukaan gaya `/news`). Resolver +
  fungsi lookup + directory + admin API sudah lengkap & teruji, tapi belum ada
  rute publik yang mengonsumsi `resolvePublicTenantFromRequest` — butuh rute
  render publik blog_content/news_portal di-plumb lewatnya (news_portal
  men-defer `/news/**`-nya sendiri dengan alasan sama). Wiring-nya follow-up
  bersih; seam stabil. Env `PUBLIC_TENANT_RESOLUTION_MODE`/`PUBLIC_TRUST_PROXY`/
  `PUBLIC_DEFAULT_TENANT_ID`/`PUBLIC_DEFAULT_TENANT_CODE` belum divalidasi
  `scripts/validate-env.ts` (belum ada konsumen runtime) — tambahkan saat
  mem-wire rute publik.
- **Otomasi Cloudflare DNS** (lihat di atas).

## Aturan mengikat lintas-perubahan

1. **Backward compatibility**: deployment offline/LAN yang tak pernah set
   `PUBLIC_*` apa pun harus tetap jalan persis seperti sebelumnya — jangan buat
   var config ini wajib secara default.
2. **`X-Forwarded-Host` hanya saat `trustProxy` eksplisit true** — default aman
   `false` di setiap lapisan baru.
3. **`/blog/{tenantCode}` (ADR-0009) TIDAK dihapus** — host routing bersifat
   tambahan, bukan pengganti.
4. **Tenant existence tidak boleh bocor**: unknown/failed/suspended/inactive
   harus menghasilkan respons identik (resolver sudah return `null` identik;
   rute publik pemakainya wajib memetakan ke 404 generik yang sama).
5. **Secret provider (Cloudflare token) tak pernah di DB/descriptor** — hanya
   env, seperti Mailketing/R2.
6. **Semua mutasi domain diaudit** (`tenant_domain.domain.<verb>`); resolver
   publik read-only anonim TIDAK diaudit (sama seperti `resolvePublicTenantByCode`).
7. **API manajemen #tenant-scoped pakai `withTenant` biasa**, TIDAK pernah fungsi
   `SECURITY DEFINER` (itu murni bootstrap publik pra-tenant-context).

## Test

- Unit (tanpa DB): `tests/tenant-domain-module.test.ts`,
  `tests/tenant-domain-validation.test.ts`,
  `tests/tenant-domain-dns-config.test.ts`,
  `tests/cloudflare-dns-adapter.test.ts`,
  `tests/public-host-tenant-resolver.test.ts`.
- Integration (DB-gated): `tests/integration/tenant-domain.integration.test.ts`
  — CRUD/verify/set-primary, unique lintas-tenant, soft-delete reuse,
  satu-primary-per-tenant, dan **RLS dibuktikan di bawah `awcms_app`** (SELECT
  langsung 0 baris tanpa tenant context; fungsi `SECURITY DEFINER` resolve
  domain aktif tanpa membocorkan kolom secret).
