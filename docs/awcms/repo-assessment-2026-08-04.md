# Asesmen repo `awcms` — 4 Agustus 2026

> **Untuk apa dokumen ini.** Penilaian menyeluruh terhadap repo pada satu titik
> waktu, diukur terhadap **empat sumbu**: standar pengembangan AWCMS sendiri
> ([`../../AGENTS.md`](../../AGENTS.md) + `docs/adr/`), hubungannya dengan
> [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro), standar
> performa internasional, dan standar keamanan internasional.
>
> **Setiap temuan di bawah diverifikasi ke KODE**, bukan ke dokumen. Repo ini
> punya sejarah panjang temuan yang ditulis dari dugaan lalu tersalin jadi
> keputusan (ADR-0058 §1, ADR-0059, ADR-0060) — jadi tiap klaim membawa berkas
> dan barisnya, dan klaim yang tidak bisa dibuktikan tidak ditulis.

## 1. Skala terukur

| Dimensi                           | Angka      |
| --------------------------------- | ---------- |
| Modul terdaftar                   | 21         |
| Migrasi `sql/`                    | 90         |
| Tabel (`CREATE TABLE`)            | 130        |
| Pernyataan RLS `ENABLE` / `FORCE` | 118 / 141  |
| Rute API `/api/v1`                | 255 berkas |
| Layar admin                       | 31         |
| Berkas test                       | 292        |
| Baris `src/` (ts + astro)         | ~156.000   |
| Gerbang di rantai `bun run check` | 29         |
| ADR                               | 65         |
| Index database                    | 266        |

> **Koreksi.** Versi pertama tabel ini menulis **22** modul — itu menghitung
> `src/modules/_shared/`, yang bukan modul. `listModules()` mengembalikan **21**.
> Angka migrasi/gerbang/ADR/index sudah dimutakhirkan setelah ADR-0063/0064
> mendarat.

Ini bukan repo muda. Kepadatan gerbangnya (29) tinggi untuk ukurannya, dan itu
konteks penting untuk seluruh bagian berikut: **temuan di bawah bukan hal yang
lolos karena tidak ada yang memeriksa — melainkan hal yang tidak ada
pemeriksanya.**

## 2. Temuan P0 — TIGA handler melewati chokepoint otorisasi

> **KOREKSI 4 Agustus 2026 (PR ADR-0063).** Versi pertama bagian ini menulis
> temuan sebagai **satu** rute menyimpang, dan menyebut
> `PATCH /api/v1/blog/posts/{id}` sebagai **contoh pola yang BENAR**. Itu salah.
> Berkas `blog/posts/[id].ts` memanggil `authorizeInTransaction` di `GET` (baris 83) dan `DELETE` (baris 431), sementara `PATCH` di berkas yang sama **tidak
> sama sekali** — pembacaan tingkat-BERKAS menggabungkannya jadi satu alur dan
> menyimpulkan kepatuhan yang tidak ada. Analisis per-HANDLER atas 331 handler
> menemukan **tiga** pelanggar, bukan satu, dan satu "pelanggar" keempat
> (`access/evaluate.ts`) ternyata sah. Ini kelas kesalahan yang dokumen ini
> sendiri peringatkan di pembukanya; dicatat utuh karena koreksinya adalah
> alasan gerbang ADR-0063 §B mengiris per-handler. **Sudah DIPERBAIKI** — lihat
> ADR-0063.

### Apa yang ditemukan

Tiga handler **tidak memanggil `authorizeInTransaction` sama sekali** —
`PATCH /api/v1/blog/posts/{id}`, `POST /api/v1/blog/posts/{id}/submit-review`, dan
`PATCH /api/v1/blog/pages/{id}`. Ketiganya menyusun otorisasinya sendiri:

```
resolveTenantContext → resolveModuleEnabled → fetchGrantedPermissionKeys
  → evaluatePostUpdateAccess → recordDecisionLog
```

