# Environment awcms — domain, konfigurasi, dan isolasi

> Dokumen **current-state**: dua environment resmi `awcms` beserta domainnya.
> Untuk mekanisme deploy-nya lihat [`deploy-coolify.md`](deploy-coolify.md) dan
> [`deployment-profiles.md`](deployment-profiles.md).

## Dua environment

| Environment    | Domain                         | `APP_ENV`     | Catatan                                    |
| -------------- | ------------------------------ | ------------- | ------------------------------------------ |
| **Production** | `awcms.ahlikoding.com`         | `production`  | Data nyata. Semua integrasi keluar AKTIF.  |
| **Staging**    | `awcms-staging.ahlikoding.com` | `staging`     | Data buangan. Integrasi keluar MATI total. |
| Development    | `http://localhost:4321`        | `development` | Lokal, tidak di-deploy.                    |

Dua yang di-deploy berjalan di host Docker yang sama dengan produksi lain
(`192.42.84.46`), dikelola Coolify, di belakang Traefik yang memegang `:80`/`:443`
dan menerbitkan TLS lewat resolver `letsencrypt`. **Satu app Coolify per
environment** — bukan satu app dengan dua domain: environment berbagi app berarti
berbagi env var, dan itulah cara staging tanpa sengaja menulis ke data produksi.

## Tenant default & akun owner — sama di tiga fase

Ketiga fase memakai konvensi yang sama, dan perbedaannya justru yang penting:

| Hal                       | Development               | Staging                   | Production                |
| ------------------------- | ------------------------- | ------------------------- | ------------------------- |
| `tenant_code`             | `development`             | `staging`                 | `ahliweb`                 |
| `PUBLIC_DEFAULT_TENANT_*` | pin ke tenant lokal       | pin ke tenant `staging`   | pin ke tenant `ahliweb`   |
| Login owner               | `admin@ahlikoding.com`    | `admin@ahlikoding.com`    | `admin@ahlikoding.com`    |
| Password owner            | **sendiri**               | **sendiri**               | **sendiri**               |
| Role                      | `owner` (system, 197/197) | `owner` (system, 197/197) | `owner` (system, 197/197) |

**Identifier-nya sama, password-nya TIDAK PERNAH sama.** `awcms_identities` unik
pada `(tenant_id, login_identifier)`, jadi satu alamat di tiga environment adalah
**tiga akun terpisah** dengan tiga hash password berbeda. Sesi juga tidak
menyeberang: token sesi adalah nilai acak buram yang disimpan sebagai hash
sha256 di `awcms_sessions` — tabel yang tenant-scoped — sehingga token hanya
berlaku pada database yang menerbitkannya. Menyalin password antar fase
membatalkan isolasi yang justru jadi alasan memisahkan environment, dan itu
satu-satunya hal yang bisa membatalkannya, karena tidak ada lagi yang dibagi.

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

`PUBLIC_TENANT_RESOLUTION_MODE` **tidak** di-set di mana pun. Produksi punya baris
`awcms_tenant_domains` untuk `awcms.ahlikoding.com`, jadi `host_default` akan
bekerja — tetapi itu keputusan perilaku tersendiri (mengaktifkan lookup host dan
memperluas permukaan yang tersentuh), bukan bagian dari "tetapkan tenant
default". Nyalakan terpisah bila memang diinginkan.

### Jebakan: seed permission tidak menjangkau tenant lama

Migrasi seed permission hanya berlaku untuk tenant yang dibuat **setelahnya**.
Mendaratkan modul baru **tidak** memberi permission-nya ke owner yang sudah ada —
gejalanya 403 `ACCESS_DENIED` pada modul yang "sudah terpasang". Terjadi nyata di
produksi 2026-07-26: owner kehilangan 18 permission (`comments`, `site_search`,
`form_drafts`) setelah migrasi 062–070. Backfill adalah langkah deployment:

