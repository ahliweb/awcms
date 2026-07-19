# MFA TOTP, recovery codes, dan step-up authentication

Referensi implementasi Issue #184 (epic #177). Modul: `identity-access`. ADR: [ADR-0027](../adr/0027-mfa-totp-session-assurance-step-up.md). Skema: `sql/024_awcms_mfa_totp_schema.sql`.

## 1. Ringkasan alur (auth flow)

### 1.1 Enrollment

```
POST /api/v1/auth/mfa/totp/enroll/start   (sesi valid; AUTH_MFA_ENABLED=true)
  -> generate secret 20 byte (CSPRNG), simpan factor `pending` (secret terenkripsi)
  -> balas { secret (base32), otpauthUri }   # ditampilkan SEKALI
POST /api/v1/auth/mfa/totp/enroll/verify  { code }
  -> verifyTotpCode; bila valid -> factor `active`, last_used_step = matchedStep
  -> generate 10 recovery code, simpan hash-only
  -> balas { activated, recoveryCodes }       # ditampilkan SEKALI
```

Memulai ulang `enroll/start` sebelum verify membuang secret pending sebelumnya — hanya QR terakhir yang valid dikonfirmasi. `enroll/start` menolak bila sudah ada factor `active` (`409 MFA_ALREADY_ACTIVE`).

### 1.2 Login dua tahap

```
POST /api/v1/auth/login  { loginIdentifier, password }
  -> password valid + factor aktif:
       reset failed_login_count, buat challenge (TTL AUTH_MFA_CHALLENGE_TTL_SEC),
       audit mfa_challenge_issued, balas 401 MFA_REQUIRED + { mfaChallengeToken, expiresAt }
  -> password valid + tanpa factor + policy REQUIRED (lihat 1.5):
       balas 401 MFA_ENROLLMENT_REQUIRED + { mfaEnrollmentToken, expiresAt } — TANPA sesi
  -> password valid + tanpa factor + policy optional: sesi aal1 seperti biasa
POST /api/v1/auth/mfa/totp/verify  { mfaChallengeToken, code | recoveryCode }   # PUBLIK
  -> verifyMfaChallenge (replay-safe), buat sesi aal2, audit mfa_challenge_verified
  -> balas { token, expiresAt, assuranceLevel: "aal2" } + cookie
```

Cabang MFA di `login.ts` hanya tercapai **setelah** password valid → tidak ada oracle enumerasi baru (identifier tak dikenal / locked / password salah sudah kolaps ke satu respons sebelum titik ini). Endpoint verify diautentikasi oleh kepemilikan `mfaChallengeToken` (belum ada sesi), sama seperti reset password. Semua jalur deny challenge kolaps ke `MFA_CHALLENGE_INVALID` (respons & waktu identik untuk challenge tak dikenal / kedaluwarsa / sudah dipakai / kode salah / factor terkunci / factor nonaktif).

### 1.3 Step-up (aksi high-risk)

```
POST /api/v1/auth/mfa/step-up  { code | recoveryCode }   (sesi valid)
  -> verifyStepUpFactor (replay-safe)
  -> sesi aal1: revoke lama + buat sesi aal2 baru (rotasi, anti-fixation), balas token baru
  -> sesi aal2: refresh stepped_up_at di tempat
```

Endpoint high-risk memanggil `requireStepUp(tx, tenantId, tokenHash, now)` **setelah** `authorizeInTransaction`. Gate mengembalikan `403 STEP_UP_REQUIRED` bila sesi bukan aal2 atau step-up sudah basi (> `AUTH_MFA_STEPUP_TTL_SEC`). Contoh pemakaian:

```ts
const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, GUARD);
if (!auth.allowed) return auth.denied;
const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);
if (!stepUp.ok) return stepUp.denied;
// ... aksi high-risk ...
```

Aksi high-risk milik modul MFA yang **sudah** dijaga `requireStepUp`: self-service `disable`, `recovery-codes/regenerate`, `admin/reset`, dan `PUT policy`. Untuk aplikasi ERP turunan, panggil `requireStepUp` pada aksi sensitif turunannya (posting, override, exception SoD) — pola integrasi #179/#181.

### 1.4 Self-service & admin

- `GET /api/v1/auth/mfa/status` — status enrollment identity sendiri.
- `POST /api/v1/auth/mfa/totp/disable` — matikan MFA sendiri (audit `warning`; **butuh step-up segar** — re-autentikasi faktor).
- `POST /api/v1/auth/mfa/recovery-codes/regenerate` — batalkan semua recovery code lama, terbitkan 10 baru sekali tampil (**butuh step-up segar**).
- `POST /api/v1/auth/mfa/admin/reset` `{ identityId, reason }` — reset MFA user lain; guard `identity_access.mfa_admin.reset`, **butuh step-up segar**, audit `critical`, self-reset dilarang.
- `GET`/`PUT /api/v1/auth/mfa/policy` — baca/set enforcement level tenant (`PUT` guard `identity_access.mfa_admin.configure` + **step-up segar**).

