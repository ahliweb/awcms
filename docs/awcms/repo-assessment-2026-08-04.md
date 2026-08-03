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
| Modul terdaftar                   | 22         |
| Migrasi `sql/`                    | 89         |
| Tabel (`CREATE TABLE`)            | 130        |
| Pernyataan RLS `ENABLE` / `FORCE` | 118 / 141  |
| Rute API `/api/v1`                | 255 berkas |
| Layar admin                       | 31         |
| Berkas test                       | 292        |
| Baris `src/` (ts + astro)         | ~156.000   |
| Gerbang di rantai `bun run check` | 28         |
| ADR                               | 63         |
| Index database                    | 253        |

Ini bukan repo muda. Kepadatan gerbangnya (28) tinggi untuk ukurannya, dan itu
konteks penting untuk seluruh bagian berikut: **temuan di bawah bukan hal yang
lolos karena tidak ada yang memeriksa — melainkan hal yang tidak ada
pemeriksanya.**

## 2. Temuan P0 — satu rute melewati chokepoint otorisasi

### Apa yang ditemukan

`POST /api/v1/blog/posts/{id}/submit-review`
([`src/pages/api/v1/blog/posts/[id]/submit-review.ts`](../../src/pages/api/v1/blog/posts/[id]/submit-review.ts))
**tidak memanggil `authorizeInTransaction` sama sekali.** Ia menyusun
otorisasinya sendiri:

```
resolveTenantContext → resolveModuleEnabled → fetchGrantedPermissionKeys
  → evaluatePostUpdateAccess → recordDecisionLog
```

Bandingkan dengan `PATCH /api/v1/blog/posts/{id}`, yang menegakkan **permission
yang SAMA** (`blog_content.posts.update`) dan memanggil `authorizeInTransaction`
lebih dulu, **lalu** `evaluatePostUpdateAccess` sebagai aturan kepemilikan
tambahan.

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

1. Routekan `submit-review` lewat `authorizeInTransaction` (pola `PATCH /{id}`
   sudah jadi cetakannya: chokepoint dulu, aturan kepemilikan sesudah).
2. **Tambah gerbang untuk KELASNYA**, bukan hanya instansnya: setiap berkas rute
   di `src/pages/api/v1/**` yang menyentuh `fetchGrantedPermissionKeys` tanpa
   `authorizeInTransaction` / `defineTenantRoute` gagal, dengan daftar
   pengecualian ber-alasan. Hari ini himpunan itu **tepat dua** berkas —
   `submit-review.ts` dan `auth/login.ts` (yang memang pra-autentikasi, sehingga
   jadi satu-satunya entri daftar). Nilai daftar yang berisi satu entri sama
   dengan yang ADR-0058 catat: entri BERIKUTNYA tak bisa masuk tanpa terlihat.

## 3. Temuan P1 — rate limiter tidak bertahan di lebih dari satu instans

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

## 4. Temuan P1 — kontrak yang dipakai `awcms-astro` tidak dijaga test apa pun

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

### Celah 1 — tidak ada gerbang performa sama sekali

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
2. **Anggaran query per-endpoint** untuk rute terpanas, memakai pola
   Proxy-apply-trap yang **sudah ada** di test SoD (#181) — jadi tekniknya
   terbukti di repo ini, tinggal diperluas.
3. Core Web Vitals: keputusan produk, bukan cacat. Bila diambil, tempatnya di
   `visitor_analytics` dengan ADR admission sendiri.

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
