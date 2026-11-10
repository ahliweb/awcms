🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](fastplaz-concepts.md)

<!-- i18n-source-hash: sha256:0c40ec1fc43a0d5404d40f1506a1d8468524fa15046076c690ee7fb7fad3be79 -->

# Backend/tooling modular AWCMS — konsep FastPlaz, arsitektur khusus repositori

## Kendali dokumen

- **Versi:** v1.0.0
- **Diperbarui:** 2026-11-10
- **Status:** Usulan arsitektur / riset saja; bukan fitur produksi.
- **Changeset dokumen:** Rujukan pertama dan pemetaan batas implementasi.
- **Isu pemilik:** [#1251](https://github.com/ahliweb/awcms/issues/1251).

## Ringkasan dan baseline lokal yang terkonfirmasi

Bun + Astro + PostgreSQL FORCE RLS; registry modular monolith yang sudah ada `src/modules/index.ts`, `awcms-new-module`, skill endpoint/migrasi/event, OpenAPI/AsyncAPI, audit, serta kendali tenant dan permission.

## Maksud dan kandidat adaptasi

Memperbaiki scaffolding modul yang sekarang lewat spesifikasi generasi yang deterministik dan dapat ditinjau. Rute API tetap di `src/pages/api/v1`; keluaran berupa usulan descriptor modul, kerangka domain/application/infrastructure, tes, permission, klasifikasi subject-data, fragmen OpenAPI, tautan AsyncAPI, dan usulan migrasi. Tidak pernah menulis langsung ke skema produksi.

## Otoritas dan larangan

AWCMS memiliki modul backend/domain. Konteks editor milik tool bawaan IDE. Hermes memiliki sesi agen. OMES memiliki operasi host. `apps/cms` AWCMS-One adalah subtree hilir; tidak ada generator duplikat di sana.

## Isu terkait yang sudah ada dan anti-duplikasi

Riset generator modul [#1251](https://github.com/ahliweb/awcms/issues/1251).

## Enam skenario validasi konkret

1. Modul inventori baru: ABAC ketat per rute, FORCE RLS, dan perintah pergerakan yang idempoten.
2. Modul konten situs baru: baca publik tidak dapat memutasi manajemen tenant/sistem.
3. Modul data pribadi: descriptor subjectData eksplisit dan kebijakan penghapusan.
4. Modul event domain: AsyncAPI/outbox, retry, replay, dan idempotency.
5. Konflik registrasi modul: tolak kunci duplikat, ID SQL yang sudah ada, atau prefiks rute.
6. Diagnostik agen: mengurai galat compiler/tes sambil mengecualikan `.env` dan kredensial.

## Usulan pemeriksaan dan bukti tes

Baca registry modul yang nyata; build/gerbang lewat `bun run check`, `family:conformance:check`, paritas rute/spesifikasi API, cakupan subject-data, tes keamanan dan tes negatif tenant. Jangan mengklaim hasil sebelum dijalankan.

## Peluncuran / serah terima

Inventarisasi skill generator dan skrip yang sudah ada; rancang skema spesifikasi, diff dry-run, dan perilaku tanpa-timpa; usulkan isu implementasi hanya setelah Gerbang 9.

## Rujukan sumber dan batasnya

Dokumen ini hanya mengambil **konsep** dari [FastPlaz](https://github.com/fastplaz/fastplaz): [MCP/AI Agent Plane](https://github.com/fastplaz/fastplaz/blob/master/docs/MCP.md), [alur kerja IDE](https://github.com/fastplaz/fastplaz/blob/master/docs/AI_AGENT_by_FASTPLAZ.md), dan [konsep operator standalone](https://github.com/fastplaz/fastplaz/blob/master/docs/STANDALONE-deployment.md). Tidak ada Pascal, Lazarus, CGI, mesin MVC/tema, atau penyalinan kode sumber. [Teks lisensi FastPlaz](https://github.com/fastplaz/fastplaz/blob/master/LICENSE.txt) tidak menunjukkan izin kode sumber yang eksplisit; implementasi independen saja.

## Invarian rekayasa lintas-portofolio

Menerapkan **standar lintas-portofolio internal**, berdampingan dengan AGENTS, ADR, CONTRIBUTING, dan kenyataan kode repositori ini. **Gerbang 9 (Definition of Ready lintas-spesifikasi)** yang disetujui manusia mendahului kode fitur produksi; **Gerbang 15 (kesiapan rilis)** yang disetujui manusia mendahului produksi. Satu isu/branch/PR per lingkup atomik. Jangan pernah menyajikan spesifikasi, pemeriksaan dokumentasi yang hijau, atau riset sebagai fungsi produksi yang berjalan.

Konektor MCP/tool lokal, bila kelak diperlukan: loopback atau IPC terautentikasi, pembatasan host/Origin untuk HTTP, kredensial berlingkup yang dirotasi, perlindungan path kanonik dan symlink, tingkat persetujuan baca/tulis/destruktif, tanpa shell bebas, tanpa akses SQL/DB mentah/secret secara default, sumber daya/waktu/pembatalan terbatas, kebijakan pada runtime tool/OS yang sebenarnya, unknown fail-closed, dan log teredaksi. Persetujuan manusia untuk perubahan otorisasi, konfigurasi produksi, atau data sensitif.

## Rujukan regulasi dan kendali yang relevan

Evaluasi keberlakuan, bukan kepatuhan lewat pernyataan: UU 27/2022 (PDP), PP 71/2019 (PSTE), Perpres 95/2018 bila SPBE berlaku; ISO/IEC 27001, 27002, 27005, 27017, 27018, 27034, 27701, ISO 22301, ISO/IEC 20000-1, ISO/IEC 42001, ISO/IEC 15408; OWASP LLM/Agentic Security, NIST AI RMF. Dapatkan bukti kendali independen dan edisi yang berlaku sebelum mengklaim sertifikasi apa pun.

## Rubrik bukti penerimaan

Untuk tindak lanjut apa pun: tautkan spesifikasi/ADR dan isu pemilik; catat commit sumber, versi toolchain/runtime, perintah yang dijalankan, galat/hasil yang sebenarnya, tes akses yang ditolak, dan SHA bukti. Tandai pemeriksaan yang tidak dijalankan sebagai **NOT EXECUTED**. Persetujuan dan status publikasi/deployment adalah hal yang berbeda. Tidak ada data pribadi sensitif atau secret produksi di prompt, log, atau artefak GitHub.

## Changelog

- **v1.0.0 — 2026-11-10:** Mendokumentasikan batas adopsi khusus repositori yang berbasis bukti, enam kasus praktis, dan rubrik penerimaan.
