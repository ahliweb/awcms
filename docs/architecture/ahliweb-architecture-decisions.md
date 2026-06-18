# Keputusan Arsitektur AhliWeb (ADR) — Berlaku untuk AWCMS

**Tujuan:** Ringkasan kanonik keputusan arsitektur product-line AWCMS (ADR-013…023) dengan **kolom keberlakuan per produk**, sehingga repo ini selaras dengan keputusan terbaru. **Source of truth** = repo `personal-coding`.

> **FOKUS REPO INI (AWCMS):** platform **multi-tenant**, platform core sendiri, **ERP modular ala Odoo** (ADR-017). **Current state** masih berbasis Supabase; **target (decided, migrasi berjalan)** = **PostgreSQL murni tanpa Supabase** (ADR-014). `awcms-edge` runtime = **Cloudflare Workers** (Bun tidak applicable). **EmDash = rujukan arsitektur saja** (bukan dependency).

---

## Document Control

| Field | Value |
|---|---|
| Status | Referensi (mirror dari personal-coding) |
| Source of truth | `ahliweb/personal-coding` |
| Berlaku untuk | `awcms` |
| Last updated | 2026-06-18 |
| Classification | internal |

---

## Matriks keberlakuan ADR per produk

| ADR | Keputusan | Micro | Mini | **AWCMS** |
|---|---|:---:|:---:|:---:|
| ADR-013 | Konektivitas PostgreSQL via **pooler OSS**; mode Session/Transaction | — (D1) | ✅ Session | ✅ **edge=Transaction + `prepare:false`** |
| ADR-014 | **PostgreSQL murni tanpa Supabase** | — (D1) | ✅ | ✅ **migrasi keluar Supabase** (#103) |
| ADR-015 | **RLS wajib** semua tabel tenant | — | ✅ | ✅ (port policy Supabase→RLS) |
| ADR-016 | SIKESRA & SatuSehatKobar = plugin di Mini | ✅ deprecate | ✅ host | — |
| ADR-017 | **AWCMS = platform modular ERP ala Odoo** | — | — | ✅ |
| ADR-018 | **Kontrak plugin/module manifest + data adapter** | ✅ D1/EmDash | ✅ PostgreSQL+RLS | ✅ module system |
| ADR-019 | **Toolchain + runtime Bun** | ❌ (EmDash/CF) | ✅ | ✅ **admin/public/mcp; `awcms-edge` tetap Workers** |
| ADR-020 | **EmDash = rujukan saja** (Mini/AWCMS) | ✅ full EmDash | ✅ rujukan saja | ✅ rujukan saja (CMS = modul native) |
| ADR-021 | **Logging Pino / Workers-native** | — | ✅ Pino | ✅ **Workers-native** (`awcms-edge/src/lib/logger.ts`) |
| ADR-022 | **Tiga rujukan arsitektur** (Supabase/Odoo/EmDash) | — | ✅ | ✅ |
| ADR-023 | **CQRS pencarian** (Tier 1 PostgreSQL; Tier 2 Kafka skala besar) | — | ✅ | ✅ (edge memanggil query service via API) |

Legenda: ✅ berlaku · — tidak relevan · ❌ sengaja tidak diberlakukan.

---

## Arah & aturan operasional repo ini (turunan ADR)

> **Penting:** dokumen stack lain mendeskripsikan *current state* (Supabase). Aturan di bawah = **target yang sudah diputuskan**; migrasi berjalan. Ikuti arah ini untuk kode baru.

1. **Off-Supabase → PostgreSQL murni** (ADR-014): inventaris `docs/architecture/supabase-usage-inventory.md`; epic #103 (#109 auth, #110 schema+RLS, #111 pooler). Tidak ada akses DB langsung dari browser — semua via API edge/backend.
2. **RLS wajib** (ADR-015): port policy Supabase ke RLS PostgreSQL murni (konteks sesi `set_config`).
3. **Pooler** (ADR-013): `awcms-edge` (Workers) = **Transaction mode + `prepare:false`**; backend Node = **Session mode**.
4. **Runtime Bun** (ADR-019): admin (Vite)/public (Astro)/`awcms-mcp` = Bun; **`awcms-edge` runtime tetap Cloudflare Workers (workerd)** — Bun bukan runtime di sana.
5. **EmDash = rujukan saja** (ADR-020): tidak ada dependency paket `emdash`; CMS = modul native bila perlu.
6. **Logging** (ADR-021): `awcms-edge/src/lib/logger.ts` (NDJSON + redaction), selaras format Pino.
7. **CQRS search** (ADR-023): query side read-only + read DTO + RLS/masking; `awcms-edge` memanggil query service via API. Tier 2 (Kafka/Debezium/OpenSearch) hanya saat skala besar.
8. **ERP modular** (ADR-017): fitur sebagai modul/app di atas framework bersama; record rules→RLS, ACL→RBAC/ABAC, Apps Store→marketplace.

---

## Referensi

- Source of truth: `ahliweb/personal-coding` — `docs/concepts/canvas-arsitektur-awcms-mini-awcms-emdash-pattern.md` (ADR penuh), `docs/ahliweb-repo-decision-log.md`, `docs/architecture/awcms-architecture-references.md` (tiga rujukan), `docs/architecture/awcms-cqrs-search.md`.
- Di repo ini: `SYSTEM_MODEL.md`, `AGENTS.md`, `docs/architecture/supabase-usage-inventory.md`.
