# 07 — Roadmap, quality gate, KPI, dan kepatuhan

> Rencana. Lihat [README](README.md) untuk status.

## 1. Fase dan exit criteria

| Fase                           | Output utama                                                                                                                                    | Exit criteria                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **P0 — Architecture baseline** | ADR-0045 + ADR rendering/BFF di `awcms-astro`; rekonsiliasi inventaris; kontrak sesi; model merchant/scope; lima descriptor + kepemilikan tabel | Setiap gap kritis punya keputusan, owner, test, dan rencana rollback           |
| **P1 — Domain foundation**     | Migrasi, descriptor, seed permission, RLS, ABAC, service, API, layar admin minimum                                                              | Matriks negative-authorization lulus; seluruh gate modul hijau                 |
| **P2 — Experience publik**     | Design token, homepage, kategori, pencarian, halaman usaha/produk, konten & legal                                                               | Acceptance visual, baseline WCAG 2.2 AA, nol placeholder & tautan kritis rusak |
| **P3 — Portal penjual**        | Auth/sesi, onboarding, profil, katalog, promosi, lead, analitik, paket                                                                          | Aktivasi merchant end-to-end; nol kebocoran lintas merchant (dibuktikan test)  |
| **P4 — Portal affiliate**      | Tautan, atribusi, konversi, ledger komisi, alur payout                                                                                          | Kontrol self-referral & fraud; maker-checker; adjustment reversible            |
| **P5 — Pilot & hardening**     | UAT, performa, verifikasi keamanan, DPIA, kontinuitas, runbook                                                                                  | Kriteria GO tercapai untuk pilot terbatas                                      |
| **P6 — Repeatability**         | Kohort, renewal, effort support, repeatability kanal                                                                                            | Scale hanya setelah retensi, mutu, keamanan, dan unit economics stabil         |

Setiap fase dipecah menjadi unit kerja atomic: satu bounded context (atau satu
irisan permukaan) per PR, membawa migrasi + seed + fragmen OpenAPI + test +
dokumen + changeset.

## 2. Quality gate (blocking)

Gate repo yang **sudah ada** dan wajib hijau:

- `bun run check` penuh (lint, docs, kontrak API, DAG modul, kepemilikan tabel &
  rute, job registry, komposisi, logging lint, tenant route factory, tenant
  context usage, typecheck, test, build).
- `bun run security:readiness`, `bun run family:conformance:check`.
- Isolasi RLS diverifikasi sebagai role aplikasi (`awcms_app`), bukan superuser.

Gate tambahan khusus Jualanku:

- 100% endpoint tercakup OpenAPI + security scheme.
- 100% tabel tenant-scoped ber-`FORCE` RLS + test isolasi tenant.
- 100% mutasi portal melewati BFF, CSRF, otorisasi, validasi, audit, correlation ID.
- 0 token bearer di `localStorage`/`sessionStorage`.
- 0 rute privat di sitemap atau cache publik.
- 0 placeholder, catatan internal, data demo, atau PII demo di produksi.
- Profil kontrol OWASP ASVS 5.0 ditetapkan; minimal **L2** untuk portal dan admin,
  tailoring terdokumentasi.
- WCAG 2.2 AA: otomatis + verifikasi manual pada alur kritis.
- Latihan backup-restore, runbook insiden, dan revokasi sesi lulus.
- Memo legal PMSE/PSE, privacy notice, terms, kebijakan affiliate, dan merchant
  agreement disetujui.

## 3. KPI

| Dimensi    | KPI utama                                                                             |
| ---------- | ------------------------------------------------------------------------------------- |
| North Star | Merchant aktif bulanan dengan halaman terbit **dan** minimal satu interaksi bermakna  |
| Akuisisi   | Sign-up merchant terkualifikasi, affiliate disetujui, sumber/kanal                    |
| Aktivasi   | Penyelesaian onboarding, waktu ke halaman terbit pertama, kelengkapan profil          |
| Engagement | Klik WhatsApp, inquiry, lead terverifikasi, pemakaian promosi                         |
| Revenue    | MRR, ARPA, konversi berbayar, margin, refund                                          |
| Retensi    | Aktif D30, churn, renewal, engagement kohort                                          |
| Affiliate  | Konversi ter-atribusi, approval rate, pelepasan hold, SLA payout, fraud rate          |
| Operasi    | Menit support per merchant, SLA verifikasi, backlog moderasi, CSAT                    |
| Teknologi  | Availability, p95 latency, error rate, MTTR, deploy failure, biaya per merchant aktif |
| Risiko     | Anomali penolakan otorisasi, insiden PII, fraud, komplain, kelengkapan audit          |

