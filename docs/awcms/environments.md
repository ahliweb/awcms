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

Keduanya berjalan di host Docker yang sama dengan produksi lain
(`192.42.84.46`), dikelola Coolify, di belakang Traefik yang memegang `:80`/`:443`
dan menerbitkan TLS lewat resolver `letsencrypt`. **Satu app Coolify per
environment** — bukan satu app dengan dua domain: environment berbagi app berarti
berbagi env var, dan itulah cara staging tanpa sengaja menulis ke data produksi.

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

## Status nyata (2026-07-25)

| Hal                                | Status                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| DNS `awcms.ahlikoding.com`         | ✅ A → `192.42.84.46`, **proxied (orange cloud)** sejak 2026-07-25  |
| DNS `awcms-staging.ahlikoding.com` | ✅ A → `192.42.84.46`, **proxied (orange cloud)** sejak 2026-07-25  |
| App Coolify produksi               | ✅ `got4etcblum9kowdv4mrixqo` + DB `eel59mczdlkidkm5a6fhbdeh`       |
| App Coolify staging                | ✅ `n3gg3qudm91kqdy62znmyxuq` + DB `my85c1xd4txesedhic72maeu`       |
| TLS staging                        | ✅ terbit otomatis (Traefik/letsencrypt) beberapa menit setelah DNS |
| Health staging                     | ✅ `GET /api/v1/health` → 200, 21 modul                             |
| Migrasi DB staging                 | ✅ `sql/001`–`sql/069`, 69 applied / 0 skipped                      |
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

- Varnish **belum** dipasang di depan produksi; `EDGE_CACHE_MODE` di sana masih
  belum di-set (= `off`). Aktifkan hanya setelah `sql/070` diterapkan di
  produksi — tanpa itu, menyalakan cache mematikan publish blog.
- `awcms-micro-staging` sudah **dihapus** (app + DB) pada 2026-07-25; DNS-nya
  memang tidak pernah ada.
