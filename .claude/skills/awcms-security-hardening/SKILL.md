---
name: awcms-security-hardening
description: Audit keamanan berbasis standar (OWASP Top 10, OWASP ASVS, ISO/IEC 27001 Annex A) untuk AWCMS. Gunakan saat diminta "security hardening", audit OWASP/ASVS/ISO, penilaian kepatuhan, atau pengerasan menjelang go-live/audit eksternal. Berbeda dari awcms-security-review (checklist DoD per modul) — skill ini memetakan kontrol ke kerangka standar industri.
---

> **Asesmen terbaru: 4 Agustus 2026 — [`docs/awcms/repo-assessment-2026-08-04.md`](../../../docs/awcms/repo-assessment-2026-08-04.md).**
> Postur dasar KUAT dan sudah diverifikasi ke kode (security headers lengkap
> termasuk CSP/HSTS/`X-Frame-Options: DENY`, 141 pernyataan RLS `FORCE` diuji
> sebagai `awcms_app`, ABAC default-deny + decision log, MFA/OIDC/Turnstile/SoD,
> kredensial mesin baca-saja, cakupan penegakan permission 203/203 nol
> pengecualian). Tiga temuan terbuka yang WAJIB dibaca sebelum audit berikutnya:
>
> 1. **A01/API5 — satu rute melewati chokepoint otorisasi.**
>    `POST /api/v1/blog/posts/{id}/submit-review` tidak memanggil
>    `authorizeInTransaction`, sehingga ABAC/platform-scope/business-scope/SoD
>    dilewati untuk permission yang rute lain evaluasi penuh. Severity moderat
>    (blast radius sempit); KELASNYA yang serius. Lihat `awcms-abac-guard`
>    §ATURAN PERTAMA.
> 2. ~~API4/ASVS V11.2 — rate limiter `Map` dalam-proses.~~ **DITUTUP
>    ([ADR-0066](../../../docs/adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md)):**
>    `checkSharedRateLimit` berbagi lewat Redis (window ada di KUNCI, jadi tak ada
>    read-modify-write), cakupan naik ke **sebelas** permukaan auth. Ia
>    **GAGAL-TERBUKA** saat Redis mati — sengaja, karena gagal-tertutup mengubah
>    gangguan Redis jadi penolakan login total yang bisa dipicu penyerang; lockout
>    per-identitas di PostgreSQL adalah kontrol yang mengikat, dan tidak
>    terpengaruh.
> 3. **Rantai pasok — `bun audit` melaporkan 1 moderate** (`postcss <=8.5.22`
>    transitif lewat `astro › vite › postcss`, GHSA-fxqj-rqcc-2cmp; jalur build).

# AWCMS — Security Hardening (OWASP / ASVS / ISO)

