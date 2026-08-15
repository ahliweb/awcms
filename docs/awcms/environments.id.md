🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](environments.md)

<!-- i18n-source-hash: sha256:6925da02c6a3032bf41b54bcf15d7ab71436a6c7bda23a16ee8fc95c3815a342 -->

# Environment awcms — satu deployment, dan kontrak isolasi bila ada environment kedua

> Dokumen **current-state**. Repo ini punya **satu** environment ter-deploy —
> keputusannya
> [ADR-0083](../adr/0083-this-template-deploys-to-one-environment.md). `staging`
> **bukan lagi** profil deployment: ia dihapus dari kosakatanya, bukan sekadar
> tidak dijalankan di sini. Profil yang tersisa: `development`, `production`,
> `offline-lan`. Yang **tidak** ikut terhapus adalah kontrak isolasinya — ia
> berpindah rumah, dari sebuah tingkatan bernama menjadi aturan bagi
> **environment kedua apa pun** yang seseorang dirikan
> (§[Kontrak isolasi environment kedua](#kontrak-isolasi-environment-kedua)).
> Untuk mekanisme deploy-nya lihat [`deploy-coolify.md`](deploy-coolify.md) dan
> [`deployment-profiles.md`](deployment-profiles.md).

## Satu environment

| Environment    | Domain                 | `APP_ENV`    | Catatan                                                                         |
| -------------- | ---------------------- | ------------ | ------------------------------------------------------------------------------- |
| **Production** | `awcms.ahlikoding.com` | `production` | Satu-satunya deployment hidup repo ini. Data nyata, integrasi keluar **AKTIF**. |

Development bukan baris kedua yang hilang dari tabel itu. Ia
`http://localhost:4321` dengan `APP_ENV=development`, hidup di workstation, dan
tidak pernah di-deploy ke host mana pun (§Development lokal). Yang berkurang
dari dokumen ini adalah **environment ter-deploy kedua**, bukan fase kerjanya.

Alasannya pendek dan seluruhnya ada di ADR-0083: sebuah environment
pra-produksi ada untuk **melatih perubahan terhadap data dan trafik sungguhan
sebelum menyentuhnya**, dan deployment repo ini tidak punya keduanya — ia ada
untuk menunjukkan dan memvalidasi template, bukan melayani bisnis. Yang akan
"di-stage" adalah templatenya sendiri, dan template divalidasi oleh rantai
gerbang plus suite integrasi ber-Postgres di CI, bukan oleh salinan kedua yang
berjalan. Maka environment kedua di sini bukan jaring pengaman melainkan satu
set secret lagi, satu database lagi yang butuh backup, satu antrean migrasi
lagi, satu domain lagi, dan satu tempat lagi yang bisa diam-diam basi.

Yang ikut hilang bersamanya dicatat sebagai **biaya**, bukan disembunyikan:
tidak ada lagi latihan pra-produksi untuk `sql/NNN`. Penggantinya adalah backup
yang sudah **diverifikasi bisa di-restore** sebelum tiap migrasi diterapkan
(`deploy/backup/restore-postgres.sh`, mode verify-only) — mitigasi, bukan
pengganti setara.

Deployment-nya berjalan di host Docker yang sama dengan aplikasi lain
(`192.42.84.46`), dikelola Coolify, di belakang Traefik yang memegang
`:80`/`:443` dan menerbitkan TLS lewat resolver `letsencrypt`.

> **Aturan yang tetap berlaku bagi siapa pun yang menjalankan lebih dari satu
> environment: satu app Coolify per environment** — bukan satu app dengan dua
> domain. Environment yang berbagi app berbagi env var, dan itulah cara sebuah
> environment kedua tanpa sengaja menulis ke data produksi. §Keadaan yang
> dikoreksi di bawah adalah versi lebih ringan dari kegagalan yang sama (satu
> app, dua host di satu rule Traefik), dan sudah cukup mahal.

## Keadaan yang dikoreksi ADR-0083 (11 Agustus 2026)

Bagian ini ditulis karena ia menyesatkan selama berjam-jam, dan akan
menyesatkan orang berikutnya persis sama bila tidak tertulis. Diverifikasi pada
host, 11 Agustus 2026:

- Baris aplikasi produksi (`got4etcblum9kowdv4mrixqo`) **tidak ada** di tabel
  `applications` Coolify. Bukan soft-delete — barisnya memang tidak ada.
- **Tidak ada database produksi** di `standalone_postgresqls`. Satu-satunya yang
  ada adalah `awcms_staging`.
- Container `awcms-staging-varnish` memasang rule Traefik yang mencocokkan
  **kedua** host: ``Host(`awcms-staging.ahlikoding.com`) ||
Host(`awcms.ahlikoding.com`)``. Domain produksi karena itu dilayani
  **deployment staging, di atas database staging**, dengan `APP_ENV=staging`.

Dari situ satu kalimat yang layak dihafal: **respons 200 di
`awcms.ahlikoding.com` bukan bukti produksi hidup.** Sepanjang keadaan di atas
domain itu menjawab 200, sehat, tanpa keluhan. Verifikasi kepada
`applications`/`standalone_postgresqls` — bukan kepada `curl`.

Akibatnya untuk membaca dokumen ini hari ini: **setiap pengukuran langsung
terhadap `awcms.ahlikoding.com` mengukur deployment `awcms-staging-*` itu.**
Bagian bertanda "produksi" di bawah menggambarkan bentuk yang ditegakkan
kembali, beserta bukti dari saat ia terakhir benar-benar berjalan — bukan
pengamatan hari ini. Rule Traefik dua-host itu wajib dicabut ketika produksi
ditegakkan kembali; sampai itu terjadi, `APP_ENV` di host ini berhenti
menandakan apa pun, dan orang berikutnya yang membacanya untuk memutuskan
sesuatu yang berbahaya akan mendapat jawaban salah dengan percaya diri.

> **Tiga baris di atas adalah pengamatan bertanggal 11 Agustus 2026, dan
> dipertahankan apa adanya.** Nama `awcms_staging`/`awcms-staging-varnish` di
> sana adalah nama sumber daya yang benar-benar ada di host saat itu — bukan
> bukti bahwa ada "profil staging". Sesudah pengamatan itu pemilik repo
> memutuskan `staging` **dihapus seluruhnya**, termasuk dari kosakata profil
> deployment; app, database, dan Varnish bernama itu sedang dibongkar sebagai
> pekerjaan infrastruktur terpisah. Yang tersisa dari mereka di dokumen ini
> hanyalah namanya di dalam catatan bertanggal.

## Kontrak isolasi environment kedua

Bagian ini **tidak** menggambarkan sebuah profil deployment. `staging` sudah
tidak ada — bukan "ada tapi tidak dipakai di sini", melainkan dihapus dari
kosakata profil; yang tersisa `development`, `production`, dan `offline-lan`.
Yang dulu ditulis sebagai "kontrak staging" tetap berlaku, hanya sasarannya yang
berubah: ia sekarang aturan untuk **environment kedua apa pun** yang seseorang
dirikan di samping produksinya — sebutlah pra-produksi, mirror, sandbox, atau
apa pun namanya. Bentuk kegagalannya sama persis, dan tidak peduli nama
tingkatannya.

Kontrak ini mahal untuk diturunkan ulang — sebagiannya dibayar dengan kesalahan
nyata di environment kedua `awcms-micro` — jadi ia tidak ikut terhapus bersama
tingkatan yang dulu memakainya.

Environment kedua umumnya berjalan di host yang sama dengan produksi. Yang
memisahkannya **hanya konfigurasi**, jadi konfigurasi itu harus tegas:

- **Database sendiri**, role `awcms_app` sendiri, password sendiri. Bukan skema
  lain di cluster produksi.
- **Secret sendiri** — `AUTH_IP_HASH_SECRET`, `COMMENTS_TIMING_SECRET`, token
  purge cache tepi, kunci enkripsi. Menyalin secret produksi ke environment
  kedua berarti nilai yang dipakai environment kedua berlaku juga di produksi.
- **Integrasi keluar MATI**: `R2_ENABLED=false`, `EMAIL_ENABLED=false`, sync
  nonaktif. Environment kedua tidak boleh bisa menulis ke bucket media produksi
  atau mengirim email ke alamat orang sungguhan.
- `NEWS_PORTAL_PROFILE` **dihapus** (bukan diisi nilai lain) ketika environment
  itu tanpa R2 — satu-satunya nilai yang diterima `full_online_r2`, jadi
  `config:validate` akan menolak sebelum deploy. Ini kesalahan nyata yang
  tertangkap di micro.
- **Provider DNS `manual`**, bukan `cloudflare` — lihat §Subdomain tenant.
- **Token purge cache tepi berbeda per environment** — lihat §Cache tepi.
- Akun owner boleh memakai identifier yang sama; **password-nya tidak pernah
  sama** — lihat §Tenant default.

`APP_ENV` environment kedua itu tetap salah satu nilai yang ada — pada
praktiknya `production`, karena aturan produksi (cookie `Secure`, proxy
tepercaya, penolakan escape hatch SSRF) justru yang ingin dilatih. Tidak ada
nilai `APP_ENV` yang menandai "ini bukan yang sungguhan": yang memisahkan adalah
database, secret, dan integrasi keluar di daftar atas, bukan sebuah label.

Jalankan `bun run config:validate` dan `bun run security:readiness` **sebelum**
deploy pertama tiap environment.

## Tenant default & akun owner

| Hal                       | Development               | Production                |
| ------------------------- | ------------------------- | ------------------------- |
| `tenant_code`             | `development`             | `ahliweb`                 |
| `PUBLIC_DEFAULT_TENANT_*` | pin ke tenant lokal       | pin ke tenant `ahliweb`   |
| Login owner               | `admin@ahlikoding.com`    | `admin@ahlikoding.com`    |
| Password owner            | **sendiri**               | **sendiri**               |
| Role                      | `owner` (system, 197/197) | `owner` (system, 197/197) |

Instalasi yang menjalankan environment kedua memakai konvensi yang sama dengan
`tenant_code`-nya sendiri; yang berikut ini berlaku untuk setiap pasang
environment, bukan hanya dua kolom di atas.

**Identifier-nya sama, password-nya TIDAK PERNAH sama.** `awcms_identities` unik
pada `(tenant_id, login_identifier)`, jadi satu alamat di dua environment adalah
**dua akun terpisah** dengan dua hash password berbeda. Sesi juga tidak
menyeberang: token sesi adalah nilai acak buram yang disimpan sebagai hash
sha256 di `awcms_sessions` — tabel yang tenant-scoped — sehingga token hanya
berlaku pada database yang menerbitkannya. Menyalin password antar environment
membatalkan isolasi yang justru jadi alasan memisahkannya, dan itu satu-satunya
hal yang bisa membatalkannya, karena tidak ada lagi yang dibagi.

> **Catatan koreksi.** Versi sebelumnya paragraf ini menyebut "tiga
> `AUTH_JWT_SECRET` berbeda". **Variabel itu tidak ada di awcms** — tidak dibaca
> di mana pun dalam `src/`, dan tidak ada JWT di jalur sesi. Klaim itu keliru dan
> menyesatkan: operator bisa mengira memutar variabel tersebut memisahkan sesi
> antar-environment, padahal yang memisahkan adalah tenant-scoping di atas.

### Kenapa `PUBLIC_DEFAULT_TENANT_*` di-pin, padahal tanpa itu pun jalan

Rantai resolusinya `host` → `PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE`
→ `awcms_setup_state.tenant_id`. Tanpa dua var itu, jawaban atas "host yang tidak
cocok jatuh ke tenant mana?" tetap ada — tapi tersembunyi di sebuah baris tabel,
bukan dinyatakan. Dan begitu tenant kedua ditambahkan, jawaban implisit itu bisa
berubah tanpa satu pun perubahan konfigurasi. Konsumennya nyata:
`seo_distribution` (`/robots.txt`, sitemap, feed) dan `site_search`.

`PUBLIC_TENANT_RESOLUTION_MODE` **tidak** di-set di mana pun. Menyalakan
`host_default` menuntut baris `awcms_tenant_domains` untuk host itu ada **di
database yang benar-benar melayaninya** — dan itu diverifikasi pada database
produksi setelah ia ditegakkan kembali, bukan diwarisi dari catatan lama
(§Keadaan yang dikoreksi: database produksi yang dulu memuat baris itu sudah
tidak ada). Terlepas dari itu, menyalakannya adalah keputusan perilaku
tersendiri — ia mengaktifkan lookup host dan memperluas permukaan yang tersentuh
— bukan bagian dari "tetapkan tenant default". Nyalakan terpisah bila memang
diinginkan.

### Jebakan: seed permission tidak menjangkau tenant lama

Migrasi seed permission hanya berlaku untuk tenant yang dibuat **setelahnya**.
Mendaratkan modul baru **tidak** memberi permission-nya ke owner yang sudah ada —
gejalanya 403 `ACCESS_DENIED` pada modul yang "sudah terpasang". Terjadi nyata di
produksi 2026-07-26: owner kehilangan 18 permission (`comments`, `site_search`,
`form_drafts`) setelah migrasi 062–070. Backfill adalah langkah deployment:

```bash
bun run identity-access:permissions:backfill              # DRY-RUN, aman di produksi
bun run identity-access:permissions:backfill --commit     # menulis
bun run identity-access:permissions:backfill --tenant <kode> --commit   # bertahap
```

**Jangan pakai SQL "grant semua yang hilang".** Versi sebelumnya dari dokumen ini
menganjurkan `LEFT JOIN … WHERE rp.permission_id IS NULL`, dan bentuk itu tidak
bisa membedakan "belum pernah ada saat tenant dibuat" dari "dicabut admin dengan
sengaja" — ia menghidupkan kembali persis grant yang seseorang putuskan untuk
dihapus, tanpa jejak. Perintah di atas hanya memberikan permission yang baris
katalognya **lebih baru** dari role owner-nya, melaporkan sisanya sebagai
"presumed removed on purpose", dan menulis satu entri audit per tenant.

Verifikasi bahwa "akses penuh" memang penuh — RBAC penuh belum cukup bila ada
ABAC deny, aturan SoD, atau batasan business-scope:

```sql
SELECT count(*) FROM awcms_abac_policies WHERE is_active AND is_dsl_managed;
SELECT count(*) FROM awcms_business_scope_assignments;
```

Keduanya `0` pada setiap database yang diukur 2026-07-26, dan tidak ada rute base
yang menyetel `requiredScopeType`, jadi RBAC benar-benar penentu tunggalnya.
Kuerinya diulang pada database produksi yang baru — angka lama adalah pengukuran,
bukan jaminan.

## Development lokal disamakan dengan produksi (2026-07-26)

Sebelum ini dev bukan versi kecil produksi, melainkan **environment yang
berbeda secara diam-diam**: skema berhenti di migrasi 30 (produksi 70), nol
tenant, tidak ada `.env`, dan satu-satunya role dengan LOGIN adalah `awcms`
milik container — seorang **superuser**. Bug kelas paling mahal — kebocoran
RLS dan 403 karena permission — justru yang paling mustahil direproduksi di
sana, karena superuser menembus RLS dan tenant kosong tak punya permission
untuk salah.

Sejak disamakan, keduanya cocok baris per baris. Angka di bawah adalah
**snapshot 2026-07-26**, bukan konstanta: pohon repo kini memuat 108 migration,
jadi paritasnya diukur ulang setiap kali, tidak dikutip dari sini.

|                      | Development     | Production      |
| -------------------- | --------------- | --------------- |
| migrasi              | 70              | 70              |
| tabel                | 118             | 118             |
| `awcms_permissions`  | 197             | 197             |
| RLS `ENABLE`+`FORCE` | 109/118         | 109/118         |
| runtime role         | `awcms_app`     | `awcms_app`     |
| owner                | `owner` 197/197 | `owner` 197/197 |

Yang tetap **sengaja** berbeda, dan alasannya:

| Var                     | Dev     | Prod   | Kenapa                                                                                                                                  |
| ----------------------- | ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_COOKIE_SECURE`    | `false` | `true` | dev jalan di `http://`; cookie `Secure` tidak akan pernah terkirim                                                                      |
| `TRUSTED_PROXY_ENABLED` | `false` | `true` | tidak ada proxy di depan `bun dev`; kalau `true`, siapa pun bisa memalsukan `X-Forwarded-For` dan memilih bucket rate-limit-nya sendiri |
| `EDGE_CACHE_MODE`       | `off`   | `auto` | tidak ada Varnish lokal; `auto` hanya akan mengantre purge yang tak pernah dikonsumsi                                                   |

`TRUSTED_PROXY_HOP_COUNT` (default `1`) berlaku hanya saat
`TRUSTED_PROXY_ENABLED=true`, dan `config:validate` menolak kombinasi
sebaliknya — menyetelnya sendirian adalah operator yang mengira sudah menyetel
sesuatu. Angkanya menghitung entri `X-Forwarded-For` **dari kanan**: entri di
kiri hop tepercaya Anda ditulis oleh sesuatu yang tidak Anda kendalikan, jadi
tidak pernah dibaca (#438). Naikkan hanya sebanyak proxy yang benar-benar Anda
miliki — angka yang terlalu besar justru melebarkan bagian header yang bisa
dipalsukan.

### Role separation di lokal — bukan formalitas

`sql/019`/`022` membuat `awcms_app`/`awcms_worker`/`awcms_setup` sebagai
`NOLOGIN` tanpa password. Migrasi hijau **tidak** berarti role separation
aktif; sampai ketiganya diberi `LOGIN PASSWORD` dan `DATABASE_URL` diarahkan ke
`awcms_app`, runtime tetap superuser dan `FORCE RLS` inert. Sekali jalan:

```sql
ALTER ROLE awcms_app    LOGIN PASSWORD '<acak>';
ALTER ROLE awcms_worker LOGIN PASSWORD '<acak>';
ALTER ROLE awcms_setup  LOGIN PASSWORD '<acak>';
```

Migrasi tetap dijalankan sebagai role pemilik DDL (`awcms`), **bukan**
`awcms_setup` — role itu hanya punya `USAGE` pada schema `public`, bukan
`CREATE`. Ini sama seperti produksi.

Buktikan hasilnya, jangan diasumsikan — sebagai `awcms_app`:

```
super=false bypassrls=false
tanpa tenant context   -> awcms_identities terlihat: 0
tenant sendiri         -> awcms_identities terlihat: 1
tenant asing (uuid)    -> awcms_identities terlihat: 0
```

Pola `0 / 1 / 0` yang sama adalah bentuk bukti yang diterima di **deployment mana
pun**, bukan hanya di lokal. Kalau baris pertama bukan `0`, RLS tidak menyala dan
semua sisanya tidak ada artinya.

### `DATABASE_URL` dipakai dua peran yang saling bertentangan

Begitu `.env` ada, **suite DB-gated ikut menyala** — Bun memuat `.env` sendiri,
jadi tidak ada `DATABASE_URL` kosong seperti job `quality` di CI. Dan di situ
dua kebutuhan bertabrakan pada satu variabel yang sama:

- **runtime** menginginkan `awcms_app` — least-privilege, RLS berlaku;
- **harness integrasi** menginginkan role **privileged** — ia membuat database
  ephemeral dan menjalankan `ALTER ROLE`. Dengan `awcms_app` hasilnya
  `permission denied to alter role` (42501), bukan skip.

CI menyelesaikannya dengan menjalankan keduanya di job berbeda. Di lokal,
biarkan `.env` memegang konfigurasi runtime (`awcms_app`) dan **override saat
menjalankan test**; env var eksplisit menang atas `.env`:

```bash
OWNER='postgres://awcms:<pw>@localhost:5433/awcms'
DATABASE_URL="$OWNER" SETUP_DATABASE_URL="$OWNER" WORKER_DATABASE_URL="$OWNER" \
  bun test tests/integration/
```

**Override ketiganya, bukan hanya `DATABASE_URL`.** Kalau `SETUP_DATABASE_URL`
dibiarkan diambil dari `.env`, harness memeriksa bahwa klien app dan klien setup
menunjuk database yang sama, gagal, dan melapor `Connection closed` — pesan yang
sama sekali tidak menunjuk ke penyebabnya.

Kedua suite itu **tidak boleh** satu proses `bun test` (tabrakan data — lihat
komentar di `ci.yml`). Jalankan terpisah, persis seperti CI. Hasil di dev
2026-07-26: harness 142 pass, legacy 64 pass, nol gagal.

### Jebakan: `bun run db:migrate` dari host bisa timeout

Di sebagian sandbox, TCP ke port Postgres yang di-publish **connect** tapi
startup message-nya tidak pernah dibalas — gejalanya `Connection timeout after
30s (sent startup message...)`, bukan connection refused, jadi mudah salah baca
sebagai kredensial keliru. Jalan pintasnya: jalankan di dalam network namespace
container DB-nya.

```bash
docker run --rm --network container:<pg-container> \
  -v "$PWD":/app -w /app \
  -e DATABASE_URL='postgres://awcms:<pw>@127.0.0.1:5432/awcms' \
  -e APP_ENV=development -e APP_URL=http://localhost:4321 \
  oven/bun:1 bun scripts/db-migrate.ts
```

Catat `127.0.0.1:5432` — di dalam namespace itu, port yang di-publish ke host
tidak relevan. Image `oven/bun` **tidak punya `curl` maupun `git`**: pakai
`fetch` untuk HTTP, dan jangan jalankan test yang memanggil `git` di sana.

## `APP_URL` bukan kosmetik

`APP_URL` **wajib** (`scripts/validate-env.ts`) dan bukan sekadar label: ia
menyusun URL callback OIDC/SSO (`src/lib/auth/sso-config.ts`). Salah host = alur
login rusak dengan `redirect_uri_mismatch`, bukan sekadar tautan yang jelek.

```bash
APP_ENV=production
APP_URL=https://awcms.ahlikoding.com
```

Instalasi turunan yang menjalankan environment kedua mendaftarkan **satu
redirect URI per environment** di IdP, dan mendaftarkannya **sebelum** login di
environment itu dipakai — bukan sesudah alurnya gagal.

## DNS

Zona `ahlikoding.com` ada di Cloudflare (NS `dilbert`/`katja`).
`awcms.ahlikoding.com` menunjuk ke `192.42.84.46`. Record
`awcms-staging.ahlikoding.com` masih ada dan menunjuk host yang sama — sisa
topologi lama, dan pada 11 Agustus 2026 justru hostname itulah yang
deployment-nya melayani kedua domain (§Keadaan yang dikoreksi). Record itu ikut
dibongkar bersama sumber daya bernama sama; ia tidak menandakan sebuah profil.

Setelah record ada, TLS terbit otomatis lewat Traefik — tidak ada konfigurasi
lain. Sejak 2026-07-25 resolver `letsencrypt` di Traefik pakai **tantangan
DNS-01 via Cloudflare** (bukan HTTP-01 lagi), jadi status proxy record
(DNS-only vs proxied/orange cloud) **tidak memengaruhi** penerbitan/renewal
sertifikat — keduanya jalan sama saja. Detail perubahan dan alasannya ada di
`docs/12-cloudflare-proxy-dns01.md` pada repo `serv-dinkesdocker`.

### Subdomain tenant (asumsi — konfirmasi sebelum dipakai)

`bun run tenant-domain:dns:sync` (ADR-0042 / PR #236) mengubah baris
`awcms_tenant_domains` menjadi record DNS nyata, tetapi butuh **root domain**
yang belum ditetapkan pemilik repo. Yang paling koheren dengan domain di atas:

```bash
TENANT_DOMAIN_DNS_PROVIDER=cloudflare
TENANT_DOMAIN_PLATFORM_ROOT_DOMAIN=awcms.ahlikoding.com
TENANT_DOMAIN_SERVING_TARGET=awcms.ahlikoding.com
TENANT_DOMAIN_SERVING_RECORD_TYPE=CNAME
```

→ subdomain tenant berbentuk `<tenant>.awcms.ahlikoding.com`.

Ini **asumsi yang ditulis eksplisit**, bukan keputusan yang sudah diambil.
Alternatifnya adalah root `ahlikoding.com` (memberi `<tenant>.ahlikoding.com`),
yang lebih pendek tetapi menaruh namespace tenant di zona yang dipakai bersama
aplikasi lain di host itu. Adapter **menolak** hostname di luar root yang
dikonfigurasi, jadi memilih root yang salah bukan lubang keamanan — hanya
migrasi hostname yang menyakitkan nanti. Putuskan sebelum tenant pertama.

Aturan untuk siapa pun yang menjalankan environment kedua: environment itu
sebaiknya **tidak** memakai provider `cloudflare` (biarkan `manual`). Dua
environment yang menulis ke zona yang sama akan saling menimpa record serving
milik hostname yang sama — kegagalan yang tidak berbunyi sampai record produksi
menunjuk ke tempat yang salah.

## Cache tepi (ADR-0042) — mode `auto` di produksi

Produksi memakai **`EDGE_CACHE_MODE=auto`**, bukan `on`: inilah perilaku
"diaktifkan otomatis apabila diperlukan" yang diminta sejak awal. Saat origin
santai, tidak ada yang di-cache dan pengunjung selalu dapat data segar; saat
beban naik, TTL merambat naik dan database berhenti ditanyai pertanyaan publik
yang sama berulang-ulang.

Ambang: **≥5 permintaan/detik** dihitung atas jendela 60 detik (jadi ≥300
observasi di jendela) **ATAU** rata-rata latensi origin ≥250 ms. Salah satu
cukup. Sekali menyala, latch bertahan 3× jendela.

Topologi:

```
Cloudflare (proxied) -> Traefik :443 -> varnish:80 -> app :4321
```

Lapisan Varnish itu terbukti mahal untuk dilewati: menyalakannya lebih dulu di
sebuah environment pra-produksi (Juli 2026) membongkar tiga bug yang lolos
review dan `bun run check`, satu di antaranya mematikan jalur tulis blog. Lihat
[`edge-cache-architecture.md`](edge-cache-architecture.md) §Pelajaran. Repo ini
tidak lagi punya environment seperti itu — yang menggantikannya adalah gerbang
CI dan backup terverifikasi (§Satu environment); siapa pun yang menjalankan
environment kedua sebaiknya tetap membuktikan lapisan ini di sana lebih dulu.

### Kompresi respons DIWARISI dari topologi ini, bukan dimiliki repo

<!-- kompresi-tepi:mulai -->

**Tier pengompresi adalah Cloudflare** — lapisan paling kiri pada topologi di
atas, dan satu-satunya yang mengompresi apa pun. Repo ini tidak mengompresi di
lapisan mana pun yang ia kirim: nol middleware kompresi di aplikasi
(`src/middleware.ts`, `astro.config.mjs`), nol `beresp.do_gzip` di
`infra/varnish/default.vcl` (Varnish tidak mengompresi atas inisiatif
sendiri), nol middleware `compress` Traefik yang dideklarasikan repo. Yang
memancar dari sini hanyalah `Vary: Accept-Encoding` pada respons yang bisa
di-cache — sebuah janji tentang caching, bukan tindakan mengompresi.

Dibuktikan probe 4 Agustus 2026: **kedua** hostname `ahlikoding.com` yang
menjawab saat itu mengirim `content-encoding: gzip`, karena keduanya proxied
Cloudflare. Jadi klaim "tidak ada kompresi di mana pun" salah untuk apa yang
pembaca terima, dan benar untuk apa yang repo ini miliki.

**Konsekuensi yang harus dibaca sebelum go-live:** sebuah deployment basis ini
yang TIDAK di belakang CDN pengompresi menyajikan seluruh HTML, JSON,
`sitemap.xml`, dan `feed.xml` tanpa kompresi — aset teks `dist/client` saja
menyusut 2,79× oleh gzip, dan HTML/JSON menyusut lebih baik lagi. Verifikasi
`content-encoding` di tepi environment yang sebenarnya, bukan di Varnish.

Blok ini dibaca `bun run security:readiness` (pemeriksa
`checkResponseCompressionOwnership` di `scripts/security-readiness.ts`, celah
C3 [`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md) §9):
menghapusnya memerahkan pemeriksa itu, dan menyalakan kompresi di lapisan yang
repo ini kirim membuat pemeriksa itu menuntut blok ini ditulis ulang.

<!-- kompresi-tepi:selesai -->

### Varnish bukan resource Coolify

Ia container compose biasa di network `coolify`, memegang label Traefik sendiri;
FQDN app dikosongkan atau dikalahkan prioritas (lihat di bawah) supaya Traefik
tidak merutekan dua router ke host yang sama. `default.vcl` disalin apa adanya
dari `infra/varnish/default.vcl` (checksum dicocokkan) supaya berkas yang
di-review adalah berkas yang berjalan. Backend `app` disuplai `extra_hosts` —
bukan DNS compose — karena app adalah application Coolify, bukan service
compose.

Env aplikasi:

```bash
EDGE_CACHE_MODE=auto        # `on` hanya untuk membuktikan lapisannya;
                            # `auto` meng-cache saat origin tertekan
EDGE_CACHE_PURGE_ENDPOINT=http://<container-varnish>:80
EDGE_CACHE_PURGE_TOKEN=<secret per environment>
EDGE_CACHE_MAX_TTL_SECONDS=300
```

Token purge **berbeda per environment**. Worker purge berjalan tiap menit dari
cron host sebagai container one-shot — `Dockerfile.production` tidak mengirim
`scripts/`, jadi ia tidak bisa dijalankan lewat `docker exec` pada container app
(masalah dan pola yang sama dengan migrasi di bawah):

```
* * * * * /home/admin1/awcms-prod-varnish/purge-runner.sh
```

> **Per 11 Agustus 2026 container Varnish yang berada di depan
> `awcms.ahlikoding.com` adalah `awcms-staging-varnish`**, bukan milik produksi —
> lihat §Keadaan yang dikoreksi. Container itu termasuk yang dibongkar; cron dan
> endpoint purge di atas adalah bentuk yang ditegakkan kembali bersama
> produksinya.

### Routing: prioritas Traefik, BUKAN mengosongkan FQDN

Mengosongkan FQDN app memindahkan domain, tetapi itu berarti **redeploy**, dan
selama redeploy backend Varnish hilang. Produksi karena itu memberi router
Varnish `priority=100` (default Traefik = panjang rule):

```
traefik.http.routers.awcms-prod-varnish-https.priority=100
```

Router app tetap ada dengan rule `Host(...)` yang identik. Prioritas membuat
cache **deterministik** — tanpanya kedua router seri dan pilihan Traefik
sembarang, sehingga sebagian trafik diam-diam melewati cache — sekaligus
menyisakan router app sebagai **fallback**. Itu terbukti berguna: selama
container Varnish dibuat ulang, permintaan publik tetap dilayani app langsung,
nol downtime.

### Uji penerimaan — `X-Cache`, bukan exit code

Setiap bug di lapisan ini melapor sukses sambil tidak bekerja. Yang sah hanya:

| langkah                           | harus             |
| --------------------------------- | ----------------- |
| dua kali GET `/blog/<tenant>`     | `X-Cache: HIT`    |
| GET `/api/v1/health` dua kali     | tetap `MISS`      |
| purge key **near-miss** `t:<id>x` | tetap `HIT`       |
| purge key **tepat** `t:<id>`      | `MISS`            |
| permintaan berikutnya             | `HIT` lagi        |
| baris antrean                     | `done attempts=1` |

> **Peringatan — tabel di atas mengukur Varnish, dan Varnish BUKAN tier yang
> menjawab pembaca.** Host `ahlikoding.com` proxied Cloudflare, jadi tier
> penjawab pembaca adalah **Cloudflare** — dibuktikan probe 4 Agustus 2026
> (`cf-cache-status: HIT` plus header `age:`). Baca `cf-cache-status`/`age`
> juga, bukan hanya `X-Cache`; dan `MISS` pasca-purge di Varnish **tidak
> membuktikan pembaca melihat konten segar**, karena antrean purge ADR-0042
> mem-BAN Varnish dan **tidak menjangkau Cloudflare** — celah C14 di
> [`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md) §9.
> Kebasian yang pembaca lihat berbatas `s-maxage` ≤
> `EDGE_CACHE_MAX_TTL_SECONDS` (300 detik pada konfigurasi ini).

Bukti mode `auto` dari produksi 2026-07-26 — diukur, bukan diasumsikan:

| langkah                    | hasil                                            |
| -------------------------- | ------------------------------------------------ |
| saat santai                | `x-edge-cache-skip: auto_not_engaged`, tanpa TTL |
| 120 permintaan (2 req/s)   | masih `auto_not_engaged` — di bawah ambang       |
| 400 permintaan (>5 req/s)  | `surrogate-control: max-age=5` — ramp menyala    |
| lewat Varnish              | `X-Cache: HIT`                                   |
| purge lewat antrean+worker | `sent=1 failed=0` → `MISS` → baris `done`        |

`max-age=5` itu `MIN_ACTIVATED_TTL_SECONDS`: rasio tekanan baru menyentuh 1,
jadi TTL-nya paling pendek dan akan naik bila beban berlanjut.

## Operasi database di host

### Menjalankan migrasi: container one-shot, bukan `docker exec`

`Dockerfile.production` menghasilkan image **runtime saja**: `scripts/` tidak
ikut, jadi `docker exec <app> bun run db:migrate` gagal dengan
`Module not found "scripts/db-migrate.ts"`. Ini bukan kesalahan konfigurasi;
itu memang bentuk image-nya, dan tidak perlu diubah.

Jalankan migrasi sebagai **container one-shot** dari checkout repo, berbagi
network container DB supaya DSN-nya `127.0.0.1`.

Checkout-nya **wajib tag rilis yang sedang di-deploy**, **bukan `main`**. `main`
bisa sudah memuat `sql/NNN` yang belum ada di image yang akan berjalan;
menerapkannya berarti skema mendahului aplikasi — dan migrasi terapan itu
immutable, jadi tidak ada jalan mundur selain restore backup. Tag yang sama
dengan image = skema yang persis dibutuhkan image itu.

**Tag git dan tag image tidak identik.** `release.yml` menghitung tag image
dengan membuang `v` di depan (`VERSION="${GITHUB_REF_NAME#v}"`), jadi image
`ghcr.io/ahliweb/awcms:7.0.1` berasal dari tag git `v7.0.1`. Mencocokkannya
terbalik memberi `manifest unknown` (kalau beruntung) atau checkout versi yang
salah (kalau tidak).

```bash
git clone --depth 1 --branch v7.0.1 https://github.com/ahliweb/awcms.git /tmp/awcms-migrate
docker run --rm --network container:<container-db> \
  -v /tmp/awcms-migrate:/app -w /app \
  -e DATABASE_URL="postgres://<owner>:<pw>@127.0.0.1:5432/<db>" \
  oven/bun:1.3.14-alpine \
  sh -c "bun install --frozen-lockfile --production && bun run db:migrate"
```

Nama/ID container DB berubah setiap kali Coolify men-deploy ulang — ambil dari
`docker ps`, jangan dari catatan lama. Migrasi memakai user **owner** (superuser
yang dibuat Coolify) karena ia `CREATE ROLE`/`GRANT`. Runtime app **tidak boleh**
memakai user itu — lihat di bawah.

### Jebakan: user yang dibuat Coolify adalah superuser

Ini menggigit pada 2026-07-25 dan layak diingat karena kegagalannya tidak
terlihat sama sekali.

Coolify (dan image `postgres:*` pada umumnya) membuat `POSTGRES_USER` sebagai
**superuser**. Bentuk paling wajar setelah provisioning otomatis adalah
`DATABASE_URL` runtime menunjuk user itu — dan **superuser melewati RLS tanpa
syarat, bahkan dengan `FORCE`**. Deployment tampak sehat: migrasi hijau, health
200, semua endpoint jalan. Isolasi tenant tidak ada sama sekali.

`sql/019` dan `sql/022` membuat `awcms_app`/`awcms_worker`/`awcms_setup`
**`NOLOGIN` dan tanpa password** — sengaja, karena password adalah secret dan
secret tidak boleh masuk berkas migrasi. Jadi migrasi selesai bersih tetapi
belum satu pun role bisa dipakai. Langkah pengaktifannya eksplisit, per
deployment:

```sql
ALTER ROLE awcms_app    LOGIN PASSWORD '<secret app>';
ALTER ROLE awcms_worker LOGIN PASSWORD '<secret worker>';
ALTER ROLE awcms_setup  LOGIN PASSWORD '<secret setup>';
GRANT CONNECT ON DATABASE <db> TO awcms_app, awcms_worker, awcms_setup;
```

Lalu arahkan env var runtime:

```bash
DATABASE_URL=postgres://awcms_app:<secret app>@<host>:5432/<db>
WORKER_DATABASE_URL=postgres://awcms_worker:<secret worker>@<host>:5432/<db>
SETUP_DATABASE_URL=postgres://awcms_setup:<secret setup>@<host>:5432/<db>
```

Ketiganya wajib, bukan dua: tanpa `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL`
setiap job jatuh kembali ke `DATABASE_URL` = `awcms_app`, dan pemisahan
least-privilege yang baru saja dibuat menjadi dekorasi. Worker purge cache tepi,
misalnya, berjalan sebagai `awcms_worker` — `SELECT`/`UPDATE`/`DELETE` saja atas
antrean.

Verifikasi dengan kueri, bukan asumsi — ketiganya harus `f`/`f`:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname LIKE 'awcms%';
```

`ADMIN_DATABASE_URL` **tidak dibaca kode mana pun** — jangan menyetelnya; ia
hanya menyesatkan pembaca env berikutnya.

### Buktikan isolasinya, jangan diasumsikan

Konfigurasi yang benar belum tentu isolasi yang bekerja. Kueri di bawah
dijalankan **sebagai `awcms_app`** setelah tenant pertama ada, dan itulah bentuk
bukti yang diterima — sebelum repointing, kueri yang sama berjalan sebagai
superuser dan **lulus tanpa membuktikan apa pun**:

```sql
                                                    -- hasil yang diterima
SELECT count(*) FROM awcms_offices;                 -- 0  (fail-closed)
SELECT set_config('app.current_tenant_id','<tenant nyata>',false);
SELECT count(*) FROM awcms_offices;                 -- 1
SELECT set_config('app.current_tenant_id','<uuid asing>',false);
SELECT count(*) FROM awcms_offices;                 -- 0
```

Tanpa tenant context hasilnya **0**, bukan "semua baris" — itu perbedaan antara
policy yang menyaring dan policy yang inert.

## Status nyata (11 Agustus 2026)

| Hal                            | Status                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| App Coolify produksi           | ❌ baris `got4etcblum9kowdv4mrixqo` **tidak ada** di `applications` — bukan soft-delete                                |
| Database produksi              | ❌ tidak ada di `standalone_postgresqls`; satu-satunya yang ada `awcms_staging` (sedang dibongkar)                     |
| `https://awcms.ahlikoding.com` | ⚠️ menjawab **200** — tetapi dilayani `awcms-staging-varnish` (rule Traefik dua host) di atas database `awcms_staging` |
| Development lokal              | ✅ paritas dev↔prod ditegakkan sejak 2026-07-26 (§Development lokal); angkanya diukur ulang, bukan dikutip             |
| Halaman akar `/`               | ✅ halaman landing informasional (ADR-0083); catch-all `[...path].ts` tetap 404 bersih untuk path tak dikenal          |

Pengukuran berikut berasal dari topologi dua-environment yang **sudah tidak
ada** dan dipertahankan sebagai bukti historis, bukan status: mode `auto`
terbukti di produksi 2026-07-26 (§Uji penerimaan), role least-privilege
`rolsuper=f`/`rolbypassrls=f` terbukti 2026-07-25 (§Jebakan superuser), dan
isolasi RLS `0/1/0` terbukti di bawah `awcms_app` pada tanggal yang sama.

## Yang masih terbuka

- **Tegakkan kembali app + database produksi**, lalu **bongkar app, database,
  dan Varnish bernama `awcms-staging-*`** beserta rule Traefik dua-host yang
  dipasangnya (pekerjaan infrastruktur, di luar repo ini). Sampai keduanya
  selesai, `awcms.ahlikoding.com` melayani database `awcms_staging` — bukan
  data produksi.
- Setelah database produksi baru berdiri: jalankan `bun run config:validate` +
  `bun run security:readiness`, buktikan `0/1/0` sebagai `awcms_app`, dan jalankan
  `bun run identity-access:permissions:backfill` (dry-run dulu) — tenant baru
  tidak mewarisi apa pun dari database yang hilang.
- Karena tidak ada lagi latihan pra-produksi, **backup yang sudah diverifikasi
  bisa di-restore** (`deploy/backup/restore-postgres.sh`, mode verify-only)
  adalah prasyarat tiap migrasi, bukan kebiasaan baik.
- `awcms-micro-staging` sudah **dihapus** (app + DB) pada 2026-07-25; DNS-nya
  memang tidak pernah ada.
