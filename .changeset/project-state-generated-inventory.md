---
"awcms": patch
---

Tabel inventori §2 `docs/PROJECT_STATE.md` kini di-generate dan digerbangi.

Tabel itu basi EMPAT kali dengan CI hijau — tiga di antaranya pada baris yang sama — dan blockquote-nya sendiri sudah menyimpulkan: pola ini berhenti hanya bila tabelnya di-generate. `bun run project-state:inventory:generate` menulis blok di antara marker `<!-- project-state-inventory:mulai/selesai -->`, dan `bun run project-state:inventory:check` di rantai `check` memerahkan CI bila ia basi (dibandingkan per-konten, bukan per-byte, supaya padding prettier bukan drift).

Baris LAMBAT di-generate: versi, jumlah modul, jumlah/rentang migrasi, ADR tertinggi + statusnya, layar admin + modul tanpa `navigation:`, jumlah/baris `.astro`, jumlah gerbang rantai `check`, `MODULE_CONTRACT_VERSION`. Baris CEPAT (changeset per tipe bump, commit sejak rilis) DIHAPUS angkanya — angka yang bergerak tiap commit di dokumen ter-versioning akan selalu basi, dan menggerbanginya memaksa tiap PR meregenerasi dokumen; sel nilainya kini menunjuk perintah di kolom kanan, yang dipertahankan (dan rentang `git rev-list`-nya ikut ter-generate dari versi `package.json`).

Gerbangnya mutation-proven di `tests/project-state-inventory.test.ts`: satu digit dimutasi di antara marker → check gagal dan menamai barisnya; marker hilang → gagal keras; dokumen nyata dibuktikan sinkron oleh test itu sendiri.