## 4. RACI

| Aktivitas                        | Product/Arch | Engineering | Growth | Operations | Finance/Risk |
| -------------------------------- | ------------ | ----------- | ------ | ---------- | ------------ |
| ADR & arsitektur target          | A/R          | R           | C      | C          | C            |
| Model domain & kontrak API       | A            | R           | C      | C          | C            |
| Design system & acceptance layar | A/R          | R           | C      | C          | I            |
| Auth, keamanan, deployment       | C            | A/R         | I      | I          | C            |
| Onboarding merchant              | C            | R           | C      | A/R        | C            |
| Aturan affiliate                 | C            | R           | A/R    | C          | A            |
| Pricing & langganan              | C            | C           | R      | C          | A            |
| Payout/refund/fraud              | I            | R           | C      | C          | A/R          |
| Privasi/legal/kepatuhan          | C            | R           | C      | C          | A/R          |
| Acceptance produk                | A            | C           | C      | C          | C            |
| Persetujuan rilis teknis         | C            | A           | I      | I          | C            |

## 5. Kriteria GO / PIVOT / PAUSE / STOP

**GO**

- P0 tertutup dan inventaris repo konsisten.
- Permukaan publik, merchant, affiliate, dan internal terpisah secara rute,
  audience sesi, cache, dan otorisasi.
- Matriks negative-authorization lulus.
- Merchant pilot bisa menyelesaikan alur publish dan menerima interaksi bermakna.
- Dokumen privasi/legal + kanal pengaduan tersedia.
- Observability, backup/restore, insiden, dan runbook support teruji.

**PIVOT**

- Onboarding mandiri gagal tapi assisted onboarding berhasil → sederhanakan
  wizard, perkuat pendampingan.
- Trafik pencarian ada tapi interaksi kontak rendah → perbaiki relevansi, isi
  kartu, dan CTA sebelum menambah fitur.
- Klik affiliate tinggi tapi konversi disetujui rendah → perbaiki atribusi,
  penawaran, dan kebijakan fraud sebelum menaikkan komisi.

**PAUSE**

- Sesi/tenant context masih bisa dimanipulasi browser.
- Otorisasi lintas merchant belum dibuktikan test.
- Respons privat masih bisa masuk cache/sitemap.
- Komisi/payout belum punya ledger, hold, refund, pajak, dan maker-checker.
- Klasifikasi regulasi dan terms belum disetujui.
- UAT kritis atau alur aksesibilitas gagal.

**STOP / NOT YET**

- Checkout marketplace, escrow, logistik, wallet, atau transaksi multi-merchant
  sebelum PMF dan kesiapan operasional.
- Microservices, multi-region, aplikasi native, atau AI kompleks tanpa kebutuhan
  terkuantifikasi.
- Fitur tanpa owner, kontrak API, lifecycle, permission, audit, KPI, dan exit
  criteria.

## 6. Standar

| Area                 | Baseline (per 29 Juli 2026)                                                           |
| -------------------- | ------------------------------------------------------------------------------------- |
| Application security | ISO/IEC 27034-1:2011 + OWASP ASVS 5.0                                                 |
| API security         | OWASP API Security Top 10:2023 + suite test otorisasi                                 |
| ISMS                 | ISO/IEC 27001:2022 (Amd 1:2024), panduan kontrol ISO/IEC 27002:2022                   |
| Risiko               | ISO/IEC 27005:2022                                                                    |
| Privasi              | ISO/IEC 27701:2025                                                                    |
| PII cloud            | ISO/IEC 27018:2025                                                                    |
| Keamanan cloud       | ISO/IEC 27017 — **transition watch** (edisi 2026 dalam proses saat validasi)          |
| Evaluasi keamanan    | ISO/IEC 15408 Parts 1–5:2026, **hanya** untuk komponen kritis (session/authorization) |
| Aksesibilitas        | WCAG 2.2 AA / ISO/IEC 40500:2025                                                      |
| Kualitas produk      | ISO/IEC 25010:2023; requirement & traceability ISO/IEC/IEEE 29148:2018                |
| AI                   | ISO/IEC 42001:2023 — hanya bila AI menjadi komponen material bagi keputusan/risiko    |