Dan ketiganya BUKAN kelalaian: mereka menegakkan aturan produk (#538) bahwa
**penulis boleh menyunting kontennya sendiri yang belum terbit meski tidak
memegang permission-nya** — sumbu otorisasi yang katalog permission tidak bisa
ekspresikan. `authorizeInTransaction` mengembalikan `denied` sebelum aturan domain
mana pun dikonsultasi, jadi menaruhnya di depan aturan itu akan MENGHAPUS jalur
penulis. Cacatnya ada di seam chokepoint, bukan di disiplin penulis rutenya.

### Yang hilang di jalur itu

`authorizeInTransaction`
([`src/modules/identity-access/application/access-guard.ts`](../../src/modules/identity-access/application/access-guard.ts))
adalah tempat berikut ini hidup — semuanya dilewati oleh rute di atas:

| Lapisan                         | ADR                                                                          | Akibat dilewati                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `evaluateAccess` (ABAC DSL)     | #179                                                                         | **Policy ABAC `deny` eksplisit atas `blog_content.posts.update` DIHORMATI di `PATCH`, TIDAK di `submit-review`.** |
| `isPlatformScopedPermissionKey` | [ADR-0053](../adr/0053-platform-scoped-permissions.md)                       | Gerbang lintas-tenant tak dievaluasi                                                                              |
| `resolveBusinessScopeFacts`     | [ADR-0060](../adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md) | Cakupan bisnis tak ikut memutuskan                                                                                |
| `isHighRiskAction` + SoD        | #181                                                                         | Konflik segregation-of-duties tak diperiksa                                                                       |

`evaluatePostUpdateAccess` sendiri menyatakan di docblock-nya bahwa ia **bukan**
`evaluateAccess` bersama — ia aturan kepemilikan domain, bukan evaluator
kebijakan.

### Kenapa tidak ada gerbang yang menangkapnya

`bun run access:permissions:enforcement:check` ([ADR-0057](../adr/0057-blog-page-lifecycle.md) §F,
[ADR-0058](../adr/0058-unenforced-permissions-disposition.md)) bertanya
**"apakah permission ini punya penegak?"** — dan `blog_content.posts.update`
punya: `PATCH /{id}`. Gerbang itu **tidak** bertanya "apakah SETIAP situs
penegakan memakai chokepoint". Ini pengulangan persis pelajaran PR #351: _gerbang
cakupan permission dan kebenaran situs penegakan menjawab dua pertanyaan
berbeda, dan sebuah kontrol bisa lulus yang pertama sambil salah di yang kedua._

### Pemetaan standar

- **OWASP Top 10 2021 — A01 Broken Access Control** (jalur otorisasi paralel yang
  lebih lemah), **A04 Insecure Design** (dua evaluator untuk satu permission).
- **OWASP API Security Top 10 2023 — API5 Broken Function Level Authorization.**
- **OWASP ASVS v4.0.3 — V4.1.3** (least privilege ditegakkan konsisten),
  **V1.4.4** (satu mekanisme akses terpusat, tidak di-bypass).
- **ISO/IEC 27001:2022 Annex A — A.8.3** (pembatasan akses informasi),
  **A.8.26** (persyaratan keamanan aplikasi).

### Severity yang jujur

**Moderat, bukan kritis.** Blast radius rute itu sempit — transisi
`draft` → `review` pada satu post, dan RBAC + aturan kepemilikan TETAP berlaku.
Yang bocor bukan data, melainkan **konsistensi kebijakan**: sebuah tenant yang
menulis policy ABAC untuk menahan `posts.update` akan mendapati policy-nya
dihormati di satu rute dan diam-diam diabaikan di rute lain. Kelasnya yang
serius, bukan instansnya.

### Rekomendasi

**SELESAI — [ADR-0063](../adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md).**

1. `authorizeInTransaction` mendapat `ownershipGrant`, yang **MELEBARKAN**
   himpunan permission yang dievaluasi alih-alih memotong keputusan. Aturan
   kepemilikan jadi masukan bagi chokepoint, bukan pengganti — sehingga ABAC
   (termasuk `deny` eksplisit), platform-scope, business-scope, dan SoD tetap
   bisa menolak. Kredensial mesin dikecualikan (ADR-0049 §3), dan decision log
   menandai allow berbasis kepemilikan sebagai `ownership_grant:<reason>`.
2. Gerbang `bun run access:chokepoint:check`, **di-iris per HANDLER** — bukan
   per berkas, karena pembacaan per-berkas justru yang menghasilkan koreksi di
   atas. Pengecualian berkunci `<berkas>#<METHOD>` sehingga tak bisa melebar ke
   handler tetangga. Dua entri: `auth/login.ts#POST` (pra-autentikasi) dan
   `access/evaluate.ts#POST` (introspeksi diri yang justru MEMANGGIL
   `evaluateAccess`). Skor: **331 handler, 6 memutuskan permission, 0 bypass.**

## 3. ~~Temuan P1 — rate limiter tidak bertahan di lebih dari satu instans~~ — SELESAI

> **[ADR-0066](../adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md) (4 Agustus 2026).**
> `checkSharedRateLimit` menghitung di Redis dengan nomor window sebagai bagian
> dari KUNCI, sehingga dua instans sepakat tanpa read-modify-write. GAGAL-TERBUKA
> saat Redis mati — dinyatakan keras karena kebalikan postur default repo ini, dan
> jujur karena lockout per-identitas di PostgreSQL tak terpengaruh. Cakupan naik
> dari delapan ke **sebelas** permukaan. Teks di bawah dipertahankan sebagai
> konteks temuan.

### Apa yang ditemukan

[`src/lib/security/rate-limit.ts`](../../src/lib/security/rate-limit.ts)
menyimpan counter di **`Map` dalam-proses** (baris 21). Berkasnya sendiri
mencatat ini sebagai keterbatasan yang diketahui — jadi ini bukan cacat
tersembunyi, melainkan **utang yang belum jatuh tempo sampai deployment
diskalakan horizontal**.

Konsekuensi aritmetiknya: dengan **N** instans aplikasi di belakang load
balancer, batas efektif menjadi **N × batas terkonfigurasi**. Untuk
`POST /api/v1/auth/login` itu berarti anti-brute-force melemah linier terhadap
jumlah replika — dan justru deployment yang paling butuh perlindungan (trafik
tinggi → banyak replika) yang paling lemah.

**Redis sudah ada di repo** (`src/lib/redis/client.ts`, `cache.ts`, `config.ts`),
jadi ini bukan kemampuan baru — hanya penyambungan.

### Cakupan limiter hari ini

| Endpoint                          | `checkRateLimit` |
| --------------------------------- | ---------------- |
| `auth/login`                      | ada              |
| `auth/register`                   | ada              |
| `auth/mfa/totp/verify`            | ada              |
| `auth/password/forgot`            | ada              |
| `auth/password/reset`             | ada              |
| `auth/session-handoff/issue`      | **tidak ada**    |
| `auth/session-handoff/redeem`     | **tidak ada**    |
| `auth/sso/{providerKey}/callback` | **tidak ada**    |

Ketiga yang kosong punya mitigasi lain (kode handoff ≤60 detik + sekali pakai +
`redeem` menuntut client secret; callback SSO terikat state), jadi ini
**kelengkapan, bukan lubang**. Tetapi ASVS menuntut anti-automation pada seluruh
permukaan autentikasi, bukan sebagian.

### Pemetaan standar

- **OWASP API Security Top 10 2023 — API4 Unrestricted Resource Consumption.**
- **OWASP ASVS v4.0.3 — V11.2.1/V11.2.2** (anti-automation), **V2.2.1**
  (kontrol anti-brute-force pada autentikasi).
- **ISO/IEC 27001:2022 Annex A — A.8.5** (autentikasi aman), **A.8.6**
  (manajemen kapasitas).

### Rekomendasi

Pindahkan penyimpanan counter ke Redis **bila dan hanya bila** deployment
multi-instans, dengan fail-open yang eksplisit: Redis mati **tidak boleh**
menutup login (ketersediaan menang atas pengetatan di jalur ini), tapi harus
melaporkan diri lewat `security:readiness`. Lalu lengkapi ketiga endpoint yang
kosong.

## 4. ~~Temuan P1 — kontrak yang dipakai `awcms-astro` tidak dijaga test apa pun~~ — SELESAI

> **[ADR-0065](../adr/0065-awcms-astro-consumer-contract-is-frozen.md) (4 Agustus 2026).**
> `bun run api:consumer-contract:check` membekukan **6 path + 16 komponen** —
> closure `$ref` penuh, karena membekukan objek path saja nyaris tak berguna
> ketika kerusakan yang menarik terjadi di schema. Aturannya subset aditif;
> mutation-proven dua arah (rename field di dalam komponen → merah; tambah field
> opsional → lolos). Teks di bawah dipertahankan sebagai konteks temuan.

### Hubungan kedua repo hari ini

`awcms-astro` **sudah tidak tertahan**: ADR-0027 di sana menutup penahanan
ADR-0021 karena kedua indikatornya terpenuhi. Repo itu memanggil **enam
permukaan** repo ini:

| Permukaan                                                            | Mendarat di |
| -------------------------------------------------------------------- | ----------- |
| `GET /api/v1/blog/posts` (traversal `view=full`, cursor, `?locale=`) | #317        |
| `GET /api/v1/blog/posts/{id}`                                        | —           |
| `GET /api/v1/media/objects`                                          | #318        |
| `GET /api/v1/media/public-origin`                                    | #370        |
| `GET /api/v1/auth/session`                                           | ADR-0049    |
| `POST /api/v1/access/machine-credentials`                            | ADR-0049    |

### Cacatnya

Snapshot OpenAPI beku
([`tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml`](../../tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml),
ditegakkan `tests/openapi-bundle.test.ts`) adalah snapshot **PRA-migrasi #182**.
Ia menjamin sifat _add-only_ terhadap baseline itu — dan **kelima permukaan yang
benar-benar dikonsumsi `awcms-astro` mendarat SESUDAHNYA**, sehingga tak satu pun
ada di dalamnya. Diverifikasi: pencarian `/auth/session`, `/media/objects`,
`/media/public-origin`, `/access/machine-credentials` di berkas snapshot
mengembalikan **nol**.

Artinya: **mengubah bentuk respons salah satu dari lima permukaan itu hijau di CI
repo ini, dan merusak build `awcms-astro`.** Tidak ada satu pun gerbang yang
menanyakannya, dan kegagalannya muncul di repo LAIN — tempat orang yang
mengubahnya tidak melihat.

Ini persis bentuk cacat yang [ADR-0062](../adr/0062-skills-are-gated-against-the-code-they-describe.md)
baru saja tutup untuk skill: sebuah klaim yang bisa diperiksa, di lapisan yang
tidak ada yang memeriksa.

### Pemetaan standar

- **ISO/IEC 25010 — Compatibility / Interoperability.**
- **OWASP ASVS v4.0.3 — V13.1.1** (kontrak API terdefinisi & ditegakkan).
- Praktik konsumen-kontrak (consumer-driven contract testing) sebagai norma
  industri untuk batas antar-layanan.

### Rekomendasi

Tambahkan **snapshot kontrak konsumen kedua** — bukan memperluas snapshot
pra-migrasi (ia punya tugas berbeda dan harus tetap beku). Isinya HANYA enam
permukaan di atas, dengan aturan add-only yang sama, dan komentar yang menyebut
`awcms-astro` sebagai pemilik alasannya. Biayanya kecil; yang dibeli adalah CI
repo ini menjawab pertanyaan yang saat ini hanya bisa dijawab oleh build repo
lain yang gagal.

## 5. Performa — posturnya kuat, dua celah yang jujur

### Yang sudah benar

- **Cache tepi Varnish** ([ADR-0042](../adr/0042-varnish-edge-cache-auto-activation.md),
  [ADR-0061](../adr/0061-host-resolved-public-surfaces-are-edge-cacheable.md)):
  11 surface ter-deklarasi, allow-list fail-closed, TTL ber-ramp otomatis,
  invalidasi lewat surrogate key + antrean tahan-lama. Sesuai **RFC 9111**
  (HTTP caching) dan **RFC 5861** (`stale-while-revalidate`).
- **Validator kondisional** ETag/`Last-Modified` → 304 di seluruh rute discovery.
- **Pagination keyset** dipakai 26 berkas, dengan kursor teks presisi mikrodetik
  (jebakan #158 sudah ditutup dan diuji).
- **Pagination offset** dipakai 10 berkas TAPI **berbatas** (`MAX_PAGE_NUMBER`
  10.000, clamp dua sisi) — jadi bukan permukaan serangan amplifikasi.
- **253 index** dan `bun run db:work-class:check` untuk pemisahan kelas kerja
  pool.
- **Redis** cache-aside tersedia dengan fail-open.

### ~~Celah 1 — tidak ada gerbang performa sama sekali~~ — DITUTUP SEBAGIAN

> **[ADR-0064](../adr/0064-foreign-key-columns-must-be-index-reachable.md) (4 Agustus 2026)**
> memberi repo ini gerbang performa PERTAMANYA: `bun run db:fk-index:check`.
> 182 kolom FK diukur, **14 tak terjangkau index**; `sql/090` mengindeks tiga
> belas dan satu dikecualikan ber-alasan (`awcms_setup_state` singleton keras).
> Aturannya sadar-tenant (`(tenant_id, fk)` dihitung terjangkau) karena aturan
> literal "wajib memimpin" melanggar 40 dari 182 — dan gerbang yang menuntut 40
> migrasi di hari mendaratnya adalah daftar pengecualian yang menunggu ditulis.
> Anggaran query per-endpoint dan Core Web Vitals TETAP terbuka. Teks di bawah
> dipertahankan sebagai konteks temuan aslinya.

Tidak ada `*:check` untuk index coverage, query budget, atau anggaran ukuran
bundel. Repo ini menggerbangi 28 hal; **nol** di antaranya performa. Konsekuensi
praktis: sebuah query N+1 atau kolom FK tanpa index bisa mendarat dengan seluruh
CI hijau.

`scripts/README.md` §Ditunda memang mencatat `performance:*` sebagai tooling yang
belum ada — jadi ini **kesenjangan yang diketahui**, bukan yang terlupakan.

- **ISO/IEC 25010 — Performance efficiency** (time behaviour, resource
  utilization) tidak punya bukti terotomasi.

### Celah 2 — Core Web Vitals tidak pernah diukur

Repo ini melayani HTML nyata (`/news/**`, `/blog/{tenantCode}/**`, 31 layar
admin) tetapi tak ada pengukuran **LCP / INP / CLS** di mana pun, dan tak ada
anggaran ukuran aset. `visitor_analytics` mengumpulkan kunjungan, bukan vitals.

Untuk halaman publik yang justru jadi alasan cache tepi dibangun, tidak
mengukurnya berarti keuntungan cache-nya tak pernah dibuktikan ke pengalaman
pengguna — hanya ke beban origin.

### Rekomendasi performa

1. **Gerbang index-FK** (murni, tanpa DB): setiap kolom FK di `sql/` wajib punya
   index, atau terdaftar sebagai pengecualian ber-alasan. Ini gerbang termurah
   dengan hasil terbesar dan cocok dengan pola repo.
2. ~~**Anggaran query per-endpoint**~~ **SELESAI** — `tests/integration/query-budget.ts`
   mengekstrak pola Proxy-apply-trap dari test SoD (#181) jadi helper
   `countQueries`, dan `query-budget.integration.test.ts` mengikat jalur baca
   publik terpanas (listing, paging, feed) ke plafon **3 query** di atas fixture
   40 post. Fixture-nya sengaja lebih besar dari plafon: plafon di atas satu baris
   tak membuktikan apa pun karena N+1 dan implementasi konstan sama-sama
   mengeluarkan sekitar satu query. Mutation-proven dengan menyuntikkan N+1 NYATA
   ke `listPublicBlogPosts` — dua test langsung merah. Satu test menjaga
   instrumennya sendiri (Proxy yang berhenti menghitung akan membuat semua plafon
   lolos secara hampa).
3. Core Web Vitals: keputusan produk, bukan cacat — dan kini **tertulis sebagai
   keputusan yang menunggu**, [ADR-0067](../adr/0067-core-web-vitals-collection.md)
   (`Proposed`). Ia satu-satunya dari tujuh rekomendasi yang tidak mendarat, dengan
   sengaja: bukan memperbaiki cacat melainkan MENAMBAH pengumpulan data tentang
   pengunjung nyata, dan itu bertabrakan dengan postur privacy-first yang
   `visitor_analytics` sudah nyatakan (purge-nya DELETE tanpa arsip, dengan alasan
   tertulis). ADR itu memberi tiga opsi dengan trade-off sebenarnya dan
   merekomendasikan **agregat-saja** — tanpa baris mentah — bila diambil sama
   sekali. **Tidak mengambilnya adalah jawaban yang sah**, dan lebih baik dicatat
   sebagai keputusan daripada dibiarkan sebagai celah terbuka.

## 6. Keamanan — postur dasar kuat

Diverifikasi ada dan benar, bukan diasumsikan:

| Kontrol                             | Bukti                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security headers lengkap            | [`src/lib/security/security-headers.ts`](../../src/lib/security/security-headers.ts) — CSP, HSTS (ber-gerbang TLS), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` |
| RLS `FORCE` + role non-owner        | 141 pernyataan `FORCE`; diuji sebagai `awcms_app` LOGIN, bukan superuser                                                                                                                                       |
| ABAC default-deny + decision log    | `evaluateAccess`, `recordDecisionLog`                                                                                                                                                                          |
| MFA/TOTP, OIDC, Turnstile, SoD      | #184/#185/#186/#181                                                                                                                                                                                            |
| Kredensial mesin baca-saja          | [ADR-0049](../adr/0049-machine-credentials-and-session-introspection.md)                                                                                                                                       |
| Handoff sesi sekali-pakai ≤60 detik | [ADR-0050](../adr/0050-bff-session-handoff-code.md)                                                                                                                                                            |
| Permission platform-scoped          | [ADR-0053](../adr/0053-platform-scoped-permissions.md)                                                                                                                                                         |
| Cakupan penegakan permission        | 203/203, **nol** pengecualian ([ADR-0058](../adr/0058-unenforced-permissions-disposition.md))                                                                                                                  |

Pemetaan ke **OWASP Top 10 2021**: A01 tertutup kecuali temuan §2; A02 (crypto)
lewat hashing sesi + enkripsi rahasia MFA; A03 lewat tagged-template Bun.SQL
(tidak ada konkatenasi SQL); A05 lewat `validate-env` + `security:readiness`;
A07 lewat MFA/lockout atomik-di-DB; A09 lewat audit log + decision log +
correlation ID.

### Satu temuan dependensi

`bun audit`: **1 moderate** — `postcss <=8.5.22` transitif lewat
`astro › vite › postcss` (GHSA-fxqj-rqcc-2cmp, baca `.map` arbitrer saat `from`
tak diset). Jalur build, bukan runtime produksi. Rekomendasi: `overrides` ke
`postcss ^8.5.23`, pola yang sama dengan yang `awcms-astro` pakai untuk
`fast-uri`.

## 7. Rekomendasi berperingkat

| #   | Rekomendasi                                                                    | Sumbu                           | Butuh ADR?                       |
| --- | ------------------------------------------------------------------------------ | ------------------------------- | -------------------------------- |
| 1   | Routekan `submit-review` lewat `authorizeInTransaction` **+ gerbang kelasnya** | Keamanan (A01/API5/ASVS V1.4.4) | Ya — gerbang = perubahan standar |
| 2   | Snapshot kontrak konsumen untuk enam permukaan `awcms-astro`                   | Interop (ASVS V13.1.1)          | Ya                               |
| 3   | Rate limiter berbagi (Redis) + lengkapi 3 endpoint                             | Keamanan (API4/ASVS V11.2)      | Ya                               |
| 4   | Gerbang index-FK                                                               | Performa (ISO 25010)            | Tidak — gerbang murni            |
| 5   | `overrides` postcss                                                            | Rantai pasok                    | Tidak                            |
| 6   | Anggaran query per-endpoint                                                    | Performa                        | Tidak                            |
| 7   | Core Web Vitals di `visitor_analytics`                                         | Performa/produk                 | Ya                               |

**Urutan yang disarankan: 1 → 2 → 5 → 4 → 3 → 6 → 7.** Nomor 1 lebih dulu karena
ia satu-satunya yang menyangkut kebenaran kontrol keamanan; nomor 2 kedua karena
kegagalannya muncul di repo lain, tempat orang yang menyebabkannya tidak
melihatnya; nomor 5 disisipkan lebih awal hanya karena biayanya satu baris.

## 8. Yang TIDAK direkomendasikan, dan kenapa

- **Menaikkan cakupan test demi angka.** 292 berkas test dengan pola
  mutation-proven yang konsisten sudah lebih bernilai daripada persentase.
- **Menggerbangi `docs/awcms/`** seperti `.claude/skills/`. Isinya sengaja
  campuran sejarah + spesifikasi, dan tidak dieksekusi sebagai instruksi —
  ADR-0062 §3 sudah menyatakan batas itu.
- **Mengaktifkan `EDGE_CACHE_MODE` sebagai default.** Default MATI adalah
  keputusan ADR-0042 dan tetap benar: cache bersama di depan aplikasi
  multi-tenant adalah mesin kebocoran bila salah dikonfigurasi.
- **Membangun `newsletter`/`social-publishing` sekarang.** Keduanya butuh ADR
  admission, dan tak satu pun memblokir `awcms-astro` — itu kesimpulan kedua repo,
  bukan penilaian sepihak.

## 9. Putaran kedua — 4 Agustus 2026, setelah enam rekomendasi mendarat

> **Kenapa ada putaran kedua di hari yang sama.** Enam dari tujuh rekomendasi §7
> mendarat berurutan (ADR-0063 → #380, postcss → #381, ADR-0064 → #382,
> ADR-0065 → #383, ADR-0066 → #384, anggaran query → #385, ADR-0067 → #386).
> Putaran ini menilai ulang repo **setelah** semuanya masuk, dan menemukan
> tiga belas hal yang putaran pertama tidak lihat — sebagian karena ia mengukur
> permukaan yang berbeda, sebagian karena repo sebelah menyelesaikan latihan
> yang sama dan hasilnya membantah satu angka di sini.
>
> Mulai putaran ini, status kontrol **tidak lagi hidup di dokumen ini**. Ia
> pindah ke [`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md),
> yang dirancang untuk **dimutakhirkan**. Dokumen ini tetap potret: ia tidak
> boleh menua menjadi daftar tugas.

### 9.0 Skala terukur, dimutakhirkan

| Dimensi                           | Putaran 1 | Sekarang              | Perintah yang menghasilkannya                 |
| --------------------------------- | --------- | --------------------- | --------------------------------------------- |
| Modul terdaftar                   | 21        | 21                    | `listModules()`                               |
| Migrasi `sql/`                    | 90        | 90                    | `ls sql/*.sql \| wc -l`                       |
| Gerbang di rantai `bun run check` | 29        | **33**                | pisah `scripts.check` pada `&&`               |
| ADR                               | 65        | **68**                | `ls docs/adr/0*.md \| wc -l`                  |
| Berkas test                       | 292       | **293**               | `find tests -name '*.test.ts' \| wc -l`       |
| Index database                    | 266       | **268**               | `grep -h 'CREATE .*INDEX' sql/*.sql \| wc -l` |
| Changeset menunggu                | 68        | **100**               | `ls .changeset/*.md \| wc -l`                 |
| Berkas `.astro`                   | —         | **42** (22.328 baris) | `find src -name '*.astro'`                    |

Skor gerbang hari ini, dijalankan bukan dikutip: **331 handler / 6 memutuskan
permission / 0 bypass**, **203/203 permission tergerbangi / 0 pengecualian**,
**182 kolom FK / semua terjangkau index / 1 pengecualian**, **11 surface cache
tepi / 3 modul pengemisi purge**, `bun audit` **bersih**.

### 9.1 Keamanan — `AUTH_COOKIE_SECURE` gagal-terbuka saat tidak diset

`scripts/validate-env.ts` baris 510:

```ts
if (isProduction && env.AUTH_COOKIE_SECURE === "false") {
```

Runtime membacanya sebagai `process.env.AUTH_COOKIE_SECURE === "true"`
(`auth/login.ts:583`, `mfa-session-assurance.ts:217`, `analytics/collect.ts:194`).
Kedua sisi memakai perbandingan string ketat, dan keduanya condong ke arah
berlawanan:

- **Tidak diset** → runtime: cookie **tanpa** `Secure`. Validator: **lolos**.
- `AUTH_COOKIE_SECURE=1` / `TRUE` / `yes` → sama persis: cookie tanpa `Secure`,
  validator lolos.

Jadi `bun run config:validate` melaporkan konfigurasi produksi bersih sementara
cookie sesi bisa dikirim lewat kanal plaintext. HSTS memitigasinya **setelah**
kunjungan pertama; kunjungan pertama justru yang tidak dijaganya.

**Ini bukan pilihan desain di berkas itu.** Dua aturan produksi lain di berkas
yang sama justru memperlakukan "tidak diset" sebagai pelanggaran —
`TRUSTED_PROXY_ENABLED` (baris 622) memerahkan saat kosong. Yang satu ini
konsisten dengan runtime-nya, bukan dengan tetangganya.

- **ASVS 4.0.3 V3.4.1** (cookie sesi ber-`Secure`), **OWASP Top 10 A05**,
  **API8**, **ISO 27001 A.8.9**.
- Perbaikan: balik ke "bukan `true` berarti gagal", plus test yang membuktikan
  `APP_ENV=production` tanpa variabel itu DITOLAK — pengujian pada nilai
  `"false"` saja akan tetap hijau pada cacat ini.

### 9.2 Keamanan — dua header yang dianjurkan tidak dikirim

`buildSecurityHeaders` mengirim enam header dan **tidak** mengirim
`Cross-Origin-Opener-Policy` maupun `Cross-Origin-Resource-Policy`. Keduanya
masuk kategori _dianjurkan_ OWASP Secure Headers Project.

Untuk repo ini COOP `same-origin` bukan formalitas: aplikasi ini punya **sesi
manusia** dan 42 halaman ber-render, sehingga isolasi konteks penjelajahan
lintas-origin adalah kontrol yang benar-benar berlaku — berbeda dari situs
statis tanpa sesi. Biayanya satu baris dan satu asersi.

### 9.3 Performa — repo tak mengompresi apa pun, dan itu tidak sama dengan "respons tak terkompresi"

> **KOREKSI 4 Agustus 2026, diprobe ke staging DAN produksi.** Judul asli bagian
> ini berbunyi _"tidak ada kompresi respons di mana pun"_ dan itu **salah pada
> bagian yang paling penting**. Kedua environment ter-deploy mengembalikan
> `content-encoding: gzip`:
>
> ```
> $ curl -sSI -H 'Accept-Encoding: gzip, br' https://awcms.ahlikoding.com/api/v1/health
> content-encoding: gzip
> server: cloudflare
> ```
>
> Cloudflare berada di depan Traefik dan mengompresi. Dan topologi itu **sudah
> tertulis** — [`environments.md`](environments.md) §Cache tepi menggambar
> `Cloudflare (proxied) -> Traefik :443 -> varnish:80 -> app` — sehingga draf
> pertama koreksi ini pun nyaris melaporkan "tier CDN tak terdokumentasi",
> sebuah temuan kedua yang juga salah, karena ia dibaca dari 180 baris pertama
> sebuah berkas 330 baris.
>
> **Dua kali dalam satu putaran, membaca sebagian sumber menghasilkan temuan
> yang percaya diri dan keliru** — persis kelas yang pembuka dokumen ini
> peringatkan, dan persis alasan gerbang ADR-0063 mengiris per-handler.
>
> Yang **tetap benar** dan karena itu tetap dicatat, dengan severity yang jauh
> lebih rendah: repo ini tidak mengompresi apa pun yang ia miliki, jadi sebuah
> deployment template ini yang tidak berada di belakang CDN pengompresi tidak
> mendapat kompresi sama sekali — dan tak satu pun gerbang, `config:validate`,
> atau `security:readiness` yang mengatakannya. Ia berpindah dari "cacat
> performa" menjadi "ketergantungan tak tercatat pada lapisan luar".
>
> Yang **lahir** dari probe yang sama jauh lebih tajam: lihat §9.3b.

Yang diverifikasi ke tiga lapisan repo, dan tetap akurat:

| Lapisan                                 | Hasil pencarian                                       |
| --------------------------------------- | ----------------------------------------------------- |
| Aplikasi (`src/`, `astro.config.mjs`)   | nol middleware kompresi                               |
| `infra/varnish/default.vcl` (209 baris) | **nol** kemunculan `gzip`/`do_gzip`/`Accept-Encoding` |
| `deploy/`                               | nol middleware `compress` yang dideklarasikan         |

Varnish tidak mengompresi atas inisiatifnya sendiri: tanpa
`beresp.do_gzip = true` ia menyimpan apa yang backend kirim, dan backend tidak
pernah mengirim terkompresi. Traefik juga tidak mengompresi tanpa middleware
yang dinyatakan — argumen yang sama yang `awcms-astro` gunakan untuk membantah
"HSTS itu urusan lapisan di depan".

Yang membuatnya lebih dari kelalaian: `src/lib/edge-cache/response-headers.ts`
**sudah** memancarkan `Vary: Accept-Encoding` pada respons yang bisa di-cache,
dengan komentar yang menjelaskan negosiasi kompresi. Header itu adalah janji
tanpa penepat — ia melipatgandakan ruang kunci cache untuk negosiasi yang tak
pernah terjadi, dan terbaca seolah kompresi sudah ditangani.

Diukur, bukan diperkirakan — aset teks `dist/client` hari ini:

```
raw = 139.048 B    gzip -9 = 49.679 B    rasio 2,79× (hemat 64%)
```

Dan aset klien adalah bagian yang **paling kecil**: yang benar-benar besar
adalah HTML 42 halaman, respons JSON `/api/v1`, serta `sitemap.xml`/`feed.xml`
yang justru dibangun untuk di-crawl berulang. Ketiganya kompres lebih baik
daripada 2,79×.

- **ISO/IEC 25010 — performance efficiency (resource utilization)**;
  praktik transport standar (RFC 9110 §8.4 content coding).
- Perbaikan (opsional, prioritas rendah): kompresi di aplikasi (pola
  `awcms-astro`, yang menegosiasikan Brotli) **atau** `beresp.do_gzip` di VCL.
  Yang tidak boleh: dua tempat yang memutuskan hal yang sama — dan dengan
  Cloudflare sudah mengompresi, menambah lapisan kedua di sini justru
  menciptakan tepat masalah itu. Yang lebih murah dan lebih jujur: satu baris di
  `security:readiness` yang menyatakan bahwa kompresi diwarisi dari lapisan luar.

### 9.3b Performa — purge menjangkau Varnish, bukan tier yang menyajikan pembaca

Probe yang mengoreksi §9.3 juga membongkar sesuatu yang tidak terlihat dari kode
mana pun, karena ia hanya muncul ketika ketiga lapisan berjalan bersama.

Pada satu permintaan yang sama ke staging:

```
$ curl -sSI https://awcms-staging.ahlikoding.com/robots.txt
cache-control: public, max-age=300, s-maxage=300, stale-while-revalidate=600
x-edge-cache-skip: surface_not_declared     <- aplikasi: Varnish tak meng-cache ini
age: 182
cf-cache-status: HIT                        <- Cloudflare: SAYA yang menjawab
```

Dua tier, dua jawaban berbeda, dan yang menjawab pembaca adalah tier yang
**tidak** dijangkau antrean purge. `EDGE_CACHE_PURGE_ENDPOINT` menunjuk
`http://awcms-staging-varnish:80` ([`environments.md`](environments.md) §Cache
tepi), jadi `bun run edge-cache:purge` mem-ban surrogate key **di Varnish
saja**. Tidak ada pemanggilan API zona Cloudflare di mana pun di `src/` — nol
kemunculan.

Akibatnya: menerbitkan konten meng-invalidasi tier yang tidak menyajikan, dan
membiarkan tier yang menyajikan tetap basi.

**Severity: rendah, dan batasnya yang membuatnya rendah.** Kebasiannya berbatas
`s-maxage` (`EDGE_CACHE_MAX_TTL_SECONDS=300`, jadi ≤5 menit), respons
tenant-spesifik dikunci per-host oleh kunci cache Cloudflare, dan apa pun yang
aplikasi tandai `private, no-store` tidak di-cache CF (`cf-cache-status:
DYNAMIC`, diverifikasi). Jadi ini **jeda, bukan kebocoran**.

Yang membuatnya layak dicatat bukan besarnya, melainkan bahwa **tidak ada
pengujian yang bisa melihatnya**: tabel uji penerimaan di `environments.md`
mengukur `X-Cache` dari Varnish — tier yang bukan penjawabnya. Sebuah lapisan
yang benar-benar menyajikan pembaca sementara seluruh instrumen menunjuk
lapisan lain adalah bentuk yang sama dengan tiga bug yang pengaktifan Varnish
sendiri bongkar: melapor sukses sambil tidak bekerja.

Perbaikan: purge Cloudflare di worker yang sama (API zona menerima daftar URL
atau tag), **atau** — sah dan lebih murah — pernyataan tertulis di ADR-0042
bahwa `s-maxage` adalah batas kebasian yang diterima, sehingga tier CF sengaja
tidak di-purge dan uji penerimaannya berhenti mengukur tier yang salah.

### 9.3c Operasional — staging menjalankan build yang tertinggal

Ditemukan saat memakai staging sebagai target verifikasi, dan ia membatasi
apa yang staging bisa buktikan hari ini:

| Probe                             | Staging                                               | Artinya                             |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| `GET /api/v1/media/public-origin` | **404**                                               | #370 belum ter-deploy               |
| `GET /news`                       | **404**                                               | #372 (ADR-0059) belum ter-deploy    |
| `GET /robots.txt`                 | 200, tetapi `x-edge-cache-skip: surface_not_declared` | #376 (ADR-0061 §B) belum ter-deploy |

Konsekuensinya bukan sekadar "perlu deploy": klaim **"cache tepi AKTIF di
staging"** di [`environments.md`](environments.md) benar untuk Varnish sebagai
proses, dan **tidak** benar untuk permukaan yang ADR-0061 deklarasikan — di
build yang berjalan, keenam rute discovery tidak dideklarasikan sama sekali.
Bukti penerimaan yang dokumen itu kutip mendahului PR-nya.

### 9.4 Standar — 22.328 baris `.astro` tidak pernah diperiksa tipe

`bun run typecheck` adalah `tsc --noEmit`. `tsc` **tidak bisa mengurai
`.astro`** — ia melewatinya diam-diam, meskipun `tsconfig.json` menulis
`"include": ["src/**/*"]`. `@astrojs/check` tidak terpasang, dan `astro build`
tidak memeriksa tipe.

Akibatnya **42 berkas / 22.328 baris** — seluruh 31 layar admin, halaman login,
dan halaman publik — tidak punya pemeriksa tipe sama sekali, sementara 33
gerbang lain berjalan di atasnya.

Kelas cacat yang ini lewatkan bukan hipotetis. `withTenant` mengembalikan
`T | Response`; `withTenantOrThrow` melempar. Sebuah halaman `.astro` yang
memakai bentuk pertama lalu memperlakukan hasilnya sebagai data akan
**meng-compile** dan merender halaman rusak tanpa satu pun gerbang merah.

> **Diperiksa, dan hasilnya bersih hari ini.** Sebelas kemunculan `withTenant`
> di `src/pages/**/*.astro` ternyata **seluruhnya di dalam komentar** yang
> menjelaskan kenapa `withTenantOrThrow` yang dipakai (78 kemunculan). Disiplin
> penulisnya benar. Yang tidak ada adalah **yang menjaganya tetap begitu** —
> dan itu justru yang ditemukan berulang di repo ini: kebenaran hari ini tanpa
> pemeriksa adalah kebenaran yang menunggu diubah.

`awcms-astro` menjalankan `astro check` di rantai `check`-nya. Repo dengan
42 berkas `.astro` tidak; repo dengan lebih sedikit, iya.

### 9.5 Interop — kontrak konsumen membekukan enam permukaan; konsumennya memanggil tiga

[ADR-0065](../adr/0065-awcms-astro-consumer-contract-is-frozen.md) menyatakan
`CONSUMER_PATHS` "diturunkan dengan mem-grep repo sebelah". Repo sebelah kini
punya jawaban yang **digerbangi**, dan angkanya berbeda.

`tests/kontrak-awcms.test.mjs` di `awcms-astro` (ADR-0030 di repo itu)
menegakkan **"kode sumber memanggil tepat tiga permukaan"**, dengan komentar
**dibuang lebih dulu** — docblock-nya sendiri menyebutkan alasannya: berkas di
sana MEMERIKAN permukaan yang tidak dipanggil, jadi gerbang yang menghitung
docblock akan melaporkan permukaan yang justru salah.

Diverifikasi langsung ke `src/` repo itu:

| Permukaan                                 | Di `CONSUMER_PATHS` | Benar-benar dipanggil `src/`                                             |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `GET /api/v1/blog/posts`                  | ya                  | **ya** — `src/lib/content.ts`                                            |
| `GET /api/v1/media/objects`               | ya                  | **ya** — `src/lib/awcms/media.ts`, `src/lib/article-images.ts`           |
| `GET /api/v1/media/public-origin`         | ya                  | **ya** — `scripts/asal-media.mjs`, `src/lib/awcms/media.ts`              |
| `GET /api/v1/blog/posts/{id}`             | ya                  | **tidak** — hanya komentar tipe; ADR-0018 di sana menghapus fetch per-id |
| `GET /api/v1/auth/session`                | ya                  | **tidak** — komentar yang menjelaskan kenapa build TIDAK memanggilnya    |
| `POST /api/v1/access/machine-credentials` | ya                  | **tidak** — muncul di pesan error; menerbitkan token adalah aksi MANUSIA |

Alasan yang tertulis untuk satu entri bahkan menyatakan hal yang tidak terjadi:
`/blog/posts/{id}` diberi alasan `"single-post rendering"`, sementara repo itu
merender post dari traversal `view=full`.

**Kenapa ini merugikan, bukan sekadar kelebihan ketelitian.** Kontrak beku yang
memuat permukaan tak-terpakai (a) mengikat repo ini pada bentuk yang tak
seorang pun butuhkan, dan (b) membuat "kontraknya terjaga" terasa lebih lengkap
daripada kenyataannya. Repo sebelah menuliskan keberatan ini sebelum putaran
ini menulisnya.

Perbaikan yang benar **bukan** memangkas jadi tiga: `/auth/session` dan
`/access/machine-credentials` adalah kontrak yang memang dijanjikan ke BFF
ADR-0050 yang belum dibangun. Yang benar adalah **memisahkan dua daftar** —
`CONSUMED` (diturunkan dari blok bertanda di repo sebelah, sehingga tak bisa
menyimpang diam-diam) dan `COMMITTED` (dijanjikan, belum dipanggil, dengan ADR
yang menjanjikannya) — lalu membekukan keduanya dengan alasan yang jujur pada
masing-masing.

> **Ironi yang layak dicatat.** Cacat ini lahir dari mem-grep tanpa membuang
> komentar. Putaran ini nyaris melaporkan cacat kembar di repo INI dengan cara
> yang sama persis (§9.4): sebelas `withTenant` di `.astro` yang ternyata
> seluruhnya komentar. Bedanya cuma satu — yang kedua diperiksa sebelum ditulis.

### 9.6 Standar — pengecualian skill bersifat per-SKILL dan total

`skills-check.ts` menjaga `.claude/skills/` dengan tiga aturan, dan sebuah
daftar `ASPIRATIONAL_SKILLS` (18 entri) yang **membebaskan sebuah skill
seluruhnya** dari aturan path (1) dan aturan perintah (4).

`awcms-performance` masuk daftar itu dengan alasan
`"cross-cutting: names deferred performance tooling"`. Alasannya menyebut
**perintah**; pembebasannya mencakup **path juga**. Akibatnya di badan skill
yang sama:

- Bagian atas: _"PERINGATAN — perintah di halaman ini BELUM ADA di repo ini."_
- Enam puluh baris di bawahnya: _"gunakan suite yang sudah ada di
  `src/lib/performance/`, jangan bangun tooling ad hoc baru"_ — direktori yang
  **tidak ada**.

Sebuah skill yang membantah dirinya sendiri lebih buruk daripada skill yang
salah, karena pembacanya akan memilih kalimat yang paling cocok dengan
pekerjaannya. Dan skill **DIIKUTI** — itu premis ADR-0062.

Diukur di seluruh direktori: **16 dari 55 skill** memuat setidaknya satu klaim
`src/…` atau `bun run …` yang tidak resolve. Sebagian besar sah (target-spec
dan historis). Yang tidak sah tidak bisa dibedakan dari yang sah oleh gerbang
mana pun, karena pembebasannya sepaket.

**Lubang kedua, mekanis, dan lebih mudah ditutup.** Ekstraktor path gerbang itu
hanya melihat path berbacktick **satu baris**. Prettier membungkus baris panjang
di markdown, jadi sebuah path bisa jatuh menjadi:

```
… didorong oleh `src/lib/config/
registry.ts`'s field `deprecated`.
```

— dan menjadi **tak terlihat oleh gerbang**. Hari ini ada **tiga** path
semacam itu di `.claude/skills/`. Dua ada di skill yang memang dibebaskan; satu
tidak: `awcms-production-preflight` mengklaim `src/lib/config/registry.ts`,
sebuah berkas yang tidak ada (tidak ada direktori `src/lib/config/` sama sekali)
di skill yang **tidak** dibebaskan. Ia lolos murni karena posisi pembungkusan
baris.

Itu berarti aturan 1 hari ini bukan "path yang disebut wajib ada" melainkan
"path yang disebut **dan kebetulan muat dalam satu baris** wajib ada" — dan
selisih itu tidak ditulis di mana pun.

> **Dibuktikan, bukan didalilkan.** Saat koreksi untuk skill itu ditulis,
> path-nya disatukan kembali ke satu baris — dan `bun run skills:check` yang
> sebelumnya `OK` **langsung merah**, menamai persis berkas itu. Lubangnya
> mekanis, dan mutation-proof-nya gratis.

**Lubang ketiga, dan ia yang menjelaskan kenapa dua yang pertama ada.** Gerbang
itu tidak punya cara membedakan _"path ini ada"_ dari _"path ini TIDAK ada, dan
itulah maksud kalimatnya"_. Sebuah koreksi yang menulis nama berkas hilang
dengan backtick akan **memerahkan gerbang justru karena benar**. Itulah tekanan
yang melahirkan daftar pembebasan sepaket: ketika satu-satunya cara menulis
kebenaran adalah membebaskan seluruh skill, orang akan membebaskan seluruh
skill.

Perbaikan: (a) persempit pembebasan ke **blok bertanda** di dalam skill (pola
penanda sudah dipakai `repo-inventory.md` di sini dan
`<!-- permukaan:dipanggil:mulai -->` di repo sebelah) — blok itu sekaligus
menjadi tempat sah untuk menamai berkas yang memang tidak ada; dan (b)
normalkan whitespace di dalam backtick sebelum mencocokkan path. Yang kedua satu
baris kode, dan menemukan cacat nyata pada hari ia mendarat.

### 9.7 Standar — enam ADR `Accepted` tanpa satu baris kode

| ADR      | Menyatakan                                 | Di kode                                                         |
| -------- | ------------------------------------------ | --------------------------------------------------------------- |
| ADR-0016 | admission modul `organization_structure`   | `src/modules/organization-structure` **tidak ada**              |
| ADR-0017 | admission modul `document_infrastructure`  | **tidak ada**                                                   |
| ADR-0018 | admission modul `data_exchange`            | **tidak ada**                                                   |
| ADR-0019 | admission modul `integration_hub`          | **tidak ada**                                                   |
| ADR-0021 | admission modul `reference_data`           | **tidak ada**                                                   |
| ADR-0020 | kontrak kesiapan ekstensi ERP di `_shared` | ketiga berkasnya **dihapus** ADR-0034; `_shared/` tak memuatnya |

ADR-0020 kasus terburuknya: statusnya `Accepted` sementara artefak yang ia
putuskan sudah **dicabut oleh ADR lain** yang tidak menandainya `Superseded`.

Ini kelas yang sama persis dengan yang ADR-0062 tutup untuk skill: `Accepted`
terbaca sebagai "ada di kode", dan tak ada yang memeriksanya. Bedanya, ADR
tidak bisa digerbangi seketat skill — sebuah ADR admission memang sah mendahului
implementasinya. Yang kurang bukan gerbangnya melainkan **kosakatanya**: status
`Accepted` mengemas dua keadaan berbeda ("diputuskan, belum dibangun" dan
"diputuskan, berjalan") menjadi satu kata.

### 9.8 Standar — utang rilis

`v6.4.0` di-tag 26 Juli 2026. Sejak itu: **108 commit, 100 changeset menunggu**,
satu di antaranya `major` — jadi rilis berikutnya `v7.0.0`.

Angka di `PROJECT_STATE.md` berbunyi 68 sembilan hari lalu; dokumen itu bahkan
memuat catatan tentang bagaimana angka itu basi sebelumnya. Ia basi lagi, di
baris yang sama.

Yang membuat ini lebih dari kerapian: satu rilis dengan 100 changeset
menghasilkan CHANGELOG yang tak seorang pun baca, dan sebuah `major` yang
terkubur di tengahnya. Rilis kecil-sering adalah kontrol mutu, bukan proses.

### 9.9 Performa — ADR-0067 belum menimbang pengukuran lab

ADR-0067 menawarkan tiga opsi: **A** tidak mengumpulkan, **B** agregat-saja,
**C** baris mentah (ditolak). Ketiganya adalah bentuk **RUM** — mengumpulkan
data dari pengunjung nyata — dan itulah kenapa ADR-nya bertabrakan dengan
postur privasi `visitor_analytics` dan berakhir menunggu keputusan pemilik
produk.

Yang tidak ada di ADR itu: **pengukuran lab**. Lighthouse/Playwright terhadap
build sendiri mengumpulkan **nol** data pengunjung, tidak menyentuh
`visitor_analytics`, tidak butuh tabel, tidak butuh endpoint publik — dan repo
ini **sudah punya Playwright terpasang serta suite E2E ber-gerbang env**.

Keduanya menjawab pertanyaan yang berbeda, dan itu justru alasan keduanya bisa
hidup bersama: lab menjawab _"apakah perubahan ini membuat halaman lebih
lambat"_, RUM menjawab _"apa yang dialami pengunjung"_. Menunggu keputusan atas
yang kedua tidak menghalangi yang pertama.

Rekomendasi: tambahkan **Opsi D — pengukuran lab** ke ADR-0067 sebagai opsi
yang ortogonal (bisa diambil bersama A), dengan keterbatasannya dinyatakan:
lab mengukur halaman, bukan pengunjung.

### 9.10 Rekomendasi berperingkat putaran kedua

| #   | Rekomendasi                                                             | Sumbu    | Butuh ADR?                     |
| --- | ----------------------------------------------------------------------- | -------- | ------------------------------ |
| 1   | `AUTH_COOKIE_SECURE` gagal-tertutup saat tidak diset (§9.1)             | Keamanan | Tidak — perbaikan cacat        |
| 2   | `astro check` masuk rantai `check` (§9.4)                               | Standar  | Tidak — gerbang murni          |
| 3   | COOP + CORP (§9.2)                                                      | Keamanan | Tidak                          |
| 4   | Pisahkan `CONSUMED` dari `COMMITTED` di kontrak konsumen (§9.5)         | Interop  | Ya — mengubah ADR-0065         |
| 5   | Catat divergence HSTS di manifest keluarga                              | Standar  | Tidak                          |
| 6   | Deploy staging ke `main` (§9.3c) — prasyarat verifikasi apa pun di sana | Operasi  | Tidak                          |
| 7   | Putuskan purge Cloudflare vs `s-maxage` sebagai batas kebasian (§9.3b)  | Performa | Ya — mengubah ADR-0042         |
| 8   | Anggaran query untuk layar admin + anggaran ukuran aset (§9.0)          | Performa | Tidak                          |
| 9   | Persempit pembebasan `ASPIRATIONAL_SKILLS` ke blok bertanda (§9.6)      | Standar  | Ya — mengubah ADR-0062         |
| 10  | Opsi D (lab) di ADR-0067 (§9.9)                                         | Performa | Ya — mengubah ADR-0067         |
| 11  | Kosakata status ADR untuk "diputuskan, belum dibangun" (§9.7)           | Standar  | Ya                             |
| 12  | ADR tingkat keluarga untuk pin edisi OWASP                              | Keamanan | Ya                             |
| 13  | Rilis `v7.0.0` (§9.8)                                                   | Standar  | Tidak                          |
| —   | ~~Kompresi respons di lapisan yang repo miliki~~ (§9.3)                 | Performa | **DICABUT** — Cloudflare sudah |

**Urutan yang disarankan: sesuai nomor.** Nomor 1 lebih dulu karena ia
satu-satunya cacat kontrol keamanan yang aktif; 2–5 menyusul karena masing-masing
berbiaya satu baris ditambah satu asersi. Nomor 6 mendahului sisanya bukan karena
penting melainkan karena **prasyarat**: sampai staging menjalankan `main`, ia
tidak bisa membuktikan apa pun tentang perubahan ini.

Rekomendasi kompresi **dicabut, bukan ditunda.** Probe ke staging dan produksi
membuktikan respons memang terkompresi (oleh Cloudflare), jadi menambah lapisan
kedua akan menciptakan tepat dua tempat yang memutuskan hal yang sama — persis
yang rekomendasi aslinya larang. Yang tersisa dari §9.3 hanyalah mencatat
ketergantungan itu, dan itu masuk sebagai baris di
[`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md) §9, bukan
sebagai pekerjaan.
