---
name: awcms-security-hardening
description: Audit keamanan berbasis standar (OWASP Top 10, OWASP ASVS, ISO/IEC 27001 Annex A) untuk AWCMS. Gunakan saat diminta "security hardening", audit OWASP/ASVS/ISO, penilaian kepatuhan, atau pengerasan menjelang go-live/audit eksternal. Berbeda dari awcms-security-review (checklist DoD per modul) — skill ini memetakan kontrol ke kerangka standar industri.
---

> **BACA DULU — peta kontrol ↔ standar ada di
> [`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md).**
> Dokumen itu **hidup** (dimutakhirkan saat kontrol berubah) dan memuat: edisi
> tiap standar yang di-pin, matriks OWASP Top 10 2021 / API Security Top 10 2023 /
> ASVS 4.0.3 / ISO 27001:2022 Annex A / NIST SSDF **dengan bukti berkas per
> baris**, tabel header respons berdampingan dengan `awcms-astro`, tiga belas
> celah ber-pemeriksa, dan daftar kontrol yang **sengaja ditolak**. Halaman ini
> adalah cara kerjanya; dokumen itu adalah keadaannya.
>
> **Postur dasar KUAT, diverifikasi ke kode** (dijalankan, bukan dikutip):
> `access:chokepoint:check` **331 handler / 6 memutuskan permission / 0 bypass**;
> `access:permissions:enforcement:check` **203/203 / 0 pengecualian**;
> 143 pernyataan RLS `FORCE` diuji sebagai `awcms_app` LOGIN; `bun audit` bersih;
> argon2id; lockout atomik-di-DB; MFA/OIDC/Turnstile/SoD; kredensial mesin
> baca-saja.
>
> **Yang SUDAH DITUTUP** (jangan dilaporkan ulang sebagai temuan):
>
> - ~~A01/API5 — rute melewati chokepoint otorisasi.~~ **DITUTUP
>   ([ADR-0063](../../../docs/adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md)):**
>   TIGA handler (bukan satu — pembacaan tingkat-BERKAS pada putaran pertama
>   menggabungkan `GET`/`PATCH` di satu berkas dan menyimpulkan kepatuhan yang
>   tidak ada). `authorizeInTransaction` kini menerima `ownershipGrant` yang
>   **MELEBARKAN** himpunan permission alih-alih memotong keputusan, jadi ABAC/
>   platform-scope/business-scope/SoD tetap bisa menolak. Gerbangnya di-iris
>   **per HANDLER**.
> - ~~API4/ASVS V11.2 — rate limiter `Map` dalam-proses.~~ **DITUTUP
>   ([ADR-0066](../../../docs/adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md)):**
>   `checkSharedRateLimit` berbagi lewat Redis (nomor window ada di KUNCI, jadi
>   tak ada read-modify-write). Ia **GAGAL-TERBUKA** saat Redis mati — sengaja,
>   karena gagal-tertutup mengubah gangguan Redis jadi penolakan login total yang
>   bisa dipicu penyerang; lockout per-identitas di PostgreSQL adalah kontrol yang
>   mengikat dan tidak terpengaruh.
> - ~~Rantai pasok — 1 moderate `postcss`.~~ **DITUTUP** (`overrides` `^8.5.23`).
> - ~~Kontrak `awcms-astro` tak dijaga test.~~ **DITUTUP**
>   ([ADR-0065](../../../docs/adr/0065-awcms-astro-consumer-contract-is-frozen.md)) —
>   dengan catatan cakupan di temuan 3 di bawah.
>
> **TEMUAN TERBUKA per 4 Agustus 2026 (putaran kedua asesmen, §9):**
>
> 1. ~~ASVS V3.4.1 / A05 — `AUTH_COOKIE_SECURE` gagal-terbuka saat tidak diset.~~
>    **DITUTUP 4 Agustus 2026.** Aturan produksi `scripts/validate-env.ts` kini
>    `!== "true"`, sejajar dengan perbandingan runtime (`auth/login.ts`,
>    `mfa-session-assurance.ts`, `analytics/collect.ts`). Non-produksi sengaja
>    tidak dituntut — dev berjalan di `http://`. **Pelajaran yang tetap
>    berlaku saat mengaudit apa pun yang berbentuk seperti ini:** cacatnya hanya
>    terlihat pada keadaan **ABSEN**; ejaan salah (`1`/`TRUE`/`yes`) sudah
>    ditolak aturan tipe `bool`, jadi menguji nilai `"false"` — atau nilai salah
>    apa pun — tetap hijau di atas cacat aslinya. Draf pertama temuan ini
>    mengklaim keempat keadaan lolos; **menjalankan validator** membantahnya dan
>    menyempitkannya jadi satu. Jalankan, jangan baca.
> 2. **OWASP Secure Headers — `Cross-Origin-Opener-Policy` dan
>    `Cross-Origin-Resource-Policy` tidak dikirim.** Untuk aplikasi ber-sesi
>    manusia dengan 42 halaman ber-render, COOP `same-origin` adalah kontrol yang
>    benar-benar berlaku (berbeda dari situs statis tanpa sesi).
> 3. **Interop — kontrak konsumen membekukan enam permukaan; `awcms-astro`
>    memanggil tiga.** `CONSUMER_PATHS` diturunkan dengan mem-grep repo sebelah
>    **tanpa membuang komentar**, sehingga `/blog/posts/{id}`, `/auth/session`,
>    dan `/access/machine-credentials` dibekukan sebagai "dipanggil" padahal
>    ketiganya hanya muncul di komentar/pesan error di sana. Perbaikannya bukan
>    memangkas jadi tiga, melainkan memisahkan `CONSUMED` dari `COMMITTED`.
> 4. **Pin edisi OWASP (Top 10 2021, ASVS 4.0.3) tidak pernah menjadi keputusan
>    tertulis.** Ia warisan dari saat halaman ini ditulis.
>    `awcms-astro` menyatakan **mengikuti repo ini dan tidak mendahuluinya**, jadi
>    menaikkan edisi adalah **ADR tingkat keluarga** — bukan penyuntingan tabel.
>    Sampai ADR itu ada, petakan ke 2021/4.0.3 dan katakan bahwa itu pin.

# AWCMS — Security Hardening (OWASP / ASVS / ISO)

Sumber kebenaran: **`docs/awcms/20_threat_model_security_architecture.md`** (STRIDE, kontrol berlapis, trust boundary, **§Matrix kepatuhan OWASP/ASVS/ISO 27001** — matrix nyata dengan bukti per baris sudah ditulis di Issue #437, pakai sebagai template/precedent saat audit ulang atau menambah kontrol baru), **`docs/awcms/10_template_kode_coding_standard.md`** (guardrail), dan **`docs/awcms/13_final_master_index_traceability.md`** (matrix kontrol). Skill ini **memetakan** kontrol proyek ke kerangka standar; pakai bersama `awcms-security-review` (checklist per modul) dan subagent `awcms-security-auditor`.

## OWASP Top 10 (2021) → kontrol di base

| #   | Kategori                       | Cek utama di AWCMS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Broken Access Control          | ABAC default-deny + deny-overrides (ADR-0004); RLS `ENABLE`+`FORCE` (ADR-0003); DB role non-superuser; `WHERE id=<tenant>` eksplisit pada tabel RLS-free (`awcms_tenants`); IDOR — cek tiap resource difilter tenant/kepemilikan                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A02 | Cryptographic Failures         | Password argon2id (`Bun.password`); token sesi opaque (hanya hash disimpan); identifier sensitif `value_hash`+`masked_value`; HTTPS di produksi; cookie `HttpOnly` + `SameSite=Lax` **tanpa syarat**, `Secure` **bersyarat** `AUTH_COOKIE_SECURE === "true"` — lihat temuan terbuka 1 di banner, jangan tulis "terpenuhi" tanpa memeriksa env produksinya                                                                                                                                                                                                                                                                                                                                                 |
| A03 | Injection                      | Query hanya via tagged template parametrik `Bun.SQL` (tak ada string-concat SQL); `tx.unsafe`/`SET LOCAL` hanya untuk nilai tervalidasi (`assertUuid`); validasi input tiap endpoint; output encoding (Astro auto-escape)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A04 | Insecure Design                | Threat model doc 20; immutability posted; idempotency; self-approval ditolak; fail-closed default (GUC tenant zero-UUID)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A05 | Security Misconfiguration      | Secret hanya env; `.env` gitignored; CI menolak `.env`; `security:readiness` memblokir go-live (RLS FORCE, role bukan superuser); error tanpa stack trace; **satu-satunya** pemilik header keamanan adalah `src/lib/security/security-headers.ts` dipasang `src/middleware.ts` ke SETIAP response — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS prod-gated. **`astro.config.mjs` SENGAJA TIDAK memuat blok `security.csp`** (Issue #148, dipertahankan #166): mengaktifkannya membuat DUA sumber CSP yang saling menimpa saat page render, dan halaman rusak tanpa sebab yang terlihat. Versi lama halaman ini menuliskan kebalikannya — jangan ikuti |
| A06 | Vulnerable Components          | Bun-only (ADR-0002); Dependabot; lockfile terkunci; minim dependency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A07 | Identification & Auth Failures | Login lockout per-identitas **atomik di DB** (CAS/`FOR UPDATE`, bukan read-modify-write JS); pesan generik anti-enumeration; TTL sesi; revoke saat logout; deaktivasi mencabut sesi seketika; MFA TOTP + rotasi aal1→aal2 anti-fixation; rate limit **berbagi lewat Redis** `checkSharedRateLimit` (`src/lib/security/rate-limit.ts`, ADR-0066) di 18 berkas rute — reuse untuk endpoint publik/mahal lain via `awcms-integration`                                                                                                                                                                                                                                                                        |
| A08 | Software & Data Integrity      | Checksum file sync/objek/backup; audit append-only; CodeQL; migration checksum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A09 | Logging & Monitoring Failures  | Audit high-risk + decision log + correlation ID (otomatis di `meta.correlationId` untuk semua endpoint `/api/*` sejak Issue #447, lihat `awcms-observability`); log terstruktur; **redaksi** secret/PII wajib sebelum log; retensi/purge audit event (730 hari default) + extension point untuk export ke SIEM eksternal (Issue #447)                                                                                                                                                                                                                                                                                                                                                                     |
| A10 | SSRF                           | URL provider dari env tepercaya, bukan input user; provider di luar transaksi (ADR-0006)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## OWASP ASVS (L1/L2 relevan)

- [ ] **V2 Auth** — hashing modern, lockout, session fixation dicegah (token baru saat login), logout mencabut sesi.
- [ ] **V3 Session** — token opaque server-side; expiry; rotasi saat naik assurance; logout & deaktivasi mencabut. Cookie `HttpOnly`+`SameSite=Lax` tanpa syarat — **`Secure` bersyarat dan gagal-terbuka saat `AUTH_COOKIE_SECURE` tidak diset** (temuan terbuka 1). Uji dengan variabelnya DIHAPUS, bukan disetel `"false"`.
- [ ] **V4 Access Control** — default deny, cek per-request (bukan sekali), RLS defense-in-depth, tak ada IDOR.
- [ ] **V5 Validation/Encoding** — validasi tiap input, output encoding, CSRF via Astro `checkOrigin` (wajib `Content-Type` pada mutation).
- [ ] **V7 Error/Logging** — error aman tanpa detail internal; log tanpa data sensitif.
- [ ] **V9 Communications** — TLS di produksi (HSTS `Strict-Transport-Security` prod-gated, Issue #437); HMAC untuk kanal mesin-ke-mesin (sync).
- [ ] **V12 Files** — checksum diverifikasi; path/objek tak dari input tak tepercaya.
- [ ] **V14 HTTP Security Configuration** — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS — **enam header, satu pemilik**: `src/lib/security/security-headers.ts` dipasang `src/middleware.ts`. `astro.config.mjs` **tidak** memuat `security.csp`, dan tidak boleh (dua sumber CSP yang saling menimpa). **Belum dikirim:** `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` (temuan terbuka 2). **Gotcha CSP nyata**: nonce per-request dihapus diam-diam oleh compiler Astro dari atribut `is:inline`; hash SHA-256 manual untuk satu skrip yang diketahui bisa melewatkan skrip/style lain yang Astro inline per-komponen tanpa diminta — **verifikasi CSP wajib pakai browser sungguhan** (headless-Chrome/CDP), curl tidak bisa mendeteksi pelanggaran CSP karena tak mengeksekusi JS/CSS.

## OWASP API Security Top 10 (2023)

Repo ini **menyajikan** 255 berkas rute `/api/v1`, jadi kategori ini berlaku
penuh — dan ia tidak punya padanan di `awcms-astro`, yang tidak menyajikan API.
Matriks API1–API10 lengkap dengan bukti per baris ada di
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md) §4.
Yang paling sering salah dinilai saat audit ulang:

- **API5** — jangan menilai per BERKAS. Satu berkas rute bisa memanggil
  chokepoint di `GET` dan tidak di `PATCH`; itu persis cara temuan ADR-0063
  terlewat sekali. Jalankan `bun run access:chokepoint:check`.
- **API9** — inventori bukan "OpenAPI-nya ada", melainkan "tiap operasi ber-tag
  terdeklarasi DAN tiap tag terdeklarasi dipakai". Jalankan
  `bun run api:spec:check`.

## ISO/IEC 27001:2022 Annex A (kontrol yang relevan ke kode)

A.5.15 access control · A.5.17 authentication info · A.8.2 privileged access (DB role least-privilege) · A.8.5 secure authentication · A.8.12 data leakage prevention (masking/redaction) · A.8.15 logging · A.8.16 monitoring (log terstruktur + extension point `setLogSink`/`setAuditExportHook` sejak Issue #447 — titik pemasangan SIEM eksternal, BUKAN implementasi SIEM nyata, itu tetap di luar cakupan base generik ini, lihat `awcms-observability`) · A.8.24 cryptography · A.8.28 secure coding (guardrail doc 10) · A.8.31 separation of environments. Sisanya (kebijakan, personel, fisik) di luar cakupan kode base.

## Cara kerja

1. Petakan tiap item ke bukti nyata di repo (query DB, panggilan fungsi domain, grep file) — **bukan** asumsi; pola sama seperti `scripts/security-readiness.ts`.
2. Tandai: terpenuhi / gap / di luar scope base. Temuan **critical** memblokir go-live.
3. Prioritaskan gap berdasarkan dampak (STRIDE/EoP & Info-disclosure paling tinggi).

## Output

Matrix kepatuhan (kategori → status → bukti/lokasi → remediasi) + daftar temuan berperingkat critical→low + saran patch. Jalankan `bun run security:readiness` sebagai gate objektif.

**Lalu mutakhirkan
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md).**
Itu bukan pekerjaan tambahan, itu keluarannya: sebuah audit yang hasilnya hanya
hidup di jawaban chat akan diulang dari nol enam bulan kemudian, dan celah yang
sudah ditolak dengan alasan akan diusulkan lagi sebagai temuan baru. Aturan
dokumen itu: baris tanpa **pemeriksa** adalah klaim, bukan kontrol — jadi setiap
celah yang dipindahkan ke `DITUTUP` harus menyebut gerbang/test yang ikut
mendarat.

## Skill terkait

`awcms-security-review` (checklist DoD per modul), `awcms-abac-guard`, `awcms-audit-log`, `awcms-observability` (correlation ID, retensi, extension point A.8.16), `awcms-integration` (rate limiting reuse), `awcms-sensitive-data`, `awcms-sync-hmac`, `awcms-production-preflight`; subagent `awcms-security-auditor`.
