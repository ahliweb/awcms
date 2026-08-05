# ADR-0069 — Selisih COOP/CORP dengan `awcms-astro` dicatat sebagai divergence

- **Status:** Accepted
- **Tanggal:** 2026-08-05
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md) (mekanisme pencatatan divergence keluarga), [ADR-0032](0032-family-compatibility-manifest-and-ci-conformance.md) (manifest kompatibilitas), `awcms-astro` ADR-0028 (postur standar repo itu; CORP terdaftar sebagai kontrol yang DITOLAK untuk template)

## Konteks

Penutupan celah C2 (4 Agustus 2026, commit `769292d7`) membuat repo ini
mengirim dua header isolasi lintas-origin pada **setiap** respons, tanpa
gerbang produksi:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

`awcms-astro` **tidak mengirim keduanya**, dan itu bukan kelalaian:

- **CORP ditolak eksplisit di sana** — "memblokir situs lain menyematkan
  gambar dari situs ini adalah keputusan yang bukan milik sebuah TEMPLATE"
  (daftar kontrol yang ditolak di dokumen standar repo itu, dikutip juga di
  ADR-0028-nya). Situs turunan yang menginginkannya menambahkannya lewat ADR
  di repo situsnya.
- **COOP tidak relevan pada permukaannya** — repo itu tidak punya sesi untuk
  dipagari; seluruh halamannya navigasi publik. Dokumen standar repo itu
  (dimutakhirkan PR #40 di sana) kini mencatat alasan repo ini "tidak menular
  ke sini" dengan kata-katanya sendiri.

Jadi selisihnya **disengaja di kedua sisi dan terdokumentasi di kedua sisi** —
tetapi belum tercatat di satu-satunya tempat yang punya tanggal tinjau dan
gerbang kedaluwarsa: `intentionalDivergences` di
[`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml).
Preseden ADR-0068 persis untuk kasus ini: selisih yang tidak tercatat akan
ditemukan ulang sebagai temuan dan "diperbaiki" ke arah paritas oleh orang
yang tidak memegang konteksnya. Celah **C15** di
[`standar-performa-dan-keamanan.md`](../awcms/standar-performa-dan-keamanan.md)
§9 menagih persis entri ini.

## Keputusan

1. Satu entri divergence baru `coop-corp-cross-origin-isolation` di
   `awcms-family-compatibility.yaml`, dengan `owner`, `reviewDate` 2027-02-04
   (satu kohort dengan tiga entri ADR-0068 supaya seluruh postur keluarga
   kembali ke meja pada tanggal yang sama), dan ADR ini sebagai `adr`-nya.
2. Arah paritas **tidak** diubah dari sini: repo ini terus mengirim keduanya;
   `awcms-astro` terus tidak mengirimnya. Bila sebuah situs turunan template
   itu membutuhkan COOP/CORP, keputusannya lahir di repo situs itu — bukan
   dengan menyalin nilai repo ini ke template.

## Konsekuensi

- `bun run family:conformance:check` kini menegakkan bahwa selisih ini punya
  pemilik dan tanggal tinjau; lewat tanggal itu tanpa peninjauan, CI merah.
- Celah C15 ditutup pada dokumen standar (baris tabelnya dipertahankan dengan
  status DITUTUP, sesuai aturan §9: baris yang dihapus akan diusulkan ulang
  sebagai temuan baru).
- Bagian klaim-keliru dari C15 sudah tertutup lebih dulu di repo sebelah
  (PR #40 di sana memperbaiki tabel headernya sebelum ADR ini ditulis);
  yang ADR ini tambahkan adalah pencatatan ber-tenggat di sisi pemilik
  manifest.
