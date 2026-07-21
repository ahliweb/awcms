---
"awcms": patch
---

docs: sinkronkan dokumentasi & skill dengan kode/DB (aftermath ADR-0034) + dokumen kontinuasi

Menyelaraskan docs non-gate dan skill dengan realita repo (11 modul, 34 migrasi, jalur aplikasi-turunan dihapus, port #179–186 landing):

- **docs/ARCHITECTURE.md**: 10→11 modul (+theming), sql/023→034, §Komposisi ditulis ulang tanpa jalur turunan (`application-registry.ts`/`extension:check`/namespace 900); fakta diperbarui — MFA/OIDC/SSO/Turnstile & ABAC-dinamis/business-scope/SoD dari "belum ada" → "sudah live"; OpenAPI bundler & theming dipindah dari gap.
- **docs/awcms & docs/adr** (12 file): repo-inventory & doc 13 (angka modul/migrasi), extension-compatibility-policy (banner DEPRECATED), api-contribution-guide & 09_roadmap & release-process (framing/tooling turunan dicabut), collision slot `sql/033` (kini theming) di ADR-0003/0010, path fixture `derived-application-example`→`example-domain-modules`.
- **.claude/skills** (7 diedit + 1 baru): new-module (buang jalur turunan + ModuleType `derived`), erp-extension-readiness (BACAAN SAJA/HISTORIS), release & production-preflight (buang `extension:check`), codeql-triage (FP #6 historis), observability/integration (reframe "aplikasi turunan"), **skill baru `awcms-theming`**.
- **docs/PROJECT_STATE.md** (BARU): dokumen kontinuasi/handoff ter-versioning (model tata kelola, inventori, backlog, jebakan) + pointer dari AGENTS.md.

Tidak ada perubahan kode/sql/kontrak; `bun run check` penuh hijau.
