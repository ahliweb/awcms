---
"awcms": minor
---

Audit trail dan pengerasan jalur login (Issue #145, #147).

**Audit (#145)** — `POST /api/v1/auth/login` sebelumnya tidak menulis satu baris audit pun, sukses maupun gagal, padahal infra `recordAuditEvent` sudah dipakai 20+ endpoint lain dan `awcms_abac_decision_logs` tidak menutupi login (guard tak pernah jalan di jalur pre-auth). Post-incident, `awcms_audit_events` kosong dan `awcms_sessions` tidak menyimpan IP/UA — lebih buruk, reset `failed_login_count = 0` saat login sukses menghapus jejak brute-force yang mendahuluinya. Login kini menulis `login_succeeded`/`login_failed`, plus recorder out-of-band untuk kasus transaksi rollback (baris audit di dalamnya ikut hilang).

Atribut audit dibatasi ke `method`/`reason`/`ipHash`/`userAgent` lewat `src/lib/security/client-fingerprint.ts` (port dari awcms-mini): `ipHash` adalah HMAC-SHA256 ber-key — stabil untuk mengelompokkan percobaan per sumber, tapi tidak reversible (sha256 tanpa key atas ruang IPv4 2^32 habis dibrute dalam hitungan detik). IP mentah tidak bisa dipersist (`redactSensitiveAttributes` menjadikannya `[REDACTED]`), dan `loginIdentifier` sengaja tidak diaudit: umumnya email/PII, dan menyimpan string dari penyerang pada percobaan gagal justru menciptakan kebocoran enumerasi.

**Pengerasan (#147)** — empat lubang yang diwarisi dari awcms-mini:

1. **Oracle timing** — identifier tak dikenal melewati argon2id (~0 ms) sementara yang dikenal membayar m=64MB (~75 ms), sehingga penyerang bisa memetakan akun mana yang eksis tanpa pernah menyentuh `failed_login_count` (lockout tak pernah menyala). Kini identifier tak dikenal tetap diverifikasi melawan dummy argon2id hash konstan.
2. **Oracle pesan** — `locked` menjawab `"Account is temporarily locked."`, yang hanya mungkin muncul bila identifier eksis. Kini identik dengan `invalid_credentials`. `tenant_inactive` tetap dibedakan (tenant disebut caller di header; tidak membocorkan identity).
3. **`X-Forwarded-For` dipercaya tanpa syarat** sebagai kunci rate limit. Pada topologi terekspos-langsung yang justru didokumentasikan repo ini, header itu dikendalikan penyerang: kirim nilai acak per request → bucket baru tiap kali → limit 20/60 detik tak pernah menyala. Kini hanya dipercaya bila `TRUSTED_PROXY_ENABLED=true` (default `false`).
4. **Ambang env NaN mematikan kontrol secara diam-diam** — `Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5)` dengan nilai `5x` menghasilkan `NaN`, `failedLoginCount >= NaN` selalu `false`, lockout mati total tanpa peringatan. Helper `parsePositiveIntEnv` kini menolak non-finite/non-integer/`<= 0`, jatuh ke default, dan menulis `log("warning", ...)`.

**Env baru (opsional, keduanya aman secara default):** `TRUSTED_PROXY_ENABLED` (default `false`) dan `AUTH_IP_HASH_SECRET` (meng-key HMAC `ipHash`; bila kosong/placeholder dipakai kunci acak per proses — tetap non-reversible, tapi `ipHash` tidak sebanding lintas restart/instance, dan satu warning ditulis).
