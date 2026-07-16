---
"awcms": minor
---

Tambah dukungan dokumentasi dwibahasa (ADR-0023): Bahasa Indonesia sebagai sumber otoritatif (`<nama>.id.md`), Inggris sebagai default yang tampil (`<nama>.md`). Diterapkan pada tiga dokumen pintu depan (`README.md` root, `docs/awcms/README.md`, `docs/adr/README.md`) plus `scripts/check-docs-translation.mjs` (gate staleness berbasis hash, masuk `bun run check` dan CI) yang mendeteksi saat sumber ID berubah tanpa terjemahan EN diregenerasi.
