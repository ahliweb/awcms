# Redis Readiness — Kapabilitas Opsional Native Bun

> Status: implementasi draft Issue #197. Redis **tidak aktif secara default** dan
> tidak mengubah PostgreSQL sebagai sumber kebenaran AWCMS.

## 1. Tujuan

AWCMS menyiapkan lapisan Redis opsional untuk aplikasi turunan yang membutuhkan
cache baca terbatas atau koordinasi sementara ketika mulai berjalan pada lebih
dari satu instance. Implementasi memakai [`RedisClient` native Bun](https://bun.sh/docs/runtime/redis),
sehingga tidak menambah package runtime `redis`, `ioredis`, atau adapter Node.js.

Bun menyediakan client Redis Promise-based dengan connection management,
auto-pipelining, TLS, reconnect, raw command, dan health/status connection.
Client native Bun memerlukan Redis server 7.2 atau lebih baru. Redis Sentinel dan
Redis Cluster belum didukung oleh client native ini dan tidak termasuk scope
fondasi awal.

## 2. Keputusan arsitektur

```mermaid
flowchart LR
  REQ[Request atau worker] --> APP[AWCMS Bun + Astro]
  APP -->|authoritative read/write| PG[(PostgreSQL + RLS)]
  APP -. cache-aside / ephemeral coordination .-> REDIS[(Redis opsional)]
  PG --> OUTBOX[Durable outbox]
  OUTBOX --> PROVIDER[Provider eksternal]

  REDIS -. unavailable .-> MISS[Cache miss / write skip]
  MISS --> PG
```

Prinsip wajib:

1. **Default disabled.** `REDIS_ENABLED=false` atau tidak diisi berarti AWCMS
   tidak membuat client dan tidak mencoba terhubung ke Redis.
2. **PostgreSQL authoritative.** RLS, audit trail, durable outbox, workflow,
   session authority, idempotency record, dan data ERP/domain tetap di
   PostgreSQL.
3. **Fail-open untuk cache.** Gangguan Redis menjadi cache miss, cache write
   skip, atau invalidation skip; transaksi bisnis tidak ikut gagal.
4. **Tenant-aware key.** Data tenant wajib menggunakan `tenantId` melalui
   `buildRedisKey()`.
5. **TTL wajib.** Helper JSON menggunakan atomic `SET ... EX`; tidak ada cache
   tanpa masa kedaluwarsa.
6. **Tidak di dalam transaksi database.** Redis tidak dipanggil sebagai
   dependency wajib dari callback transaksi PostgreSQL.
7. **Tidak ada port publik.** Redis hanya boleh tersedia melalui jaringan
   internal/privat.
8. **No hidden fallback.** AWCMS tidak memakai singleton `redis` bawaan Bun yang
   dapat otomatis mengarah ke localhost. Client dibuat eksplisit hanya ketika
   `REDIS_ENABLED=true` dan `REDIS_URL` valid.

## 3. Komponen implementasi

| Komponen                              | Fungsi                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `src/lib/redis/config.ts`             | Parsing, validasi, redaksi URL, dan key builder tenant-aware              |
| `src/lib/redis/client.ts`             | Singleton `RedisClient` native Bun, lifecycle, timeout, dan health        |
| `src/lib/redis/cache.ts`              | Helper JSON cache-aside, invalidasi, dan fail-open                        |
| `scripts/redis-health.ts`             | Preflight konfigurasi dan authenticated `PING` tanpa kebocoran credential |
| `config/redis.env.example`            | Contoh env opsional yang terpisah dari profil default                     |
| `deploy/redis/docker-compose.yml`     | Redis standalone hardened tanpa publikasi port                            |
| `tests/unit/redis-foundation.test.ts` | Unit test tanpa Redis/network hidup                                       |

Tidak ada dependency runtime baru dan `bun.lock` tidak perlu berubah.

## 4. Konfigurasi

| Variable                      |   Default | Keterangan                                    |
| ----------------------------- | --------: | --------------------------------------------- |
| `REDIS_ENABLED`               |   `false` | Feature gate; false berarti tidak ada koneksi |
| `REDIS_URL`                   | tidak ada | URL eksplisit; wajib ketika Redis enabled     |
| `REDIS_KEY_PREFIX`            |   `awcms` | Namespace aplikasi dan boundary ACL key       |
| `REDIS_CONNECTION_TIMEOUT_MS` |    `2000` | Batas koneksi awal, 100–30000 ms              |
| `REDIS_COMMAND_TIMEOUT_MS`    |    `1000` | Batas command aplikasi, 50–30000 ms           |
| `REDIS_MAX_RETRIES`           |       `3` | Maksimum reconnect, 0–20                      |
| `REDIS_CACHE_DEFAULT_TTL_SEC` |     `300` | TTL default cache JSON, 1–86400 detik         |

URL yang diterima:

- `redis://`
- `rediss://`
- `redis+tls://`
- `redis+unix://`
- `redis+tls+unix://`

Gunakan `rediss://` atau jaringan internal tepercaya untuk staging/production.
Credential harus berasal dari environment/secret manager, bukan source code,
dokumentasi, module settings, atau commit.

## 5. Health dan preflight

```bash
bun run redis:health
```

Status:

- `disabled`: valid, exit code 0, tidak mencoba koneksi;
- `healthy`: konfigurasi valid dan `PING` menghasilkan `PONG`;
- `unhealthy`: koneksi atau command gagal, exit code 1;
- `invalid_configuration`: enabled tetapi konfigurasi tidak valid, exit code 1.

Username dan password pada URL selalu diredaksi. Payload cache dan secret tidak
pernah dicetak oleh health command.

## 6. Contoh implementasi

### 6.1 Cache laporan agregat

```ts
import { redisCacheAside } from "../../lib/redis/cache";
import { buildRedisKey } from "../../lib/redis/config";

const key = buildRedisKey({
  namespace: "reporting",
  tenantId,
  key: `activity:${range}`
});

const report = await redisCacheAside(
  key,
  () => loadActivityReportFromPostgres(tenantId, range),
  { ttlSec: 60 }
);
```

Cocok untuk dashboard yang mahal dihitung dan boleh stale 30–300 detik.

### 6.2 Cache metadata referensi

```ts
const key = buildRedisKey({
  namespace: "reference-data",
  tenantId,
  key: "active-uom"
});

const items = await redisCacheAside(key, loadActiveUomFromPostgres, {
  ttlSec: 300
});
```

Mutation harus menulis PostgreSQL lebih dahulu, lalu menghapus atau me-refresh
cache setelah commit. TTL tetap menjadi fallback bila invalidasi gagal.

### 6.3 Invalidasi setelah mutation berhasil

```ts
const result = await updateAuthoritativeRecordInPostgres(input);
await deleteRedisCache(
  buildRedisKey({ namespace: "reference-data", tenantId, key: "active-uom" })
);
return result;
```

Gagal menghapus cache tidak boleh mengubah mutation PostgreSQL menjadi gagal.

### 6.4 Akselerasi idempotency

Redis dapat menjadi positive/negative cache jangka pendek untuk mengurangi baca
berulang, tetapi key, status, response replay, dan hasil transaksi authoritative
harus tetap disimpan di PostgreSQL. Implementasi konkret memerlukan issue dan
test race-condition terpisah.

### 6.5 Distributed rate limiting atau lock

Redis native Bun dapat dipakai pada fase berikutnya, tetapi bukan melalui helper
cache generik. Rate limiting harus atomic dan memiliki kebijakan fail-open atau
fail-closed per endpoint. Lock harus memakai ownership token, TTL, atomic release,
dan fencing token untuk dampak tinggi. Constraint PostgreSQL, unique index, row
lock, dan serialisasi transaksi tetap menjadi kontrol utama.

## 7. Penggunaan yang dilarang tanpa desain baru

Redis tidak boleh langsung digunakan sebagai:

- sumber tunggal sesi autentikasi;
- penyimpanan audit log atau security event;
- pengganti PostgreSQL outbox/inbox;
- penyimpanan workflow approval;
- penyimpanan transaksi, ledger, saldo, stok, payroll, atau dokumen posted;
- pengganti RLS, RBAC, atau ABAC;
- queue dengan klaim exactly-once;
- tempat menyimpan password, provider token, NIK, data kesehatan, atau data
  pribadi mentah;
- dependency sinkron wajib di dalam transaksi PostgreSQL.

Perubahan pada area tersebut memerlukan issue tersendiri, threat model, data
classification, RTO/RPO, recovery plan, pengujian kegagalan, dan kontrak API/event
bila relevan.

## 8. Deployment standalone

AWCMS belum memiliki canonical root Compose stack. Karena itu Redis disediakan
sebagai deployment terpisah, bukan overlay yang mengasumsikan service `app` atau
PostgreSQL tertentu.

```bash
cp config/redis.env.example .env.redis
# Ganti REDIS_PASSWORD dengan secret panjang dari secret manager.

docker compose \
  --env-file .env.redis \
  -f deploy/redis/docker-compose.yml \
  up -d
```

Deployment membuat network bernama `awcms-redis-internal` secara default. Aplikasi
AWCMS harus bergabung ke network yang sama dan memakai:

```env
REDIS_ENABLED=true
REDIS_URL=redis://awcms_app:${REDIS_PASSWORD}@redis:6379/0
REDIS_KEY_PREFIX=awcms
```

Untuk nama network lain, set `AWCMS_REDIS_NETWORK`. Pada Coolify, gunakan resource
Redis/Compose dalam internal network yang sama dan simpan seluruh secret pada
Environment Variables/Secrets. Jangan expose port 6379.

Hardening deployment:

- default Redis user dimatikan;
- user `awcms_app` dibatasi ke `${REDIS_KEY_PREFIX}:*`;
- kategori command berbahaya ditolak;
- ACL file hanya berisi hash SHA-256 password;
- AOF `everysec` dan snapshot diaktifkan untuk recovery operasional;
- `protected-mode=yes`;
- authenticated health check;
- resource limit;
- `cap_drop: [ALL]` dan `no-new-privileges`;
- volume data dan konfigurasi terpisah;
- tidak ada `ports:`.

## 9. Konsistensi dan invalidasi

Pola default adalah cache-aside:

1. Bentuk key versioned dan tenant-aware.
2. Baca Redis.
3. Jika miss, baca PostgreSQL melalui tenant context + RLS.
4. Setelah nilai authoritative tersedia, tulis Redis dengan TTL.
5. Mutation menulis PostgreSQL lebih dahulu.
6. Setelah commit berhasil, hapus atau refresh key terkait.
7. Bila invalidasi gagal, TTL membatasi staleness.

Jangan membuat dual-write PostgreSQL + Redis sebagai transaksi semu. Keduanya
tidak memiliki atomic commit bersama. Untuk invalidasi lintas proses, gunakan
event/outbox setelah commit pada issue terpisah.

## 10. Kapasitas, eviction, dan pemisahan purpose

Mulai dari `maxmemory=256mb` dan `noeviction`, lalu ukur. Instance yang dipastikan
cache-only dapat memilih LRU/LFU setelah review. Jangan mencampur cache yang boleh
dievict dengan lock/rate-limit state yang membutuhkan kebijakan berbeda tanpa
analisis kapasitas.

| Purpose              | Persistence                | Eviction                  | Dampak kehilangan data         |
| -------------------- | -------------------------- | ------------------------- | ------------------------------ |
| Cache laporan        | opsional                   | LRU/LFU dapat diterima    | query ulang PostgreSQL         |
| Rate limiting        | biasanya tidak wajib       | hindari eviction prematur | limit sementara kurang akurat  |
| Lock/coordination    | bukan untuk recovery       | `noeviction`              | duplicate work mungkin terjadi |
| Pub/Sub invalidation | tidak persisten            | tidak relevan             | TTL memperbaiki akhirnya       |
| Durable queue        | jangan memakai fondasi ini | `noeviction`              | perlu desain queue terpisah    |

Monitor minimal: latency, `used_memory`, `evicted_keys`, rejected connections,
persistence error, reconnect, buffered amount, dan restart count.

## 11. Security dan compliance mapping

| Kontrol                 | Implementasi praktis                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| ISO/IEC 27001 & 27002   | least privilege ACL, secret management, logging redaction, network isolation          |
| ISO/IEC 27005           | threat model sebelum sesi, lock, queue, atau data sensitif dipindah ke Redis          |
| ISO/IEC 27017/27018     | pemisahan environment, cloud secret, data minimization, tidak menyimpan PII mentah    |
| ISO/IEC 27701 & UU PDP  | purpose limitation, TTL, minimisasi payload, larangan credential/PII pada key         |
| ISO/IEC 20000           | health command, monitoring, configuration record, rollback feature flag               |
| ISO 22301               | Redis bukan single point of failure; layanan inti tetap berjalan tanpa cache          |
| PP PSTE / UU ITE        | pengamanan akses, keandalan layanan, pencatatan dan perlindungan informasi elektronik |
| OWASP ASVS/API Security | default-off, timeout, no error leakage, least privilege, dependency isolation         |

## 12. Testing dan rollback

Unit test tidak membutuhkan Redis hidup:

```bash
bun test tests/unit/redis-foundation.test.ts
bun run typecheck
```

Verifikasi deployment opsional:

```bash
bun run redis:health
```

Rollback tidak membutuhkan migration database:

1. Set `REDIS_ENABLED=false`.
2. Deploy ulang aplikasi.
3. Hentikan resource Redis bila tidak lagi dipakai.
4. Nilai authoritative tetap tersedia di PostgreSQL.
