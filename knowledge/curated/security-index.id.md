🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](security-index.md)

<!-- i18n-source-hash: sha256:a1a5b0d7a45141f6bf9ca6395387cffad4650be430626d8e510884080c5a0b4b -->

# Indeks keamanan

Penunjuk ke postur keamanan, bukan menceritakan ulang.

- **Aturan baseline (RBAC/ABAC default-deny, RLS, idempotency, audit,
  masking):** [`../../AGENTS.md`](../../AGENTS.md) §"Aturan wajib".
- **Chokepoint otorisasi (setiap route terproteksi WAJIB lewat keduanya):**
  ADR-0003, ADR-0004, ADR-0063 —
  [`../../docs/adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md`](../../docs/adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md).
- **Pelaporan kerentanan:** [`../../SECURITY.md`](../../SECURITY.md).
- **Modul sensitif yang butuh review tambahan sebelum merge:** `auth`,
  `access`, `sync`, `finance`, `hr-payroll` — lihat
  [`../../AGENTS.md`](../../AGENTS.md) §"Guardrail keamanan".
- **Threat model khusus knowledge-graph** (secret tak sengaja terindeks,
  semantic extraction mengirim dokumen ke provider eksternal, query
  log/cache membocorkan konteks, graf basi diperlakukan sebagai kebenaran,
  prompt-injection lewat teks repo tak terpercaya, ekspor Obsidian menimpa
  catatan kurasi):
  [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  §Keamanan dan privasi, dan ADR-0124.