**Batas pemakaian Common Criteria.** ISO/IEC 15408 bukan checklist UI dan bukan
pengganti 27001/ASVS. Dipakai sebagai konsep (Target of Evaluation, Security
Target, assurance evidence) pada komponen sesi/otorisasi. **Tidak ada klaim EAL
atau "Common Criteria certified"**, dan tidak ada klaim sertifikasi ISO apa pun
di produk maupun dokumen pemasaran.

## 7. Regulasi Indonesia

| Regulasi                           | Relevansi                                                  | Tindakan                                                                                         |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| UU 27/2022 (PDP)                   | Hak subjek, dasar pemrosesan, controller/processor, breach | ROPA, privacy notice, consent, alur DSR, retensi, klausul processor, proses insiden              |
| UU 1/2024 (perubahan kedua UU ITE) | Informasi & transaksi elektronik                           | Review legal terms, alat bukti, konten dilarang, kontrak elektronik                              |
| PP 71/2019 (PSTE)                  | Keandalan & keamanan sistem elektronik                     | Asesmen PSE, kontrol keamanan, auditability, kontinuitas                                         |
| Permenkominfo 5/2020 jo. 10/2021   | PSE lingkup privat                                         | Validasi kewajiban pendaftaran & operasi sebelum launch                                          |
| PP 80/2019 (PMSE)                  | Perdagangan melalui sistem elektronik                      | Pemetaan model bisnis, informasi merchant, kontrak, komplain, rekaman                            |
| Permendag 19/2026                  | Model bisnis PPMSE, iklan, produk domestik, AI, pengawasan | Klasifikasi hukum berdasar fitur produksi; update terms, merchant agreement, kebijakan affiliate |
| UU 8/1999 (Perlindungan Konsumen)  | Informasi, keadilan, komplain, klausul dilarang            | Harga jelas, bukti klaim, proses komplain/refund, tanpa dark pattern                             |

**Klasifikasi PMSE tidak boleh diasumsikan dari branding.** Karena fase awal
bukan marketplace penuh dan transaksi bisa diarahkan ke kanal merchant,
Finance/Risk/Compliance membuat memo legal berdasarkan **fitur produksi nyata**:
alur transaksi, iklan, affiliate, pembayaran, dan peran platform terhadap
merchant/konsumen.

## 8. Checklist acceptance

**Arsitektur** — ADR disetujui · `awcms` origin privat · adapter SSR terpasang ·
rollback ke static terdokumentasi · matriks rendering diuji.

**Identity & access** — tanpa token di storage browser · cookie HttpOnly/Secure ·
proteksi CSRF · tenant server-derived · rotasi/revokasi sesi · negative auth test.

**Data** — RLS FORCE pada tabel tenant · ABAC kepemilikan merchant · masking
field · retensi & legal hold · correlation ID di audit · idempotency pada mutasi
kritis.

**UI/UX** — design token · seluruh state (empty/error/loading) · alur keyboard ·
WCAG 2.2 AA · mobile 360 px · tanpa placeholder · copy/klaim disetujui.

**Operasi** — monitoring · alerting · runbook · backup restore · latihan insiden ·
SLA support · alur komplain.

**Komersial/affiliate** — entitlement paket · invoice sebagai sumber kebenaran ·
ledger komisi · holding period · refund/dispute · larangan self-referral ·
maker-checker payout.

**Legal/privasi** — asesmen PSE · klasifikasi PMSE · privacy notice · versioning
terms · merchant agreement · kebijakan affiliate · alur permintaan subjek data.
