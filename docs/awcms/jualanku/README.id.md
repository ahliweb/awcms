🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:56f97ed8916e582a5de8125df9a1f498ef67db114248c02c7ac323121e923d85 -->

# Jualanku.info — blueprint implementasi di `awcms`

> **Status berkas ini: RENCANA, bukan deskripsi kode.** Tidak ada satu pun modul
> `jualanku_*`, tabel `awcms_jualanku_*`, migrasi, rute, atau permission Jualanku
> yang sudah ada di repo ini per tanggal dokumen. Sumber kebenaran keadaan kode
> tetap `src/modules/index.ts`, `sql/`, dan `bun run check` — bila dokumen ini
> berbeda dari kode, **kode yang benar**.

Folder ini menerjemahkan dokumen validasi _"Validasi Arsitektur dan Standar —
Porting UI/UX Jualanku.info ke AWCMS dan AWCMS-Astro"_ v1.0 (PT TIM SIX,
29 Juli 2026, status `APPROVE WITH CORRECTIONS`) menjadi rancangan yang bisa
langsung dieksekusi di repo ini, **setelah dikoreksi terhadap kode nyata**.
Keputusannya sendiri tercatat di
[ADR-0045](../../adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md);
folder ini adalah detail rancangan di bawah keputusan itu.

Sisi experience layer (rendering, adapter, deployment, BFF) dirancang di repo
`ahliweb/awcms-astro`, karena perubahannya terjadi di sana.

## Peta dokumen

| Berkas                                                                         | Isi                                                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [01-arsitektur-porting.md](01-arsitektur-porting.md)                           | Pembagian lapisan, topologi, matriks rendering per permukaan, batas tanggung jawab BFF.                                           |
| [02-model-tenant-merchant-otorisasi.md](02-model-tenant-merchant-otorisasi.md) | Tenant vs merchant, merchant sebagai business scope, katalog role & permission, aturan ABAC, matriks negative-authorization test. |
| [03-bounded-context-dan-model-data.md](03-bounded-context-dan-model-data.md)   | Lima modul, draft `ModuleDescriptor`, kepemilikan tabel, ERD per konteks, aturan RLS & retensi.                                   |
| [04-kontrak-api.md](04-kontrak-api.md)                                         | Namespace public/portal/admin, inventaris endpoint, envelope, idempotency, pagination, fragmen OpenAPI.                           |
| [05-kontrak-sesi-dan-bff.md](05-kontrak-sesi-dan-bff.md)                       | Kontrak sesi lintas-origin, cookie/CSRF, penurunan tenant, rotasi & revokasi, model ancaman ringkas.                              |
| [06-porting-uiux.md](06-porting-uiux.md)                                       | Disposition matrix Elementor, design token, spesifikasi layar, komponen, aksesibilitas, i18n.                                     |
| [07-roadmap-gates-kepatuhan.md](07-roadmap-gates-kepatuhan.md)                 | Fase P0–P6, quality gate, KPI, RACI, kriteria go/pivot/pause/stop, standar & regulasi.                                            |
| [08-koreksi-dokumen-validasi.md](08-koreksi-dokumen-validasi.md)               | Setiap klaim dokumen validasi yang **tidak cocok** dengan kode repo ini, beserta bukti dan koreksinya.                            |

## Prasyarat sebelum baris kode pertama (P0)

Urutannya mengikat: setiap butir menghasilkan artefak yang dipakai butir
berikutnya.

1. **ADR-0045 diterima** (repo ini) dan **ADR rendering/BFF diterima** (repo
   `awcms-astro`). — _selesai bersama perubahan ini._
2. **Inventaris modul direkonsiliasi** sehingga `README.md`,
   [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md), dan
   [`docs/PROJECT_STATE.md`](../../PROJECT_STATE.md) menyebut daftar dan jumlah
   yang sama dengan `src/modules/index.ts`. — _selesai bersama perubahan ini._
3. **Kontrak sesi lintas-origin** ([05](05-kontrak-sesi-dan-bff.md)) disepakati,
   masuk OpenAPI, dan punya test — termasuk test negatif untuk CSRF dan origin.
4. **Model data merchant + business scope** ([02](02-model-tenant-merchant-otorisasi.md),
   [03](03-bounded-context-dan-model-data.md)) disepakati, lengkap dengan matriks
   negative-authorization yang harus merah sebelum kode ada.
5. **Lima `ModuleDescriptor` + kepemilikan tabel** dibekukan
   ([03](03-bounded-context-dan-model-data.md)) — module admission mengikuti
   [`../21_module_admission_governance.md`](../21_module_admission_governance.md):
   satu ADR admission per modul domain sebelum scaffold.

Baru setelah kelimanya tertutup, pekerjaan layar produksi dimulai — satu bounded
context per unit kerja, masing-masing membawa migrasi, seed permission, fragmen
OpenAPI, test (termasuk negatif), dokumen, dan changeset sendiri.

## Aturan yang mengikat implementasi

Diambil dari kontrak repo yang sudah berlaku, bukan aturan baru:

- **Modul domain hidup langsung di `src/modules/`** dan didaftarkan di
  `src/modules/index.ts` (ADR-0034). Tidak ada repo turunan, tidak ada registry
  ekstensi.
- **Setiap tabel tenant-scoped wajib `FORCE` RLS** dan hanya boleh ditulis modul
  pemiliknya (`bun run modules:table-writes:check`).
- **Setiap endpoint melewati `defineTenantRoute` + guard default-deny**, dan
  `resourceAttributes` untuk ABAC selalu dibaca dari baris nyata, tidak pernah
  dari body request (ADR-0033).
- **Permission baru = migrasi seed baru.** Descriptor modul saja tidak memberi
  permission ke tenant yang sudah ada; tenant lama tetap 403 sampai backfill-nya
  dijalankan.
- **Aksi high-risk wajib idempotency key + audit + decision log**, dan pasangan
  maker/checker-nya wajib dideklarasikan sebagai `sodRules` (ADR-0031).
- **Kontrak API modular**: satu fragmen OpenAPI per modul, di-bundle deterministik
  (ADR-0026). Endpoint tanpa fragmen tidak lulus `bun run api:spec:check`.
