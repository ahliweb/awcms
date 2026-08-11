---
"awcms": patch
---

Perbaiki lima instruksi operator yang tidak bisa jalan: `.env.example` gagal `config:validate`-nya sendiri, `docker exec … email:dispatch` pada image tanpa `scripts/`, `production:preflight` yang tidak ada, tag image ber-`v`, dan checkout migrasi dari `main` bukan tag rilis.
