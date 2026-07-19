# Cloudflare Turnstile — bot protection sadar deployment-profile

Referensi implementasi Issue #186 (epic #177). Modul: `identity-access` (jalur login) + `tenant-admin` (setup). ADR: [ADR-0029](../adr/0029-deployment-profile-aware-turnstile-bot-protection.md). **Tanpa migration** — Turnstile murni konfigurasi/env; tak ada tabel/kolom baru dan secret tak pernah menyentuh DB.

Fitur aktif **hanya** saat profil deployment full-online DAN `TURNSTILE_ENABLED=true`. Setiap deployment LAN/offline (default) merender halaman login byte-identik seperti sebelum fitur ini: tak ada widget, tak ada iframe, tak ada origin CSP Cloudflare, tak ada panggilan verifikasi keluar.

Turnstile adalah lapisan **di atas** rate limiting, lockout, audit, dan generic authentication error — bukan pengganti. Rate limit + lockout tetap bekerja independen dari Turnstile.

## 1. Gerbang aktivasi

Satu fungsi memutuskan segalanya: `isTurnstileRequired(env)` (`src/lib/security/turnstile.ts`):

```
isTurnstileRequired = isFullOnlineSecurityActive(env) && TURNSTILE_ENABLED === "true"

isFullOnlineSecurityActive = AUTH_ONLINE_SECURITY_ENABLED === "true"
                          && AUTH_ONLINE_SECURITY_PROFILE === "full_online"
```

| Profil                            | `AUTH_ONLINE_SECURITY_*`    | `TURNSTILE_ENABLED` | Hasil                                  |
| --------------------------------- | --------------------------- | ------------------- | -------------------------------------- |
| LAN/offline (default)             | unset / `false`             | apa pun             | **OFF** — tak ada widget/CSP/outbound  |
| LAN dengan flag Turnstile menyala | `false` / profil `disabled` | `true`              | **OFF total** (gerbang profil menang)  |
| Full-online, Turnstile mati       | `true` + `full_online`      | `false` / unset     | OFF (staging kredensial diperbolehkan) |
| Full-online, Turnstile hidup      | `true` + `full_online`      | `true`              | **AKTIF** — enforcement fail-closed    |

Widget (`login.astro`), origin CSP (`security-headers.ts`), dan enforcement (`login.ts`/`initialize.ts`) semuanya digerbangi fungsi yang sama, sehingga tak mungkin drift (mis. CSP terbuka tapi widget tak dirender).

## 2. Referensi konfigurasi / env

Semua var opsional; LAN/offline default lulus `config:validate` tanpa satu pun diisi. Lihat `.env.example`.

| Var                            | Tipe                           | Default    | Keterangan                                                                                                                      |
| ------------------------------ | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_ONLINE_SECURITY_ENABLED` | bool                           | `false`    | Master gerbang profil full-online.                                                                                              |
| `AUTH_ONLINE_SECURITY_PROFILE` | enum `disabled`\|`full_online` | `disabled` | `full_online` wajib saat gerbang menyala.                                                                                       |
| `TURNSTILE_ENABLED`            | bool                           | `false`    | Flag fitur Turnstile.                                                                                                           |
| `TURNSTILE_SITE_KEY`           | string (**publik**)            | —          | Site key; disematkan di widget. **Bukan** secret. Wajib saat enabled.                                                           |
| `TURNSTILE_SECRET_KEY`         | string (**secret**)            | —          | Secret siteverify server-side. Tak pernah ke klien/log/audit/DB. Wajib saat enabled.                                            |
| `TURNSTILE_EXPECTED_HOSTNAME`  | string                         | —          | Hostname publik tempat widget disajikan; token dari hostname lain ditolak. Wajib saat enabled (fail-closed hostname-confusion). |
| `TURNSTILE_VERIFY_TIMEOUT_MS`  | int > 0                        | `5000`     | Timeout siteverify (span fetch + baca body).                                                                                    |
| `TURNSTILE_MAX_TOKEN_AGE_SEC`  | int > 0                        | `300`      | Jendela freshness `challenge_ts`.                                                                                               |
| `TURNSTILE_MAX_RESPONSE_BYTES` | int > 0                        | `16384`    | Cap ukuran respons siteverify.                                                                                                  |

**Cross-rule preflight** (`bun run config:validate`):

- `AUTH_ONLINE_SECURITY_ENABLED=true` mewajibkan `AUTH_ONLINE_SECURITY_PROFILE=full_online` — ini yang membedakan **misconfigured** dari **disabled intentionally**.
- `TURNSTILE_ENABLED=true` mewajibkan `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, dan `TURNSTILE_EXPECTED_HOSTNAME` non-kosong (independen dari gerbang profil, sehingga kredensial bisa di-stage lebih dulu).

