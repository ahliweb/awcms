---
"awcms": minor
---

Media-library ownership inversion (ADR-0036, mengadaptasi awcms-micro ADR-0026 — `docs/adr/0036-media-library-module-admission-ownership-inversion.md`).

**CAPABILITY RETIREMENT (bukan bump minor kapabilitas):** capability `news_media` **dipensiunkan** dan digantikan `media_library`. Penyedianya berubah (`news_portal` → `media_library` baru) **dan** kontrak port kehilangan satu method (`isFullOnlineR2ModeActiveForTenant` → `isManagedMediaEnforcementActiveForTenant`; `resolveMediaPublicBaseUrl` di-drop). `_shared/capability-contract-versions.ts` + manifest `awcms-family-compatibility.yaml` menambah `media_library: "1.0.0"`; setiap konsumen yang dipin ke `news_media` harus gagal terang-terangan.

Perubahan NON-aditif — menyentuh modul yang sudah di-ship:

- **Modul baru `media_library`** (System Foundation, `type: system`, `isCore: false`, deps `[tenant_admin, identity_access]`): registry media `awcms_news_media_objects` (tabel TIDAK di-rename — FK komposit keras dari ad placements), presigned upload/finalize/cancel, MIME sniffing, verifikasi R2, job `news-media:reconcile` (nama command dipertahankan), plus penyalaan enforcement (`POST/GET /api/v1/media/enforcement`, satu arah, readiness-gated + audited).
- **`news_portal`** tidak lagi PROVIDES `news_media`; kini CONSUMES `media_library` (wajib) + `public_content`; basePath berubah ke `/api/v1/news-portal`; job reconcile & 9 permission media pindah keluar.
- **`blog_content`** consumes `media_library` (opsional, dulu `news_media`); adaptor no-op media vestigial dihapus; gate media & 12 composition-root handler + worker menyuntik `mediaLibraryPortAdapter`.
- **Migrasi (ADD-only, urutan load-bearing):** `052` repoint permission `news_portal.media.*` → `media_library.media.*` (INSERT→repoint grant→DELETE), `053` tabel `awcms_media_library_tenant_state` (RLS ENABLE+FORCE + backfill dari `awcms_news_portal_tenant_state`), `054` permission `media_library.enforcement.{read,enable}`.
- Fragment OpenAPI media dipindah ke `openapi/modules/media-library.openapi.yaml` (+ path enforcement); bundle + api-reference diregenerasi.

Diverifikasi terhadap PostgreSQL nyata: repoint permission bersih, RLS FORCE + isolasi tenant + fail-closed `awcms_app`, dan backfill lintas-tenant (role migrasi BYPASSRLS). Step 5b/5c/5d micro (`/admin/media`, srcset, PDF) ditunda.
