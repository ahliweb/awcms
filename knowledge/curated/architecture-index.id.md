🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](architecture-index.md)

<!-- i18n-source-hash: sha256:a26f4426781be96aed8ab204b8c7dd0762a1819d5295b88bd580cc7c4d8b8b25 -->

# Indeks arsitektur

Di mana arsitektur sebenarnya hidup, dan bagaimana cara bertanya ke graf
tentangnya.

- **Deskripsi state-kini kanonik:** [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
- **Setiap keputusan arsitektural yang mengikat:** [`../../docs/adr/README.md`](../../docs/adr/README.md)
  (indeks seluruh ADR — jangan pernah salin konten ADR ke sini, tautkan saja).
- **Knowledge graph-nya:** `graphify-out/graph.json` (~12700 node pada rebuild
  terakhir — lihat [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  untuk angka terkini) adalah peta struktural hasil mesin. Query itu alih-alih
  membaca ulang seluruh tree:
  ```bash
  graphify query "<pertanyaan>"
  graphify path "<konsep A>" "<konsep B>"
  graphify explain "<node>"
  ```
  Baca [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  **sebelum** mempercayai sebuah temuan — graf mencampur "pernah benar" dengan
  "benar sekarang", dan kohesi rendah pada chokepoint yang disengaja (mis.
  `withTenant` + `authorizeInTransaction`) bukan cacat. Setiap klaim dari graf
  adalah hipotesis sampai dicek terhadap kode/`sql/`/`bun run check`.
- **Komposisi modul & urutan dependency:** `bun run modules:dag:check`,
  [`../../src/modules/module-management/README.md`](../../src/modules/module-management/README.md).
- **Tampilan Obsidian hasil generate dari graf** (opsional, bisa dibangun ulang):
  `knowledge/generated/graphify/` setelah `bun run knowledge:obsidian:export` —
  lihat [`../README.md`](../README.md).