```sql
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM awcms_roles r CROSS JOIN awcms_permissions p
LEFT JOIN awcms_role_permissions rp
  ON rp.role_id = r.id AND rp.permission_id = p.id
WHERE r.role_code = 'owner' AND r.deleted_at IS NULL
  AND rp.permission_id IS NULL;
```

Verifikasi bahwa "akses penuh" memang penuh — RBAC 197/197 belum cukup bila ada
ABAC deny, aturan SoD, atau batasan business-scope:

```sql
SELECT count(*) FROM awcms_abac_policies WHERE is_active AND is_dsl_managed;
SELECT count(*) FROM awcms_business_scope_assignments;
```

Ketiganya `0` di development, staging, dan produksi per 2026-07-26, dan tidak ada
rute base yang menyetel `requiredScopeType`, jadi RBAC benar-benar penentu
tunggalnya.

## Development lokal disamakan dengan produksi (2026-07-26)

Sebelum ini dev bukan versi kecil produksi, melainkan **environment yang
berbeda secara diam-diam**: skema berhenti di migrasi 30 (produksi 70), nol
tenant, tidak ada `.env`, dan satu-satunya role dengan LOGIN adalah `awcms`
milik container — seorang **superuser**. Bug kelas paling mahal — kebocoran
RLS dan 403 karena permission — justru yang paling mustahil direproduksi di
sana, karena superuser menembus RLS dan tenant kosong tak punya permission
untuk salah.

Sekarang keduanya cocok baris per baris:

|                      | Development     | Staging         | Production      |
| -------------------- | --------------- | --------------- | --------------- |
| migrasi              | 70              | 70              | 70              |
| tabel                | 118             | 118             | 118             |
| `awcms_permissions`  | 197             | 197             | 197             |
| RLS `ENABLE`+`FORCE` | 109/118         | 109/118         | 109/118         |
| runtime role         | `awcms_app`     | `awcms_app`     | `awcms_app`     |
| owner                | `owner` 197/197 | `owner` 197/197 | `owner` 197/197 |

Yang tetap **sengaja** berbeda, dan alasannya:

| Var                     | Dev     | Prod   | Kenapa                                                                                                                                  |
| ----------------------- | ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_COOKIE_SECURE`    | `false` | `true` | dev jalan di `http://`; cookie `Secure` tidak akan pernah terkirim                                                                      |
| `TRUSTED_PROXY_ENABLED` | `false` | `true` | tidak ada proxy di depan `bun dev`; kalau `true`, siapa pun bisa memalsukan `X-Forwarded-For` dan memilih bucket rate-limit-nya sendiri |
| `EDGE_CACHE_MODE`       | `off`   | `auto` | tidak ada Varnish lokal; `auto` hanya akan mengantre purge yang tak pernah dikonsumsi                                                   |

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
tenant asing (prod id) -> awcms_identities terlihat: 0
```

Pola `0 / 1 / 0` yang sama dipakai untuk staging dan produksi. Kalau baris
pertama bukan `0`, RLS tidak menyala dan semua sisanya tidak ada artinya.

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
# production
APP_ENV=production
APP_URL=https://awcms.ahlikoding.com

# staging
APP_ENV=staging
APP_URL=https://awcms-staging.ahlikoding.com
```

Daftarkan **kedua** redirect URI di IdP sebelum staging dipakai login.

## Isolasi staging — bukan opsional

Staging berjalan di host yang sama dengan produksi. Yang memisahkannya hanya
konfigurasi, jadi konfigurasi itu harus tegas. Pola ini sudah terbukti di
staging `awcms-micro` (lihat `work-continuation-log.md` repo itu):

- **Database sendiri**, role `awcms_app` sendiri, password sendiri. Bukan skema
  lain di cluster produksi.
- **Secret sendiri** — JWT, `AUTH_IP_HASH_SECRET`, `COMMENTS_TIMING_SECRET`,
  kunci enkripsi. Menyalin secret produksi ke staging berarti token staging
  berlaku di produksi.