`bun run security:readiness` menambah dua cek bernama — `checkOnlineAuthSecurityReady` dan `checkTurnstileReady` — critical saat misconfigured, informational-pass saat disabled-intentionally, dan **tak pernah mencetak nilai secret** (hanya nama var yang hilang).

## 3. Alur auth (login flow)

```
Klien (login.astro)                     Server (login.ts)                 Cloudflare
──────────────────                      ─────────────────                 ──────────
[widget cf-turnstile] --solve-->
  hidden cf-turnstile-response
POST /auth/login {..,turnstileToken} -->
                                        1. cek header tenant
                                        2. rate limit (source+tenant)
                                        3. validasi bentuk body
                                        4. enforceTurnstileIfRequired ------ siteverify -->
                                           (SEBELUM withTenant & password)   <-- success/action/
                                                                                 hostname/ts
                                           - required?  tidak → lanjut (LAN)
                                           - token hilang → 400 TURNSTILE_REQUIRED
                                           - invalid/mismatch/outage → 400 TURNSTILE_INVALID
                                        5. withTenant → lookup identity
                                        6. verifyPasswordOrDummy (argon2id)
                                        7. deny-block → cabang break-glass (#185)
                                           → cabang MFA (#184) → sesi
```

Kunci ordering: Turnstile berjalan **setelah** rate-limit/bentuk-request, **sebelum** kerja password mahal dan **di luar** transaksi DB — mendahului cabang MFA & OIDC break-glass, tanpa meregresinya. Karena berjalan sebelum lookup identity, kegagalan Turnstile tak pernah jadi oracle enumerasi akun (respons identik untuk identifier dikenal/tak dikenal).

Setup (`POST /api/v1/setup/initialize`) mengikuti pola sama dengan action `setup` (token login tak bisa dipakai ulang di sini). Base ini tak punya halaman UI setup, jadi enforcement setup adalah pertahanan bagi operator yang menjalankan bootstrap pada deployment full-online.

## 4. Setup Cloudflare & rotasi secret

**Provisioning:**

1. Dashboard Cloudflare → Turnstile → Add Site. Domain = hostname publik deployment (mis. `app.example.com`). Widget mode sesuai kebutuhan (managed direkomendasikan).
2. Salin **Site Key** → `TURNSTILE_SITE_KEY` (publik, boleh di-commit ke config non-secret env). Salin **Secret Key** → `TURNSTILE_SECRET_KEY` (secret manager, **jangan** commit).
3. Set `TURNSTILE_EXPECTED_HOSTNAME` = hostname publik yang sama dengan domain widget.
4. (Opsional) Set `action` per widget di dashboard tak diperlukan — base ini mengirim `data-action="login"` dan memvalidasi echo-nya server-side.
5. Nyalakan: `AUTH_ONLINE_SECURITY_ENABLED=true`, `AUTH_ONLINE_SECURITY_PROFILE=full_online`, `TURNSTILE_ENABLED=true`.
6. Jalankan `bun run config:validate` lalu `bun run security:readiness` — keduanya harus hijau sebelum go-live.

**Rotasi Secret Key (zero-downtime):**

1. Cloudflare dashboard → widget → rotate secret. Cloudflare menerima secret lama **dan** baru selama masa transisi singkat.
2. Perbarui `TURNSTILE_SECRET_KEY` di secret manager → rolling-restart instance. Karena verifikasi stateless (tak ada state di DB), tak ada migrasi/backfill.
3. Validasi login sukses pada satu instance, lalu selesaikan rollout.
4. Site key jarang dirotasi; bila diganti, perbarui `TURNSTILE_SITE_KEY` (redeploy agar widget membawa key baru) bersamaan.

Secret **tidak pernah** disimpan di DB/source/log/audit — hanya di env/secret manager. Backup DB tak pernah menghasilkan secret Turnstile.

## 5. Incident / fallback SOP (Turnstile unavailable)

Pada profil full-online, kegagalan Cloudflare **fail-closed**: login/setup ditolak `TURNSTILE_INVALID` selama outage (circuit breaker `turnstile` membuka setelah kegagalan transport beruntun dan menolak cepat). Ini disengaja — bukan bug.