Sumber kebenaran: **`docs/awcms/20_threat_model_security_architecture.md`** (STRIDE, kontrol berlapis, trust boundary, **§Matrix kepatuhan OWASP/ASVS/ISO 27001** — matrix nyata dengan bukti per baris sudah ditulis di Issue #437, pakai sebagai template/precedent saat audit ulang atau menambah kontrol baru), **`docs/awcms/10_template_kode_coding_standard.md`** (guardrail), dan **`docs/awcms/13_final_master_index_traceability.md`** (matrix kontrol). Skill ini **memetakan** kontrol proyek ke kerangka standar; pakai bersama `awcms-security-review` (checklist per modul) dan subagent `awcms-security-auditor`.

## OWASP Top 10 (2021) → kontrol di base

| #   | Kategori                       | Cek utama di AWCMS                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Broken Access Control          | ABAC default-deny + deny-overrides (ADR-0004); RLS `ENABLE`+`FORCE` (ADR-0003); DB role non-superuser; `WHERE id=<tenant>` eksplisit pada tabel RLS-free (`awcms_tenants`); IDOR — cek tiap resource difilter tenant/kepemilikan                                                                                                                                                                                |
| A02 | Cryptographic Failures         | Password argon2id (`Bun.password`); token sesi opaque (hanya hash disimpan); identifier sensitif `value_hash`+`masked_value`; HTTPS di produksi; cookie `HttpOnly`/`Secure`/`SameSite`                                                                                                                                                                                                                          |
| A03 | Injection                      | Query hanya via tagged template parametrik `Bun.SQL` (tak ada string-concat SQL); `tx.unsafe`/`SET LOCAL` hanya untuk nilai tervalidasi (`assertUuid`); validasi input tiap endpoint; output encoding (Astro auto-escape)                                                                                                                                                                                       |
| A04 | Insecure Design                | Threat model doc 20; immutability posted; idempotency; self-approval ditolak; fail-closed default (GUC tenant zero-UUID)                                                                                                                                                                                                                                                                                        |
| A05 | Security Misconfiguration      | Secret hanya env; `.env` gitignored; CI menolak `.env`; `security:readiness` memblokir go-live (RLS FORCE, role bukan superuser); error tanpa stack trace; security response headers (`src/lib/security/security-headers.ts`, Issue #437 — X-Content-Type-Options/X-Frame-Options/Referrer-Policy/Permissions-Policy/HSTS prod-gated) + CSP native Astro `security.csp` (`astro.config.mjs`) di setiap response |
| A06 | Vulnerable Components          | Bun-only (ADR-0002); Dependabot; lockfile terkunci; minim dependency                                                                                                                                                                                                                                                                                                                                            |
| A07 | Identification & Auth Failures | Login lockout per-identitas setelah N gagal; pesan generik anti-enumeration; TTL sesi; revoke saat logout; rate limiting sumber+tenant (`src/lib/security/rate-limit.ts`, Issue #437 — menahan rotasi `loginIdentifier` dari sumber sama, reuse untuk endpoint publik/mahal lain via `awcms-integration`)                                                                                                       |
| A08 | Software & Data Integrity      | Checksum file sync/objek/backup; audit append-only; CodeQL; migration checksum                                                                                                                                                                                                                                                                                                                                  |
| A09 | Logging & Monitoring Failures  | Audit high-risk + decision log + correlation ID (otomatis di `meta.correlationId` untuk semua endpoint `/api/*` sejak Issue #447, lihat `awcms-observability`); log terstruktur; **redaksi** secret/PII wajib sebelum log; retensi/purge audit event (730 hari default) + extension point untuk export ke SIEM eksternal (Issue #447)                                                                           |
| A10 | SSRF                           | URL provider dari env tepercaya, bukan input user; provider di luar transaksi (ADR-0006)                                                                                                                                                                                                                                                                                                                        |

## OWASP ASVS (L1/L2 relevan)

- [ ] **V2 Auth** — hashing modern, lockout, session fixation dicegah (token baru saat login), logout mencabut sesi.
- [ ] **V3 Session** — cookie `HttpOnly`+`SameSite=Lax`+`Secure` (prod); token opaque server-side; expiry.
- [ ] **V4 Access Control** — default deny, cek per-request (bukan sekali), RLS defense-in-depth, tak ada IDOR.
- [ ] **V5 Validation/Encoding** — validasi tiap input, output encoding, CSRF via Astro `checkOrigin` (wajib `Content-Type` pada mutation).
- [ ] **V7 Error/Logging** — error aman tanpa detail internal; log tanpa data sensitif.
- [ ] **V9 Communications** — TLS di produksi (HSTS `Strict-Transport-Security` prod-gated, Issue #437); HMAC untuk kanal mesin-ke-mesin (sync).
- [ ] **V12 Files** — checksum diverifikasi; path/objek tak dari input tak tepercaya.
- [ ] **V14 HTTP Security Configuration** — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS (Issue #437, `src/lib/security/security-headers.ts` + `astro.config.mjs` `security.csp`). **Gotcha CSP nyata**: nonce per-request dihapus diam-diam oleh compiler Astro dari atribut `is:inline`; hash SHA-256 manual untuk satu skrip yang diketahui bisa melewatkan skrip/style lain yang Astro inline per-komponen tanpa diminta — **verifikasi CSP wajib pakai browser sungguhan** (headless-Chrome/CDP), curl tidak bisa mendeteksi pelanggaran CSP karena tak mengeksekusi JS/CSS.

## ISO/IEC 27001:2022 Annex A (kontrol yang relevan ke kode)

A.5.15 access control · A.5.17 authentication info · A.8.2 privileged access (DB role least-privilege) · A.8.5 secure authentication · A.8.12 data leakage prevention (masking/redaction) · A.8.15 logging · A.8.16 monitoring (log terstruktur + extension point `setLogSink`/`setAuditExportHook` sejak Issue #447 — titik pemasangan SIEM eksternal, BUKAN implementasi SIEM nyata, itu tetap di luar cakupan base generik ini, lihat `awcms-observability`) · A.8.24 cryptography · A.8.28 secure coding (guardrail doc 10) · A.8.31 separation of environments. Sisanya (kebijakan, personel, fisik) di luar cakupan kode base.

## Cara kerja

1. Petakan tiap item ke bukti nyata di repo (query DB, panggilan fungsi domain, grep file) — **bukan** asumsi; pola sama seperti `scripts/security-readiness.ts`.
2. Tandai: terpenuhi / gap / di luar scope base. Temuan **critical** memblokir go-live.
3. Prioritaskan gap berdasarkan dampak (STRIDE/EoP & Info-disclosure paling tinggi).

## Output

Matrix kepatuhan (kategori → status → bukti/lokasi → remediasi) + daftar temuan berperingkat critical→low + saran patch. Jalankan `bun run security:readiness` sebagai gate objektif.

## Skill terkait

`awcms-security-review` (checklist DoD per modul), `awcms-abac-guard`, `awcms-audit-log`, `awcms-observability` (correlation ID, retensi, extension point A.8.16), `awcms-integration` (rate limiting reuse), `awcms-sensitive-data`, `awcms-sync-hmac`, `awcms-production-preflight`; subagent `awcms-security-auditor`.