- **Integrasi keluar MATI**: `R2_ENABLED=false`, `EMAIL_ENABLED=false`, sync
  nonaktif. Staging tidak boleh bisa menulis ke bucket media produksi atau
  mengirim email ke alamat orang sungguhan.
- `NEWS_PORTAL_PROFILE` **dihapus** (bukan diisi nilai lain) ketika staging tanpa
  R2 — nilai yang diterima hanya `full_online_r2`, jadi `config:validate` akan
  menolak sebelum deploy. Ini kesalahan nyata yang tertangkap di micro.

Jalankan `bun run config:validate` dan `bun run security:readiness` **sebelum**
deploy pertama tiap environment.

## DNS

Zona `ahlikoding.com` ada di Cloudflare (NS `dilbert`/`katja`). Kedua host di
atas menunjuk ke `192.42.84.46`.

Setelah record ada, TLS terbit otomatis lewat Traefik — tidak ada konfigurasi
lain. Sejak 2026-07-25 resolver `letsencrypt` di Traefik pakai **tantangan
DNS-01 via Cloudflare** (bukan HTTP-01 lagi), jadi status proxy record
(DNS-only vs proxied/orange cloud) **tidak memengaruhi** penerbitan/renewal
sertifikat — keduanya jalan sama saja. Detail perubahan dan alasannya ada di
`docs/12-cloudflare-proxy-dns01.md` pada repo `serv-dinkesdocker`.

### Subdomain tenant (asumsi — konfirmasi sebelum dipakai)

