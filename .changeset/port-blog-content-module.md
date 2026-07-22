---
"awcms": minor
---

Port modul `blog_content` dari awcms-mini: manajemen blog/konten tenant-scoped (posts, pages, kategori/tag, riwayat revisi append-only, pencarian full-text, template/menu/widget/iklan presentasi, pengaturan blog, dan automatic internal tag linking). Menambahkan 6 migrasi baru (`sql/035`-`sql/040`, 15 tabel + seed 39 permission), ~40 route admin di `/api/v1/blog/*`, 7 route publik anonim di `/blog/{tenantCode}/...` (ADR-0009), job terjadwal `bun run blog:publish:scheduled`, serta fragment OpenAPI/AsyncAPI baru untuk modul ini.

Dua kapabilitas opsional modul ini (`news_media` dari `news_portal`, `social_publishing` dari `social_publishing`) belum punya provider nyata di base ini — setiap titik panggil memakai adapter no-op modul sendiri (mode full-online-R2-only selalu tidak aktif, hook social-publishing selalu no-op `{ jobsCreated: 0 }`), aman dan terdokumentasi, tanpa mengimpor modul yang belum ada. Keluarga rute `/news/**` (butuh modul `tenant_domain` yang belum di-port) sengaja tidak diikutkan di port ini.
