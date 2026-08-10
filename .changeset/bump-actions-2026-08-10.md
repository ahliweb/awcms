---
"awcms": patch
---

chore(actions): `codeql-action` 4.37.4 → 4.37.6 dan `attest-build-provenance` 4.1.1 → 4.2.2

Menggantikan tiga PR dependabot (#493, #494, #495) dengan satu.

**`codeql-action/init` dan `codeql-action/analyze` WAJIB satu PR.** Dependabot
memecahnya per-path, sehingga tiap PR memindahkan satu langkah ke SHA baru dan
meninggalkan pasangannya di SHA lama — dan CodeQL menolak jalan dengan
`init`/`analyze` yang tak sepadan. Keduanya di sini pindah ke SHA yang sama
(`5595ccaf…`), yang memang SHA yang diusulkan kedua PR itu.

Ini bukan preferensi gaya: dua PR yang masing-masing memerahkan `Analyze` tak
bisa di-merge berurutan, karena yang pertama merah **sampai** yang kedua
mendarat. Satu-satunya urutan yang hijau adalah satu PR.

`attest-build-provenance` dinaikkan di **dua** langkah `release.yml` sekaligus
(attest image + attest SBOM); membiarkan salah satunya berarti satu rilis
menandatangani dua artefak dengan dua versi penanda tangan.

Semua pin tetap SHA-pinned dengan komentar versi — bentuk yang sudah dipakai
seluruh workflow di repo ini, dan yang membuat tag yang dipindahkan tidak bisa
mengubah apa yang berjalan.
