---
"awcms": minor
---

Reposisi governance AWCMS (ADR-0035, menyempurnakan positioning ADR-0034 — `docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md`): `awcms` kini diposisikan sebagai template **online-first hybrid** (online jalur utama; offline/LAN mode ketahanan), **siap ERP + SaaS terintegrasi**, dan **superset** keluarga yang **menyerap** klaster website/e-commerce, UI/UX, dan pengerasan auth `awcms-micro` langsung ke `src/modules/`. `awcms-mini` tetap hybrid offline-first (siap SaaS); `awcms-micro` tetap template website full-online ramping. Model tata kelola dipakai-langsung/tanpa-repo-turunan (ADR-0034 §2/§3) tidak berubah.

Perubahan dokumentasi/governance saja (tanpa perubahan kode runtime): ADR-0035 baru + banner supersede-parsial di ADR-0034; reposisi README/README.id/AGENTS/PROJECT_STATE + paket `docs/awcms/` (01/06/09/10/12/13/15, alur-pengembangan-mini-first, README index, api-contribution-guide); manifest `awcms-family-compatibility.yaml` (`role` + rasional divergence Turnstile diselaraskan ke mode hybrid); dokumen peta baru `docs/awcms/absorb-awcms-micro-roadmap.md` untuk penyerapan bertahap awcms-micro.
