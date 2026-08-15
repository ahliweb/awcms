🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:9114bd649f90ca56ec7de4f2cf2593bad5e3fb0508d129f8c328afe6a43b515c -->

# tenant_domain

Pemetaan hostname/subdomain tenant → tenant untuk **perutean publik berbasis
host**, diport dari awcms-micro (epic #555). Terdaftar sebagai modul
`type: "domain"` di `src/modules/index.ts`.

Modul ini membuat sebuah tenant bisa mendaftarkan hostname/subdomain publik yang
mengarah kepadanya, membuktikan kepemilikan (manual-dulu), dan memilih satu
domain **primary** yang aktif. Ia adalah sambungan data + resolver yang kelak
akan dibaca oleh keluarga rute konten publik yang diresolusi dari host (permukaan
bergaya `/news`) untuk menjawab "header `Host` ini milik tenant yang mana?"
**tanpa** `tenantCode` di dalam path.

Ia bersifat **aditif**: perutean berbasis path `/blog/{tenantCode}` yang sudah
ada dari ADR-0009 tidak disentuh dan tetap menjadi mekanisme untuk rute-rute
tersebut. `src/middleware.ts` tidak dimodifikasi — resolusi host adalah urusan
per-rute-publik, jadi jaminan login / Turnstile / CSP tidak berubah.

## Apa yang sudah dikirim

| Area            | Detail                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skema           | `awcms_tenant_domains` (migrasi **046**) — bercakupan tenant, `ENABLE`+`FORCE ROW LEVEL SECURITY`, keunikan hostname global yang tak peka huruf besar-kecil, satu primary per tenant.                                                                                                      |
| Izin            | migrasi **047** — `tenant_domain.domains.{read,create,update,delete,verify,set_primary}`.                                                                                                                                                                                                  |
| Pencarian host  | migrasi **048** — `awcms_resolve_tenant_domain_lookup(text)` `SECURITY DEFINER`, dimiliki oleh peran khusus `awcms_domain_bootstrap` ber-`NOLOGIN`/`NOSUPERUSER`/`NOBYPASSRLS` dengan policy `FOR SELECT` bercakupan; `EXECUTE` dicabut dari `PUBLIC`, hanya diberikan kepada `awcms_app`. |
| API manajemen   | `GET/POST /api/v1/tenant/domains`, `GET/PATCH/DELETE .../{id}`, `POST .../{id}/verify`, `POST .../{id}/set-primary`.                                                                                                                                                                       |
| Layar admin     | `/admin/tenant/domains` (pembacaan SSR + mutasi `fetch` sisi klien, digerbangi `tenant_domain.domains.read`).                                                                                                                                                                              |
| Resolver publik | `src/lib/tenant/public-host-tenant-resolver.ts` (aditif; hidup berdampingan dengan ADR-0009).                                                                                                                                                                                              |
| DNS opsional    | `infrastructure/cloudflare-dns-adapter.ts` — digerbangi env, aman-bila-absen, **tidak disambungkan ke rute mana pun**.                                                                                                                                                                     |

## Model data (`awcms_tenant_domains`)

- `hostname` (mentah, huruf besar-kecil dipertahankan) + `normalized_hostname`
  (`lower(btrim(...))`, dijaga tetap sinkron oleh sebuah CHECK). Indeks unik pada
  `normalized_hostname WHERE deleted_at IS NULL` bersifat **global
  (lintas-tenant)** — satu hostname memetakan ke paling banyak satu tenant.
  Sebuah soft delete membebaskannya untuk dipakai ulang.
- `domain_type` (`subdomain`|`custom_domain`), `route_mode`
  (`canonical`|`legacy_blog`, diletakkan untuk kompatibilitas ke depan, belum
  dikonsumsi resolver mana pun).
- `status` (`pending_verification`|`active`|`suspended`|`failed`); soft delete
  (`deleted_at`/`deleted_by`/`delete_reason`) adalah state "tidak meresolusi"
  yang terpisah, tidak dilipat ke dalam enum.
- `is_primary` + `redirect_to_primary`; satu primary aktif per tenant (indeks
  unik parsial).
- `verification_method` + `verification_record_name`/`verification_record_value`
  (rekaman DNS **publik** yang dipublikasikan tenant — tidak pernah rahasia).
  `verification_token_hash` adalah hash bearer-token internal dan **tidak
  pernah** di-select/dikembalikan oleh kode mana pun di modul ini.

**Tidak ada kolom yang pernah menyimpan kredensial API penyedia DNS.**
Token/zone milik adapter Cloudflare hanya berasal dari variabel env
`TENANT_DOMAIN_CLOUDFLARE_*`.

## API manajemen domain tenant

Semua endpoint terautentikasi, bercakupan tenant, dan digerbangi di chokepoint
identity-access (`authorizeInTransaction`, ABAC default-deny) di dalam
`withTenant`. Setiap kueri berjalan di bawah RLS `FORCE` (pertahanan berlapis di
atas filter `tenant_id` eksplisit) — **tidak pernah** lewat fungsi
`SECURITY DEFINER` (itu dicadangkan untuk resolver publik anonim).

- `hostname` bersifat **immutable** setelah dibuat (mengarahkan ulang berarti
  hapus + buat ulang) dan `is_primary` tidak pernah bisa disetel lewat `PATCH`
  generik — satu-satunya jalan menuju primary adalah `POST .../set-primary` yang
  atomik. `PATCH` tidak pernah bisa menyetel `status: "active"` (pakai verify).
- Hostname ternormalisasi yang duplikat → `409 HOSTNAME_CONFLICT` generik, tidak
  pernah mengungkap apakah ia milik tenant lain. Id yang tak
  dikenal/lintas-tenant/terhapus → `404` generik.
- `verify` dan `set-primary` membutuhkan `Idempotency-Key` dan diaudit, meski
  keduanya tidak diklasifikasikan `HIGH_RISK` (postur yang sama dengan aksi
  pembalik-status lainnya). `verify` bersifat manual-dulu — ia membalik `status`
  menjadi `active` dari field milik baris itu sendiri, **tanpa panggilan DNS/HTTP
  keluar**.
- `set-primary` bersifat atomik (lepas-yang-lama-lalu-setel-yang-baru di dalam
  satu transaksi) dan memetakan balapan primary-pertama-kali yang konkuren ke
  `409 CONCURRENT_UPDATE`.

## Resolver host publik (sambungannya)

`resolvePublicTenantFromRequest(sql, request|host, config, deps?)`
mengorkestrasi:

0. `mode === "tenant_code_legacy"` → `null` seketika (operator memilih keluar
   dari tebakan tenant-bawaan apa pun).
1. pencarian host (`resolvePublicTenantByHost`) — hanya ketika
   `mode === "host_default"`, lewat fungsi `SECURITY DEFINER` migrasi 048.
2. `PUBLIC_DEFAULT_TENANT_ID` → 3. `PUBLIC_DEFAULT_TENANT_CODE` → 4.
   `awcms_setup_state.tenant_id` → 5. `null`.

Langkah 2–4 (fallback yang aman) berjalan untuk setiap mode **kecuali**
`tenant_code_legacy`; mode yang tidak disetel (bawaan offline/LAN) tetap
mempertahankan fallback penuh. Hanya
`domain_status === 'active' && tenant_status === 'active'` yang meresolusi —
setiap kasus lain mengembalikan `null` yang identik, dalam tepat satu perjalanan
pulang-pergi ke basis data (tanpa kanal-samping waktu). `X-Forwarded-Host` hanya
dibaca ketika `config.trustProxy` bernilai true.

## Belum tersedia (ditunda, terdokumentasi)

- **Rute konten publik yang diresolusi dari host.** Resolver + fungsi pencarian
  - direktori + API admin sudah lengkap dan teruji, tetapi belum ada rute publik
    yang mengonsumsi `resolvePublicTenantFromRequest` — itu butuh rute render
    publik blog_content/news_portal disalurkan melaluinya (news_portal menunda
    rute `/news/**`-nya sendiri karena alasan yang sama). Menyambungkannya adalah
    tindak lanjut yang bersih; sambungannya stabil.
- **Otomasi DNS Cloudflare untuk domain KUSTOM.** Paruh verifikasi TXT/CNAME
  milik adapter itu masih belum punya pemanggil — bukti kepemilikan domain kustom
  tetap manual (`POST /api/v1/tenant/domains/{id}/verify`).

  **Subdomain** platform MEMANG diotomasi: lihat §Rekonsiliasi DNS subdomain di
  bawah.

## Rekonsiliasi DNS subdomain

`bun run tenant-domain:dns:sync` merekonsiliasi baris `domain_type = 'subdomain'`
yang aktif menjadi rekaman A/CNAME penyaji di zona Cloudflare terkelola, lewat
`ensureServingRecord` pada port `TenantDomainDnsProvider`. Menambah subdomain
tenant adalah sebuah INSERT; jalannya berikutnya membuatnya meresolusi.

Mengapa sebuah job alih-alih panggilan di dalam `POST /api/v1/tenant/domains`:
penulisan DNS itu lambat dan dimiliki pihak luar, jadi menaruhnya dalam request
seorang tenant akan memblokir pada Cloudflare, dan sebuah kegagalan akan
meninggalkan baris yang domainnya tidak pernah meresolusi tanpa apa pun yang
mencoba ulang. Satu jalan bersifat idempoten, jadi ia juga menyembuhkan rekaman
yang disunting tangan di dasbor.

Dua perilaku yang layak diketahui:

- Rekaman yang melenceng **dipindahkan** (`PUT`), tidak pernah ditemani rekaman
  kedua — dua rekaman A untuk satu hostname akan me-round-robin trafik antara
  target lama dan baru, yang terbaca sebagai gangguan intermiten alih-alih salah
  konfigurasi.
- **Tidak ada yang pernah dihapus.** Domain yang disuspensi atau ter-soft-delete
  dilewati, menyisakan rekaman basi yang menunjuk ke platform (terlihat, tak
  berbahaya) alih-alih membiarkan sebuah job otomatis mengeluarkan penulisan DNS
  yang destruktif.

Domain kustom dikecualikan secara konstruksi: mereka adalah hostname yang tidak
dimiliki platform, jadi rekamannya bukan hak kita untuk ditulis.

Konfigurasi (semuanya aman-bila-absen — tidak disetel berarti job keluar tanpa
menyentuh basis data): `TENANT_DOMAIN_DNS_PROVIDER=cloudflare`, kredensial
`TENANT_DOMAIN_CLOUDFLARE_*`, dan `TENANT_DOMAIN_SERVING_TARGET`. Dengan sengaja
tidak ada target bawaan: menebaknya akan mengarahkan setiap subdomain tenant ke
alamat yang salah. `--dry-run` melaporkan perubahan yang diniatkan.

Worker hanya memegang `SELECT` pada `awcms_tenant_domains` (`sql/069`) — job itu
tidak menulis balik apa pun, jadi worker yang dikompromikan tidak bisa mengubah
pemetaan hostname->tenant yang memutuskan konten milik siapa yang disajikan
kepada seorang pengunjung.

## Risiko sisa keamanan — gerbangi sebelum swalayan tak tepercaya (M1)

`verify` saat ini mengaktifkan sebuah domain dari field di dalam baris **tanpa
bukti kepemilikan keluar** (manual-dulu; mesin token-DNS —
`verification_token_hash` + adapter Cloudflare/DNS — ada tetapi belum
disambungkan). Karena indeks hostname global-unik bercakupan
`WHERE deleted_at IS NULL`, hostname yang ter-soft-delete bisa didaftarkan ulang
oleh tenant lain. Bila verifikasi swalayan multi-tenant yang tak tepercaya untuk
**`custom_domain`** bersama diaktifkan, kombinasi ini memungkinkan
**pengambilalihan domain lewat DNS menggantung**: tenant A menghapus sebuah
pemetaan tetapi meninggalkan DNS menunjuk ke platform, tenant B mendaftarkan
ulang dan meng-`verify` hostname yang sama tanpa bukti, dan trafik ke host yang
menggantung itu kini meresolusi ke tenant B.

Mitigasi yang sudah ada: `verify` bersifat **default-deny** (berprivilese,
ter-seed) dan **diaudit**; subdomain di bawah akar platform tidak terpengaruh
(mereka tidak didelegasikan ke tenant). **Wajib sebelum go-live swalayan domain
kustom yang tak tepercaya:** entah pertahankan aktivasi `custom_domain`
**digerbangi operator/manual**, atau sambungkan bukti kepemilikan token-DNS yang
sungguhan (tulis token CSPRNG ke `verification_token_hash`, tuntut tenant
mempublikasikan TXT/CNAME yang cocok, dan konfirmasikan itu di `verify` lewat
`checkVerificationStatus`). Dilacak sebagai tindak lanjut pengerasan
tenant-domain di `docs/awcms/absorb-awcms-micro-roadmap.md`.

## Pengujian

- `tests/tenant-domain-module.test.ts` — paritas deskriptor ↔ migrasi 047.
- `tests/tenant-domain-validation.test.ts` — validasi create/update.
- `tests/tenant-domain-dns-config.test.ts` — konfigurasi provider/timeout.
- `tests/cloudflare-dns-adapter.test.ts` — validasi masukan rekaman DNS + resolver
  yang aman-bila-absen.
- `tests/public-host-tenant-resolver.test.ts` — `normalizePublicHost` +
  percabangan urutan resolusi (dependensi di-mock, tanpa DB).
- `tests/integration/tenant-domain.integration.test.ts` — digerbangi DB: CRUD
  direktori/verify/set-primary, keunikan global lintas-tenant, pemakaian ulang
  setelah soft-delete, satu-primary-per-tenant, dan **RLS dibuktikan di bawah
  `awcms_app`** (SELECT langsung mengembalikan 0 baris tanpa konteks tenant;
  pencarian `SECURITY DEFINER` meresolusi domain aktif dan tidak pernah
  mengekspos kolom rahasia).
