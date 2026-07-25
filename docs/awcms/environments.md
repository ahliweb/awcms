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
lain. Bila record dipasang **proxied** (orange cloud), Traefik tetap menerbitkan
sertifikat asalkan tantangan HTTP-01 bisa lewat; bila ragu, mulai **DNS-only**
lalu nyalakan proxy setelah TLS terbit.

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

## Cache tepi (ADR-0042)

Staging adalah tempat yang benar untuk membuktikan lapisan Varnish sebelum
produksi:

```bash
EDGE_CACHE_MODE=auto
EDGE_CACHE_PURGE_ENDPOINT=http://varnish:80
EDGE_CACHE_PURGE_TOKEN=<secret per environment>
```

Token purge **berbeda per environment**. Jadwalkan `bun run edge-cache:purge`;
tanpa itu suntingan editor baru terlihat setelah TTL habis. Rinci di
[`edge-cache-architecture.md`](edge-cache-architecture.md).

## Yang belum ada (jangan diklaim)

- **Instance staging `awcms` belum dibuat.** Yang berjalan di host itu adalah
  staging `awcms-micro` (app Coolify `a107y9000uz0t9cmgs18lzcv`, DB
  `d437d850oei6v1s92dq5y3lf`) — instance repo LAIN.
- **Record DNS kedua host belum ada.** Per 2026-07-25 keduanya `NXDOMAIN`.
- Dokumen ini menetapkan **konfigurasi target**; ia tidak membuktikan sesuatu
  sudah berjalan.
