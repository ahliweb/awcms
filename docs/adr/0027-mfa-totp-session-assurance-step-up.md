# ADR-0027 — MFA TOTP, session assurance, dan step-up authentication

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** maintainer
- **Terkait:** Issue #184, epic #177 (kesiapan fondasi ERP turunan); ADR-0026 (modular OpenAPI); doc `docs/awcms/mfa-totp-step-up.md`; port dari awcms-mini Issue #589.

## Konteks

AWCMS sudah punya opaque session, login password + lockout + rate limit + audit login (Issue #145/#147), dan authorization default-deny. Namun akun berprivilege tinggi masih bergantung pada satu faktor, dan sebuah sesi belum bisa **menyatakan** tingkat keyakinan (assurance) yang dapat diwajibkan untuk aksi high-risk (perubahan role/policy/konfigurasi tenant, override administratif). ERP turunan membutuhkan MFA dan step-up.

Slice MFA/TOTP/recovery/challenge sudah matang di awcms-mini (Issue #589). Tetapi mini **tidak** memodelkan session assurance, step-up, admin reset, maupun policy enum, dan mini menggerbangi MFA di balik gate "full-online security" (#587) yang tidak diport ke base ini. Selain itu jalur login base ini **lebih keras** dari mini (dummy-hash anti-timing, deny reason kolaps, `TRUSTED_PROXY_ENABLED`, `parsePositiveIntEnv`) — port naif bisa meregresinya.

## Keputusan

Kami memutuskan untuk **mem-port slice MFA/TOTP/recovery/challenge dari mini dan membangun di atasnya** session assurance + step-up + policy + admin reset, dengan adaptasi berikut:

1. **Feature switch = `AUTH_MFA_ENABLED` saja** (tanpa gate full-online). Flag ini **hanya** menggerbangi enrollment; challenge login/disable/step-up digerakkan state DB (baris factor `active`) agar fail-closed — mematikan flag tak boleh membuat identity ter-enroll melewati faktor kedua.
2. **Secret TOTP dienkripsi AES-256-GCM dengan `AUTH_MFA_SECRET_ENCRYPTION_KEY`, tanpa default key.** Key hilang/invalid → `null` → semua path fail-closed `MFA_MISCONFIGURED`. Recovery code di-hash satu arah (sha256), single-use, dikonsumsi via UPDATE compare-and-swap.
3. **Anti-replay concurrency-safe** lewat `last_used_step` yang di-advance dengan CAS (`WHERE last_used_step < ${matchedStep}`); dua request konkuren pada timestep sama → hanya satu menang. Window drift dibatasi (`AUTH_MFA_TOTP_WINDOW_STEPS`, maks 10).
4. **Challenge login dua tahap tanpa oracle enumerasi**: cabang MFA hanya tercapai setelah password valid; semua jalur deny challenge kolaps ke satu kode. Sesi hasil challenge lahir di `aal2` (rotasi inheren — tak ada sesi aal1 sebelumnya).
5. **Session assurance `aal1`/`aal2`** sebagai kolom pada `awcms_sessions` (opaque-session model tidak berubah). `requireStepUp` adalah gate reusable untuk aksi high-risk, dipanggil setelah `authorizeInTransaction`. Step-up TTL pendek & server-controlled (`AUTH_MFA_STEPUP_TTL_SEC`). Kenaikan aal1→aal2 merotasi sesi (anti-fixation).
6. **Policy tenant** enum `optional` (default) / `required_for_privileged` / `required_for_all`.
7. **Admin reset** dengan permission khusus (`identity_access.mfa_admin.reset`), reason wajib, audit `critical`, dan larangan self-reset.
8. **Jalur login base yang lebih keras dipertahankan utuh** — MFA hanya menyisipkan cabang di antara blok deny dan pembuatan sesi; `resolveLoginPolicyConfig`/`resolveLoginDenyResponse`/`verifyPasswordOrDummy` tidak disentuh, tidak ada `Number(process.env...)` mini yang masuk, dan SSO/Turnstile mini **tidak** ikut diport.
9. **Enforcement policy nyata via enrollment grant** — setelah password valid, identity yang `required` tetapi tanpa factor TIDAK menerima sesi penuh; ia diberi _enrollment grant_ (baris challenge `purpose='enrollment'`, reuse `awcms_mfa_challenges`) yang hanya mengotorisasi endpoint enroll, lalu naik ke sesi `aal2` saat enrollment selesai. Fail-closed tetapi self-recoverable (tak ada lockout admin). Digerbangi `isMfaFeatureEnabled()` — bila enrollment dimatikan, policy inert (mustahil membuat MFA yang diwajibkan).
10. **Step-up di-wire ke semua aksi high-risk milik modul ini** — `requireStepUp` menjaga self-service disable, regenerate recovery code, admin reset, dan perubahan policy.
11. **Per-factor cumulative failed-verify lockout** (`AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`) — independen dari source IP dan rotasi challenge; reset saat verify sukses. Counter di-increment **atomik di-DB** (`SET failed_verify_count = CASE …`) di bawah row-lock `SELECT … FOR UPDATE` pada baris factor, sama seperti compare-and-swap replay/recovery — bukan read-modify-write dari snapshot JS, sehingga verify konkuren lintas challenge/IP tak bisa lost-update sampai lolos ambang (audit HIGH-1).
12. **Unique index recovery code di-scope `(tenant_id, code_hash)`** — mencegah collision 40-bit lintas tenant menjadi 23505→500.

## Konsekuensi

- **Positif:** faktor kedua untuk akun berprivilege; policy tenant benar-benar ditegakkan; sesi dapat menyatakan assurance dan diwajibkan oleh aksi high-risk; backup DB tak cukup untuk memperoleh secret; replay (termasuk konkuren) ditolak; brute-force per-factor dibatasi lockout independen IP; tidak ada oracle enumerasi baru; jalur login yang sudah keras tetap keras.
- **Negatif / trade-off:** `login.ts` sukses kini melakukan satu SELECT factor tambahan (indexed, hanya pada login password valid), plus — bila policy `required_for_*` aktif dan user tanpa factor — satu read policy (+ read permission untuk `required_for_privileged`). Harga fail-closed. **`required_for_privileged` mengklasifikasikan privileged secara luas**: memegang permission non-read apa pun. Ini disengaja (fail-closed: memaksa MFA untuk lebih banyak orang, bukan lebih sedikit) dan didokumentasikan. Mewiring `requireStepUp` ke aksi high-risk milik **aplikasi ERP turunan** (posting, override, exception SoD) tetap tugas turunan (#179/#181) — base menyediakan gate `requireStepUp` yang siap pakai dan sudah memasangnya pada seluruh aksi high-risk milik modul MFA sendiri.
- **Netral:** `AccessAction` bertambah `reset`. Satu operasi publik baru (`postAuthMfaVerify`) masuk allow-list `api:spec:check`. Enroll menerima header `X-AWCMS-MFA-Enrollment-Token` selain sesi. WebAuthn/passkey dan SMS/WA/email OTP tetap out of scope.
- **Caveat operasional (fail-open pada misconfig, audit INFO-1):** enforcement policy `required_*` untuk user **tanpa** factor digerbangi `AUTH_MFA_ENABLED` (poin 9) — bila operator menyetel policy tenant `required_*` **sementara** flag dimatikan, user tanpa factor menerima sesi `aal1` (user yang SUDAH enroll tetap ditantang, karena jalur challenge digerakkan state DB, bukan flag). Ini disengaja agar policy-on + fitur-off tidak mengunci enrollment, tetapi operator WAJIB tidak mengaktifkan policy `required_*` selagi `AUTH_MFA_ENABLED != true`. Runbook `docs/awcms/mfa-totp-step-up.md` mencatat ini.

## Alternatif yang dipertimbangkan

- **Menyimpan assurance di store terpisah / mengubah model sesi** — ditolak: kolom pada `awcms_sessions` mempertahankan opaque-session model apa adanya (kriteria issue: "tanpa mengubah opaque-session model").
- **Menolak login sepenuhnya untuk user `required` tanpa factor** — ditolak: mengunci user dari kemampuan enroll (lockout), dan bila responsnya bergantung status factor sebelum password terbukti, membuka oracle. Dipilih: _enrollment grant_ pasca-password yang mengotorisasi hanya enroll, sehingga policy ditegakkan (tak ada sesi penuh) namun user selalu bisa memulihkan diri.
- **Blind SET `last_used_step`** — ditolak: tidak aman terhadap dua request konkuren; CAS wajib.
- **Hanya cap per-challenge + rate limit per-IP** — ditolak: penyerang ber-password bisa mencetak challenge baru dan merotasi IP; butuh lockout kumulatif per-factor.
- **Mem-port gate full-online mini** — ditolak: epic itu tidak ada di base ini; `AUTH_MFA_ENABLED` + state DB sudah cukup dan lebih sederhana.
