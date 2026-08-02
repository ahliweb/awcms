# ADR-0055 — Pengembangan AWCMS hanya di `ahliweb/awcms` dan `ahliweb/awcms-astro`

- **Status:** Accepted
- **Tanggal:** 2026-08-02
- **Pengambil keputusan:** @ahliweb
- **Men-supersede:** [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) — yang membekukan `awcms-mini`/`awcms-micro` sebagai **referensi yang boleh di-port keluar**. ADR ini menutup jalur itu juga.
- **Menyempurnakan:** [ADR-0001](0001-rebuild-on-awcms-foundation-erp-scope.md) (awcms dibangun di atas standar awcms-mini) dan [ADR-0032](0032-family-compatibility-manifest-and-ci-conformance.md) (manifest kompatibilitas keluarga) — keduanya berporos pada `awcms-mini` sebagai STANDAR; poros itu dicabut.
- **Terkait:** [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md), [ADR-0051](0051-admin-screens-consolidated-in-awcms.md)

## Konteks

ADR-0047 membekukan `awcms-mini` dan `awcms-micro` sebagai **referensi**: tidak menerima perubahan, tetapi masih boleh dibaca dan **di-port keluar**. Empat bulan berjalan, posisi setengah itu punya biaya yang nyata:

1. **Dokumen dan gerbang masih memperlakukan `awcms-mini` sebagai STANDAR.** `awcms-family-compatibility.yaml` menyatakan `standard: awcms-mini`, dan sembilan entri `intentionalDivergences` harus **di-review ulang secara berkala** — masing-masing dengan `reviewDate` yang, bila lewat, memerahkan CI. Artinya repo ini dijadwalkan untuk terus-menerus membenarkan perbedaannya terhadap repo yang tak seorang pun kembangkan lagi.
2. **Backlog berporos pada port yang tak akan terjadi.** `docs/PROJECT_STATE.md` masih mendaftar "serap tulang punggung awcms-mini" dan "klaster SaaS control plane (7 modul mini) belum di-admit". Itu membingkai pekerjaan sebagai **memindahkan** kode yang sudah ada, padahal keputusannya sebenarnya adalah **membangun** kemampuan di sini, dengan ADR admission-nya sendiri.
3. **Aturan yang benar sudah dijalankan dalam praktik.** `idn_admin_regions` (ADR-0046), kredensial mesin (ADR-0049), permission ber-scope platform (ADR-0053), dan provisioning tenant (ADR-0054) semuanya **dirintis langsung di sini**. Tidak satu pun berasal dari mini. Aturan tertulisnya tertinggal dari cara kerja sebenarnya.

## Keputusan

**Pengembangan AWCMS berlangsung di dua repositori, dan hanya dua:**

| Repo                                                            | Peran                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`ahliweb/awcms`](https://github.com/ahliweb/awcms)             | **System of record** — modular monolith, seluruh permukaan otorisasi, API, dan seluruh layar admin (ADR-0051) |
| [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) | **Experience layer + BFF** (ADR-0045) — situs publik dan proksi sesi; tak pernah menjadi sumber kebenaran     |

Konsekuensinya, dinyatakan eksplisit:

1. **`awcms-mini` dan `awcms-micro` adalah ARSIP.** Bukan standar, bukan sumber port, bukan template keluarga. Ia boleh dibaca sebagai referensi sejarah — sama seperti membaca commit lama — tetapi tidak ada pekerjaan yang dijadwalkan "di-port dari" sana. Kemampuan yang diinginkan **dibangun di sini**, dengan ADR admission-nya sendiri, dinilai dari kebutuhan hari ini alih-alih dari apa yang kebetulan sudah ada di repo lain.
2. **Tidak ada standar keluarga eksternal.** `awcms` mendefinisikan kontraknya sendiri. `awcms-family-compatibility.yaml` **tetap ada dan tetap ter-gate** — bagian yang bergigi (23 pemeriksaan versi kontrak diadu dengan konstanta sumber nyata) justru yang paling berguna — tetapi ia kini menyatakan kontrak **antara `awcms` dan `awcms-astro`**, bukan konformansi kepada repo pihak ketiga.
3. **Daftar `intentionalDivergences` (sembilan entri) dikosongkan, isinya dipindah menjadi catatan sejarah** di [`family-compatibility.md`](../awcms/family-compatibility.md). Alasannya bukan bahwa keputusannya tidak penting — justru sebaliknya, karena itu ia dipertahankan sebagai prosa dengan tautan ADR yang `check:docs` verifikasi keberadaannya. Yang dicabut adalah **kewajiban me-review ulang** perbedaan terhadap arsip: itu pekerjaan berulang yang jawabannya tidak akan pernah berubah.
4. **Kewajiban "catat sebagai divergence saat mendarat" (ADR-0047 §4) dicabut**, digantikan yang sudah berlaku: **fitur fondasi wajib punya ADR**. ADR adalah catatannya; divergence-nya dulu hanya duplikat yang harus dijaga sinkron.
5. **Penjagaan ADR-0047 §3 yang lain TETAP** dan tidak dilonggarkan sedikit pun: security review tambahan untuk `auth`/`access`/`sync`, `bun run check` penuh sebelum PR, OpenAPI/AsyncAPI sinkron, RLS `FORCE`, ABAC default-deny, migrasi terapan immutable.

## Konsekuensi

- **Positif:**
  - Aturan tertulis akhirnya cocok dengan cara kerja nyata. Empat fitur terakhir dirintis di sini; sekarang itu jalur yang benar, bukan pengecualian.
  - Backlog berhenti berbohong. "Port 7 modul SaaS dari mini" menjadi "putuskan control plane apa yang dibutuhkan, lalu bangun" — pertanyaan berbeda, dengan jawaban yang mungkin berbeda.
  - Tidak ada lagi CI merah terjadwal untuk membenarkan perbedaan terhadap arsip.
- **Negatif / trade-off yang diterima:**
  - **Kode matang di `awcms-mini` tidak lagi otomatis "gratis".** Modul seperti `document_infrastructure` atau `integration_hub` harus dinilai ulang dan ditulis, bukan disalin. Itu memang lebih mahal — dan itu harganya untuk berhenti mewarisi keputusan yang dibuat untuk produk lain.
  - Lima ADR di repo ini (`0016`–`0019`, `0021`) sudah `Accepted` untuk modul yang tak pernah punya kode di sini dan berporos pada port dari mini. ADR ini **tidak** mencabutnya satu per satu — masing-masing butuh keputusannya sendiri — tetapi mencatat bahwa dasar "port dari mini" mereka sudah gugur.
- **Netral:**
  - Nol perubahan kode berjalan. Ini keputusan tata kelola; gerbang teknis yang bergigi tetap utuh.

## Alternatif yang dipertimbangkan

- **Pertahankan ADR-0047 apa adanya (beku tapi boleh di-port keluar)** — ditolak: itu posisi yang sekarang, dan biayanya persis §Konteks butir 1–2. "Boleh di-port" membuat setiap dokumen dan gerbang harus terus memelihara hubungan dengan repo yang tidak bergerak.
- **Hapus manifest kompatibilitas sepenuhnya** — ditolak: 23 pemeriksaan versi kontraknya diadu dengan konstanta sumber NYATA dan sudah beberapa kali menangkap drift. Yang bermasalah adalah porosnya, bukan mekanismenya.
- **Arsipkan `awcms-mini`/`awcms-micro` di GitHub (repo read-only)** — tidak diputuskan di sini; itu tindakan operasional yang boleh menyusul. ADR ini mengatur ke mana pekerjaan pergi, bukan setelan repo.