`bun run tenant-domain:dns:sync` (ADR-0042 / PR #236) mengubah baris
`awcms_tenant_domains` menjadi record DNS nyata, tetapi butuh **root domain**
yang belum ditetapkan pemilik repo. Yang paling koheren dengan dua domain di atas:

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

Staging sebaiknya **tidak** memakai provider `cloudflare` (biarkan `manual`):
dua environment yang menulis ke zona yang sama akan saling menimpa record
serving milik hostname yang sama.

## Cache tepi (ADR-0042) — AKTIF di staging

Staging adalah tempat yang benar untuk membuktikan lapisan Varnish sebelum
produksi, dan pembuktian itu terbayar: mengaktifkannya membongkar tiga bug yang
lolos review dan `bun run check`, satu di antaranya mematikan jalur tulis blog.
Lihat [`edge-cache-architecture.md`](edge-cache-architecture.md) §Pelajaran.

Topologi staging sejak 2026-07-26:

```
Cloudflare (proxied) -> Traefik :443 -> varnish:80 -> app 10.0.1.61:4321
```

Varnish **bukan** resource Coolify. Ia container compose biasa
(`/home/admin1/awcms-varnish/`) di network `coolify`, memegang label Traefik
untuk `awcms-staging.ahlikoding.com`; FQDN app dikosongkan supaya Traefik tidak
merutekan dua router ke host yang sama. `default.vcl` disalin apa adanya dari
`infra/varnish/default.vcl` (checksum dicocokkan) supaya berkas yang di-review
adalah berkas yang berjalan. Backend `app` disuplai `extra_hosts` — bukan DNS
compose — karena app adalah application Coolify, bukan service compose.

Env aplikasi:

```bash
EDGE_CACHE_MODE=on          # `auto` hanya meng-cache saat origin tertekan;
                            # `on` untuk membuktikan lapisannya
EDGE_CACHE_PURGE_ENDPOINT=http://awcms-staging-varnish:80
EDGE_CACHE_PURGE_TOKEN=<secret per environment>
EDGE_CACHE_MAX_TTL_SECONDS=300
```

Token purge **berbeda per environment**. Worker purge berjalan tiap menit dari
cron host sebagai container one-shot — `Dockerfile.production` tidak mengirim
`scripts/`, jadi ia tidak bisa dijalankan lewat `docker exec` pada container app
(masalah dan pola yang sama dengan migrasi di atas):

```
* * * * * /home/admin1/awcms-varnish/purge-runner.sh
```

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

## Cache tepi di produksi — mode `auto`

Produksi memakai **`EDGE_CACHE_MODE=auto`**, bukan `on`: inilah perilaku
"diaktifkan otomatis apabila diperlukan" yang diminta sejak awal. Saat origin
santai, tidak ada yang di-cache dan pengunjung selalu dapat data segar; saat
beban naik, TTL merambat naik dan database berhenti ditanyai pertanyaan publik
yang sama berulang-ulang.

Ambang: **≥5 permintaan/detik** dihitung atas jendela 60 detik (jadi ≥300
observasi di jendela) **ATAU** rata-rata latensi origin ≥250 ms. Salah satu
cukup. Sekali menyala, latch bertahan 3× jendela.

Dibuktikan di produksi 2026-07-26 — bukan diasumsikan:

| langkah                    | hasil                                            |
| -------------------------- | ------------------------------------------------ |
| saat santai                | `x-edge-cache-skip: auto_not_engaged`, tanpa TTL |
| 120 permintaan (2 req/s)   | masih `auto_not_engaged` — di bawah ambang       |
| 400 permintaan (>5 req/s)  | `surrogate-control: max-age=5` — ramp menyala    |
| lewat Varnish              | `X-Cache: HIT`                                   |
| purge lewat antrean+worker | `sent=1 failed=0` → `MISS` → baris `done`        |

`max-age=5` itu `MIN_ACTIVATED_TTL_SECONDS`: rasio tekanan baru menyentuh 1,
jadi TTL-nya paling pendek dan akan naik bila beban berlanjut.

### Routing: prioritas Traefik, BUKAN mengosongkan FQDN

Staging memindahkan domain dengan mengosongkan FQDN app. Produksi **tidak boleh**
— itu berarti redeploy, dan selama redeploy backend Varnish hilang. Jadi router
Varnish diberi `priority=100` (default Traefik = panjang rule):

```
traefik.http.routers.awcms-prod-varnish-https.priority=100
```

Router app tetap ada dengan rule `Host(...)` yang identik. Prioritas membuat
cache **deterministik** — tanpanya kedua router seri dan pilihan Traefik
sembarang, sehingga sebagian trafik diam-diam melewati cache — sekaligus
menyisakan router app sebagai **fallback**. Itu terbukti berguna: selama
container Varnish dibuat ulang, permintaan publik tetap dilayani app langsung,
nol downtime.

### Role least-privilege di produksi

`awcms_worker` dan `awcms_setup` di produksi dulu `NOLOGIN` (jadi job apa pun
jatuh ke `DATABASE_URL` = `awcms_app`). Keduanya kini punya LOGIN + password
sendiri dan `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` menunjuk ke sana. Worker
purge berjalan sebagai `awcms_worker` — SELECT/UPDATE/DELETE saja atas antrean.

Cron produksi:

```
* * * * * /home/admin1/awcms-prod-varnish/purge-runner.sh
```

## Status nyata (2026-07-26)

| Hal                                | Status                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| Development lokal                  | ✅ migrasi 70, tenant `development`, owner 197/197, RLS `0/1/0`     |
| DNS `awcms.ahlikoding.com`         | ✅ A → `192.42.84.46`, **proxied (orange cloud)** sejak 2026-07-25  |
| DNS `awcms-staging.ahlikoding.com` | ✅ A → `192.42.84.46`, **proxied (orange cloud)** sejak 2026-07-25  |
| App Coolify produksi               | ✅ `got4etcblum9kowdv4mrixqo` + DB `eel59mczdlkidkm5a6fhbdeh`       |
| App Coolify staging                | ✅ `n3gg3qudm91kqdy62znmyxuq` + DB `my85c1xd4txesedhic72maeu`       |
| TLS staging                        | ✅ terbit otomatis (Traefik/letsencrypt) beberapa menit setelah DNS |
| Health staging                     | ✅ `GET /api/v1/health` → 200, 21 modul                             |
| Migrasi DB staging                 | ✅ `sql/001`–`sql/072`, 72 applied — sama dengan produksi & dev     |
| Role least-privilege staging       | ✅ app/worker/setup terpisah, `rolsuper=f`, `rolbypassrls=f`        |
| Seed tenant pertama staging        | ✅ tenant `staging` + owner; `setup/status` → `locked:true`         |
| Isolasi RLS staging                | ✅ dibuktikan di bawah `awcms_app` (lihat di bawah)                 |

Staging memakai `--ip 10.0.1.61` (produksi `10.0.1.51`); Coolify tidak bisa
mem-publish port, jadi alamat container ditetapkan lewat
`custom_docker_run_options`.

### Menjalankan migrasi: container one-shot, bukan `docker exec`

`Dockerfile.production` menghasilkan image **runtime saja**: `scripts/` tidak
ikut, jadi `docker exec <app> bun run db:migrate` gagal dengan
`Module not found "scripts/db-migrate.ts"`. Ini bukan kesalahan konfigurasi;
itu memang bentuk image-nya, dan tidak perlu diubah.

Jalankan migrasi sebagai **container one-shot** dari checkout repo, berbagi
network container DB supaya DSN-nya `127.0.0.1` (pola yang sama dipakai staging
`awcms-micro`):

```bash
git clone --depth 1 --branch main https://github.com/ahliweb/awcms.git /tmp/awcms-migrate
docker run --rm --network container:my85c1xd4txesedhic72maeu \
  -v /tmp/awcms-migrate:/app -w /app \
  -e DATABASE_URL="postgres://awcms_staging:<pw>@127.0.0.1:5432/awcms_staging" \
  oven/bun:1.3.14-alpine \
  sh -c "bun install --frozen-lockfile --production && bun run db:migrate"
```

Migrasi memakai user **owner** (di sini superuser `awcms_staging`) karena ia
`CREATE ROLE`/`GRANT`. Runtime app **tidak boleh** memakai user itu — lihat di
bawah.

### Jebakan: user yang dibuat Coolify adalah superuser

Ini menggigit staging pada 2026-07-25 dan layak diingat karena kegagalannya
tidak terlihat sama sekali.

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

Verifikasi dengan kueri, bukan asumsi — ketiganya harus `f`/`f`:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname LIKE 'awcms%';
```

`ADMIN_DATABASE_URL` **tidak dibaca kode mana pun** — jangan menyetelnya; ia
hanya menyesatkan pembaca env berikutnya.

### Buktikan isolasinya, jangan diasumsikan

Konfigurasi yang benar belum tentu isolasi yang bekerja. Kueri di bawah
dijalankan pada staging **sebagai `awcms_app`** setelah tenant pertama ada, dan
itulah bentuk bukti yang diterima — sebelum repointing, kueri yang sama berjalan
sebagai superuser dan **lulus tanpa membuktikan apa pun**:

```sql
                                                    -- hasil di staging
SELECT count(*) FROM awcms_offices;                 -- 0  (fail-closed)
SELECT set_config('app.current_tenant_id','<tenant nyata>',false);
SELECT count(*) FROM awcms_offices;                 -- 1
SELECT set_config('app.current_tenant_id','<uuid asing>',false);
SELECT count(*) FROM awcms_offices;                 -- 0
```

Tanpa tenant context hasilnya **0**, bukan "semua baris" — itu perbedaan antara
policy yang menyaring dan policy yang inert.

## Yang masih terbuka

- ~~Varnish belum dipasang di depan produksi.~~ **SUDAH**, 2026-07-26, mode
  `auto` (lihat di bawah).
- `awcms-micro-staging` sudah **dihapus** (app + DB) pada 2026-07-25; DNS-nya
  memang tidak pernah ada.
