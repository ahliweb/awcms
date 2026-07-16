# ADR-0024 — Penomoran SemVer melanjutkan lini major legacy (lompat ke 5.0.0), bukan reset ke 1.0.0

- **Status:** Accepted
- **Tanggal:** 2026-07-16
- **Pengambil keputusan:** @ahliweb
- **Terkait:** ADR-0001 (rebuild), ADR-0022 (basis untuk ERP, bukan ERP), `docs/awcms/release-process.md` §baris 3 (menandai keputusan ini sebagai terbuka sebelum ADR ini), `.changeset/config.json`, `CHANGELOG.md`

## Konteks

`package.json` repo ini dimulai dari `0.1.0` saat fondasi ditulis ulang dari nol (ADR-0001). Namun GitHub Releases repo ini (`github.com/ahliweb/awcms/releases`) masih menyimpan riwayat tag dari kodebase **legacy** (sebelum `chore(foundation): remove legacy repository files`): `2.9.9`, `2.12.0`, `3.0.0`, `3.1.0`, `4.0.0`, `4.1.1`, `4.3.1`, `4.5.0`, hingga `4.6.0` (semua ditandai Pre-release, isinya murni bump dependency oleh dependabot di struktur multi-app lama — `awcms-public`, `awcms-mcp`, dst. — yang sudah tidak ada di `main` sekarang).

`docs/awcms/release-process.md` (ditulis sebelum ADR ini) secara eksplisit menandai ini sebagai keputusan yang belum diambil: _"rilis pertama `awcms` (`v0.1.0` atau `v1.0.0`, tergantung kebijakan versi awal yang disepakati)"_ — draft dokumen itu sendiri tidak mempertimbangkan opsi ketiga (melanjutkan nomor `v4.x` lama), karena ditulis sebelum realisasi bahwa tag legacy `v4.6.0` masih ada dan terlihat publik di halaman Releases.

Masalah konkretnya: bila rilis pertama repo yang sudah ditulis ulang total ini diberi nomor `0.1.0` atau bahkan `1.0.0`, seseorang yang membandingkan dengan tag `v4.6.0` yang sudah ada (dan masih terlihat sebagai rilis "terbaru" secara historis) akan salah baca urutan versi sebagai kemunduran (downgrade), padahal ini justru penulisan ulang total yang lebih maju.

## Keputusan

Kami memutuskan:

1. **Nomor versi package.json dilompat manual dari `0.2.0` ke `5.0.0`** — bukan hasil komputasi `bun run changeset:version` (tool changesets hanya bisa menambah dari versi saat ini per level bump changeset, tidak bisa "lompat ke versi tertentu"). Ini melanjutkan lini major dari tag legacy terakhir (`v4.6.0`) ke major berikutnya (`5.0.0`), konsisten dengan makna SemVer: rebuild total adalah breaking change yang layak menaikkan major version, dan `5.0.0` adalah major berikutnya setelah `4.x`.

2. **`5.0.0` TIDAK menyatakan kompatibilitas apa pun dengan rilis legacy `v2.x`–`v4.x`.** Ini bukan "AWCMS v4.6.0 plus fitur baru" — seluruh kodebase ditulis ulang dari nol di atas fondasi baru (Bun-only, Astro 7, PostgreSQL/RLS, modular monolith; ADR-0001) dengan skop yang juga berubah (basis untuk ERP, bukan ERP itu sendiri; ADR-0022). Kontinuitas nomor semata-mata untuk **identitas produk** (menghindari kesan mundur), bukan klaim kompatibilitas API/data/deployment.

3. **Lompatan ini dicatat manual di `CHANGELOG.md`** (bukan lewat entry ter-generate `changeset version`) sebagai section `## 5.0.0` yang menjelaskan lompatan ini secara eksplisit, dengan tautan ke ADR ini. Changeset yang sudah pending sebelum lompatan ini (perbaikan CI, docs dwibahasa, bump dependency) dikonsumsi secara normal lebih dulu (`0.1.0` → `0.2.0`) sebelum lompatan manual dilakukan — supaya catatan perubahan nyata itu tidak hilang begitu saja ditimpa lompatan nomor.

4. **Belum ada git tag atau GitHub Release untuk `5.0.0`.** `.github/workflows/release.yml` (pipeline SBOM ganda, keyless signing, provenance, publish — didesain di `docs/awcms/release-process.md`) belum diimplementasikan. Membuat tag/release publik sekarang tanpa pipeline itu berarti melewati gate kualitas yang sudah didesain repo ini untuk dirinya sendiri (validate job, SBOM, signing, environment approval) — ditolak. `5.0.0` untuk saat ini murni angka di `package.json`/`CHANGELOG.md`, bukan rilis publik yang bisa ditarik (pull) siapa pun.

5. **`docs/awcms/release-process.md` baris 3 diperbarui** untuk mereferensikan ADR ini sebagai keputusan yang sudah diambil, menggantikan frasa "tergantung kebijakan versi awal yang disepakati".

## Konsekuensi

- **Positif:** riwayat versi publik di GitHub Releases tidak pernah terlihat mundur; identitas produk "AWCMS" tetap satu garis lurus meski kodenya ditulis ulang total; keputusan yang sebelumnya ditandai terbuka di `release-process.md` sekarang terjawab dan tercatat.
- **Trade-off:** ada "lubang" nomor versi (`0.2.0` → `5.0.0` langsung, tidak ada `1.x`–`4.x` yang benar-benar dirilis dari kodebase baru) yang harus dijelaskan ke pembaca changelog baru — sudah dimitigasi lewat catatan eksplisit di section `## 5.0.0` `CHANGELOG.md` dan ADR ini sendiri.
- **Netral:** mulai `5.0.0`, seluruh bump versi berikutnya kembali memakai alur normal `bun run changeset:version` (increment dari `5.0.0` per level bump changeset) — lompatan manual ini adalah kejadian satu kali, bukan pola berulang.

## Alternatif yang dipertimbangkan

- **Reset ke `1.0.0`** — ditolak (meski sempat jadi opsi yang dipertimbangkan): konsisten dengan framing "ditulis ulang dari nol", tapi berisiko dibaca sebagai downgrade dari `v4.6.0` yang sudah publik oleh siapa pun yang membandingkan nomor tanpa konteks penuh riwayat rebuild.
- **Tetap di `0.1.0`/`0.2.0` (SemVer 0.x, "belum stabil")** — ditolak untuk saat ini: paling jujur soal status implementasi (baru fondasi Sprint 1–2, belum ada modul ERP), tapi tidak menjawab masalah konkret kesan-mundur terhadap `v4.6.0` yang mendorong keputusan ini. Catatan: keputusan ini TIDAK mengklaim fondasi sudah "stabil" pada `5.0.0` — kematangan modul tetap dinilai lewat mekanisme independen (`status: experimental|active` per modul, ADR-0008), bukan lewat angka major package.
- **Buat tag/GitHub Release `v5.0.0` sekarang juga** — ditolak: `release.yml` belum ada; publish tanpa SBOM/signing/provenance/gate approval yang sudah didesain repo ini sendiri (`docs/awcms/release-process.md`) melanggar proses yang justru baru saja ditegaskan sebagai wajib.