### 1.5 Enforcement policy tenant (F1)

Policy tenant (`awcms_tenant_mfa_policies`, default `optional`) benar-benar ditegakkan di login:

- `optional` — MFA tersedia, tak pernah dipaksa.
- `required_for_all` — setiap user tenant wajib MFA.
- `required_for_privileged` — wajib bagi user yang memegang permission **non-read** apa pun (`isPrivilegedFromPermissionKeys`; klasifikasi luas = fail-closed).

Bila policy mewajibkan MFA untuk seorang user yang password-nya valid tetapi **belum punya factor**, login **tidak** menerbitkan sesi penuh. Sebagai gantinya ia mengembalikan `401 MFA_ENROLLMENT_REQUIRED` + `mfaEnrollmentToken` (baris `awcms_mfa_challenges` `purpose='enrollment'`). Token itu **hanya** mengotorisasi `enroll/start`/`enroll/verify` (dikirim via header `X-AWCMS-MFA-Enrollment-Token`, bukan sesi umum); begitu enrollment selesai, grant dikonsumsi dan sesi `aal2` diterbitkan. Fail-closed tetapi **self-recoverable** — tak ada lockout admin. Enforcement digerbangi `isMfaFeatureEnabled()`: bila enrollment dimatikan, policy inert (mustahil membuat MFA yang diwajibkan).

### 1.6 Lockout per-factor (F4)

Selain rate limit per-sumber dan cap `failed_attempts` per-challenge, tiap factor punya `failed_verify_count`/`locked_until` kumulatif (independen source IP dan rotasi challenge, meniru lockout password). Setelah `AUTH_MFA_MAX_VERIFY_ATTEMPTS` verify gagal, factor terkunci `AUTH_MFA_LOCKOUT_MINUTES` menit; verify sukses mereset. Pada login challenge, factor terkunci kolaps ke `MFA_CHALLENGE_INVALID`; pada step-up, mengembalikan `MFA_LOCKED` (429).

## 2. Referensi konfigurasi / environment

| Variabel                         | Default                | Keterangan                                                                                               |
| -------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `AUTH_MFA_ENABLED`               | `false`                | Menggerbangi permukaan **enrollment** saja. Challenge/disable/step-up digerakkan state DB (fail-closed). |
| `AUTH_MFA_SECRET_ENCRYPTION_KEY` | — (wajib bila enabled) | 32 byte base64 (`openssl rand -base64 32`). **Tidak ada default key.**                                   |
| `AUTH_MFA_TOTP_ISSUER`           | `AWCMS`                | Label issuer pada `otpauth://`.                                                                          |
| `AUTH_MFA_TOTP_PERIOD_SEC`       | `30`                   | Panjang timestep.                                                                                        |
| `AUTH_MFA_TOTP_DIGITS`           | `6`                    | 6 atau 8.                                                                                                |
| `AUTH_MFA_TOTP_WINDOW_STEPS`     | `1`                    | Toleransi drift ± timestep; dibatasi `[0, 10]`.                                                          |
| `AUTH_MFA_CHALLENGE_TTL_SEC`     | `300`                  | Umur challenge login.                                                                                    |
| `AUTH_MFA_STEPUP_TTL_SEC`        | `300`                  | Freshness step-up; pendek & server-controlled.                                                           |
| `AUTH_MFA_MAX_VERIFY_ATTEMPTS`   | `5`                    | Lockout per-factor: kunci setelah N verify gagal (independen source IP & challenge).                     |
| `AUTH_MFA_LOCKOUT_MINUTES`       | `15`                   | Durasi kunci factor setelah lockout tercapai.                                                            |
| `AUTH_MFA_RATE_LIMIT_MAX`        | `5`                    | Batas verifikasi per sumber; juga cap `failed_attempts` per-challenge.                                   |
| `AUTH_MFA_RATE_LIMIT_WINDOW_SEC` | `300`                  | Window rate limit verifikasi.                                                                            |

`config:validate` dan `security:readiness` menolak deployment dengan `AUTH_MFA_ENABLED=true` tetapi key kosong/placeholder/bukan 32 byte.

## 3. Runbook rotasi encryption key

Format ciphertext berversi (`v1:iv:tag:ct`). Skema rotasi zero-downtime butuh dukungan multi-key (belum ada); prosedur saat ini:

1. **Persiapan** — hasilkan key baru `openssl rand -base64 32`.
2. **Rotasi terjadwal (window maintenance)** — karena hanya satu key aktif, mengganti key **meng-invalidasi** semua secret tersimpan (verifikasi TOTP akan gagal `MFA_MISCONFIGURED`). Prosedur aman: (a) umumkan window, (b) set key baru, (c) minta semua user MFA **enroll ulang** (factor lama otomatis tak bisa diverifikasi; admin dapat `admin/reset` massal bila perlu), atau (d) sebelum rotasi, jalankan disable massal terkontrol. Untuk deployment besar, tunggu dukungan multi-key (roadmap) sebelum rotasi rutin.
3. **Verifikasi** — `bun run security:readiness` harus PASS untuk cek key; sampel satu login MFA end-to-end.