Opsi mitigasi, dari paling aman:

1. **Tunggu pemulihan.** Breaker mencoba ulang otomatis setelah `openDurationMs`. Log `turnstile.circuit_breaker_open` (warning) menandai outage berkelanjutan.
2. **Downgrade profil sementara** bila outage Cloudflare berkepanjangan dan akses admin kritis: set `TURNSTILE_ENABLED=false` (atau `AUTH_ONLINE_SECURITY_ENABLED=false`) → rolling-restart. Rate limit + lockout **tetap** melindungi login. Kembalikan setelah pulih. Catat keputusan di audit operasional.
3. **Jangan** menonaktifkan rate limit/lockout sebagai "kompensasi" — itu justru menghapus lapisan yang tetap bekerja.

Break-glass admin (OIDC #185) dan lockout tak bergantung pada Turnstile; jalur password lokal untuk identity break-glass tetap tunduk pada rate limit + Turnstile (bila masih enabled) — matikan flag bila benar-benar terkunci oleh outage provider.

## 6. Threat model

| Ancaman                                            | Mitigasi di base ini                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bot abuse / credential stuffing**                | Widget managed Cloudflare + verifikasi server-side sebelum argon2id verify; berlapis dengan rate limit source+tenant dan lockout per-identity.                                                                                                                               |
| **Token replay (lintas request)**                  | Cloudflare menjadikan token single-use (verify kedua → `success:false` → ditolak). Verifier juga cek freshness `challenge_ts` (`TURNSTILE_MAX_TOKEN_AGE_SEC`). Turnstile berjalan sebelum lapisan idempotency dan tak menyentuh store-nya → tak bisa mem-bypass idempotency. |
| **Token replay (lintas action)**                   | `action` divalidasi per-endpoint (`login` vs `setup`); token yang di-solve untuk login ditolak di setup. Mutation test membuktikannya (hapus cek action → test merah).                                                                                                       |
| **Fail-open**                                      | Semua kegagalan (misconfig/outage/timeout/malformed/mismatch/stale) kolaps ke penolakan `TURNSTILE_INVALID`. Misconfig runtime (enabled tanpa secret/hostname) fail-closed, bukan skip.                                                                                      |
| **Hostname confusion**                             | `hostname` respons divalidasi terhadap `TURNSTILE_EXPECTED_HOSTNAME` (wajib saat enabled). Token yang di-solve pada halaman attacker yang menyematkan site key kita ditolak. Mutation test membuktikannya.                                                                   |
| **Provider outage → lockout massal lintas-tenant** | Circuit breaker hanya trip pada kegagalan **transport**; `success:false`/mismatch dihitung sukses provider, jadi token sampah tak bisa mengunci login semua tenant.                                                                                                          |
| **Account enumeration oracle**                     | Enforcement berjalan sebelum lookup identity; semua kegagalan kode generik tunggal; token/secret tak pernah di respons/log/audit.                                                                                                                                            |
| **Secret exposure**                                | Secret dari env saja; tak pernah di DB/source/log/audit/response/health output (readiness hanya cetak nama var). Redaction defense-in-depth pada pesan error verifier.                                                                                                       |
| **SSRF via verify endpoint**                       | URL siteverify tetap (`config.verifyUrl` hanya dari konfigurasi, tak pernah input request).                                                                                                                                                                                  |
| **DoS via respons besar**                          | Cap ukuran respons (`TURNSTILE_MAX_RESPONSE_BYTES`) + timeout satu-`AbortController` yang menutup fetch dan baca body (anti slow-drip).                                                                                                                                      |

## 7. Testing

- `tests/turnstile-verifier.test.ts` — verifier terhadap fake siteverify (`Bun.serve`): success, reject, timeout, malformed, non-2xx, oversize, breaker open, hostname/action/stale mismatch (mutation proofs), dan token/secret tak pernah bocor ke log/detail.
- `tests/turnstile-enforcement.test.ts` — enforcement: LAN/disabled **nol outbound** (spy `globalThis.fetch`), full-online fail-closed (missing/misconfig/reject/mismatch → satu kode generik), plus matriks preflight LAN / full-online valid / full-online misconfigured (`validateEnv` + `checkTurnstileReady` + `checkOnlineAuthSecurityReady`).
- `tests/security-headers-csp.test.ts` — origin CSP terbuka hanya saat enabled, sempit ke satu origin Cloudflare, dan enabled vs disabled berbeda **hanya** pada dua direktif.