Jangan pernah men-commit key. Simpan di secrets manager / env deployment, bukan repo.

## 4. SOP recovery admin

**Kapan:** user kehilangan perangkat TOTP dan kehabisan recovery code.

1. **Verifikasi identitas out-of-band** (bukan lewat aplikasi) sesuai kebijakan organisasi — konfirmasi ini benar-benar user tersebut.
2. Admin ber-permission `identity_access.mfa_admin.reset`, dengan sesi yang **sudah** ber-MFA sendiri (larangan self-reset menegakkan admin tak bisa mereset dirinya), memanggil `POST /api/v1/auth/mfa/admin/reset` `{ identityId, reason }`. `reason` **wajib** dan tercatat di audit `critical`.
3. Factor user di-disable + recovery code dihapus. User kini bisa login dengan password (sesi aal1) dan **enroll ulang** MFA.
4. **Break-glass:** simpan minimal satu identitas admin ber-MFA aktif per tenant agar reset selalu bisa dilakukan; dokumentasikan pemegangnya. Jangan pernah menonaktifkan MFA seluruh admin sekaligus.
5. Tinjau audit `mfa_admin_reset` secara berkala (severity `critical`) untuk mendeteksi penyalahgunaan reset.

## 5. Threat model

| Ancaman                       | Mitigasi                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Password curian**           | Faktor kedua (TOTP) diwajibkan sebelum sesi penuh; login password valid + factor aktif hanya menerbitkan challenge, bukan sesi.                                                                                                                                                 |
| **Session fixation**          | Kenaikan aal1→aal2 (login challenge & step-up) merotasi sesi: token baru diterbitkan, sesi lama di-revoke.                                                                                                                                                                      |
| **Replay kode TOTP**          | `last_used_step` strictly-monotonic; advance via compare-and-swap sehingga dua request konkuren pada timestep sama hanya satu yang menang. Window drift dibatasi.                                                                                                               |
| **Replay recovery code**      | Konsumsi via UPDATE `... AND used_at IS NULL RETURNING` — dua request konkuren dengan kode sama hanya satu berhasil; hash-only, single-use.                                                                                                                                     |
| **Backup DB bocor**           | Secret TOTP terenkripsi AES-256-GCM dengan key di luar DB; tanpa key, backup tak menghasilkan secret. Recovery code hanya hash.                                                                                                                                                 |
| **Account enumeration**       | Cabang MFA tercapai hanya setelah password valid; semua deny challenge kolaps ke satu kode/pesan; jalur login mempertahankan dummy-hash anti-timing dan deny reason kolaps.                                                                                                     |
| **Reset abuse**               | Admin reset butuh permission khusus (default-deny), reason wajib, audit `critical`, larangan self-reset, dan break-glass terdokumentasi.                                                                                                                                        |
| **Brute-force challenge**     | Tiga lapis: rate limit per sumber (`AUTH_MFA_RATE_LIMIT_*`), cap `failed_attempts` per-challenge, dan lockout kumulatif per-factor (`AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`) yang mengunci penyerang ber-password yang mencetak challenge baru + merotasi IP. |
| **Cross-tenant akses factor** | Semua tabel RLS `ENABLE`+`FORCE` dengan policy `tenant_id = current_setting('app.current_tenant_id')`; app connect sebagai `awcms_app` (non-superuser).                                                                                                                         |
| **MFA disabled diam-diam**    | `security:readiness` `critical` gagal bila `AUTH_MFA_ENABLED=true` tanpa key valid.                                                                                                                                                                                             |

## 6. Mapping standar

**OWASP ASVS v4 (Authentication):**

- V2.1 (password) — dipertahankan dari #147 (argon2id, lockout, anti-timing).
- V2.2.1 (anti-enumeration) — respons/timing seragam; challenge kolaps.
- V2.8 (OTP verifier) — RFC 6238 TOTP, HMAC-SHA1, single-use per timestep (anti-replay), window terbatas, constant-time compare.
- V2.10 (service auth secrets) — key enkripsi dari env/secrets manager, tanpa default.
- V3 (session) — opaque token, rotasi saat privilege rise (anti-fixation), assurance level.
- V6.2 (kriptografi) — AES-256-GCM (authenticated), IV acak per operasi.

**ISO/IEC 27001/27002 (Annex A / kontrol):**

- A.5.17 / A.9.4 (authentication information & akses) — MFA untuk akun berprivilege, step-up aksi sensitif.
- A.8.5 (secure authentication) — faktor kedua, assurance level.
- A.8.24 (kriptografi) — enkripsi secret at-rest, manajemen key.
- A.8.15 / A.5.28 (logging & bukti) — audit `mfa_*` termasuk `critical` untuk admin reset.
