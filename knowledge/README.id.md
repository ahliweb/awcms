🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:87fcf8b48a8ca41135832bd07e03772124b4a1d5af8e6875aeac3c21263e4a9e -->

# `knowledge/` — basis pengetahuan developer yang opsional

Direktori ini adalah **vault Obsidian khusus** (ADR-0124), untuk developer
yang ingin tampilan pengetahuan teknik AWCMS yang bisa dinavigasi sebagai
graf. Sifatnya **sepenuhnya opsional**: tidak ada apa pun di `bun run check`,
CI, atau aplikasi yang bergantung padanya, dan tidak ada kontributor yang
diwajibkan menginstal atau membuka Obsidian. Jika kamu belum pernah dengar
Obsidian, kamu bisa mengabaikan direktori ini sepenuhnya — sistem catatan
repository tetap kode, `docs/`, dan `docs/adr/`, persis seperti sebelumnya.

Dua aturan mengatur segala sesuatu di sini, dan keduanya ditegakkan oleh test
(`tests/knowledge-obsidian-sync.test.ts`) dan desain fail-closed sync wrapper,
tidak hanya didokumentasikan:

1. **`knowledge/curated/` hasil kurasi manusia dan Graphify tidak pernah menulis ke sana.**
2. **`knowledge/generated/` dibuat mesin dan tidak ada yang menyuntingnya dengan tangan.**

```text
knowledge/
├── README.md              # berkas ini
├── curated/                # catatan indeks/overlay kecil hasil kurasi manusia
│   ├── project-map.md
│   ├── architecture-index.md
│   ├── security-index.md
│   ├── decisions-index.md
│   └── lessons-learned.md
└── generated/               # digitignore kecuali catatan ini; dibangun ulang sesuai permintaan
    ├── README.md
    └── graphify/            # disinkron dari graphify-out/obsidian-staging/
        ├── PROVENANCE.md    # versi tool, commit sumber, timestamp ekspor
        └── ...              # satu catatan per node/community graf
```

## Kenapa vault khusus, bukan root repository

ADR-0124 mengevaluasi membuka root repository sendiri sebagai vault Obsidian
(dengan exclusion ketat) dibanding vault `knowledge/` khusus, dan memilih
vault khusus. Baca ADR untuk analisis lengkapnya; singkatnya: vault root akan
mengindeks ratusan ribu berkas source/build/dependency yang tidak ada
hubungannya dengan pengetahuan yang bisa dinavigasi, akan butuh daftar
exclusion yang terus membesar untuk melawan pertempuran yang sudah dilawan
`.gitignore`/`.graphifyignore` untuk tujuan berbeda, dan akan menaruh state
workspace Obsidian sendiri (`.obsidian/`) di root repository di mana ia jauh
lebih mungkin ter-commit tidak sengaja. Vault khusus berukuran kecil,
direktori `.obsidian/`-nya sepenuhnya di-gitignore (lihat `.gitignore`), dan
ia tidak pernah bersaing dengan tooling build/check repository yang
sebenarnya untuk mendapat perhatian.

## Bagaimana konten sampai ke sini

1. **Catatan kurasi** ditulis langsung oleh developer, dengan tangan, sebagai
   berkas Markdown kecil di bawah `knowledge/curated/`. Mereka menunjuk balik
   ke berkas kanonik (ADR, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`,
   `SECURITY.md`, kode) alih-alih menceritakan ulang — **jangan menyalin atau
   memigrasikan ADR/PRD/kontrak/dokumen teknis kanonik ke direktori ini.**
   Kode, SQL, kontrak, test, dan dokumen kanonik tetap otoritatif; catatan
   kurasi yang melenceng dari yang ditunjuknya adalah bug pada catatan itu,
   bukan sumber kebenaran kedua.

2. **Catatan hasil generate** sampai ke `knowledge/generated/graphify/` hanya
   melalui `bun run knowledge:obsidian:export`, yaitu sync deterministik,
   fail-closed (`scripts/knowledge-obsidian-sync.ts`) dari path staging
   terisolasi (`graphify-out/obsidian-staging/`, sendiri di-gitignore) —
   tidak pernah langsung dari Graphify, dan tidak pernah menyentuh
   `knowledge/curated/`. Lihat `docs/awcms/knowledge-graph.md` §Alur kerja
   Obsidian untuk pipeline lengkap dan jaminan keamanannya (path traversal,
   tipe berkas tak terduga, collision nama berkas, dan state yang tak bisa
   dibangun ulang semuanya membuat sync gagal secara fail-closed).

## Membaca catatan hasil generate

Setiap catatan hasil generate adalah hipotesis Graphify sendiri tentang basis
kode, dibangun dengan cara yang sama seperti `graphify-out/graph.json` —
lihat `docs/awcms/knowledge-graph.md` untuk aturan "peta, bukan wilayahnya"
yang mengatur segala sesuatu yang dikatakan graf. `PROVENANCE.md` di
`knowledge/generated/graphify/` mencatat dari commit mana graf yang
mendasarinya dibangun dan kapan catatan itu terakhir disinkron; catatan tanpa
baris provenance yang baru dan terverifikasi adalah petunjuk untuk dicek
terhadap kode, bukan fakta untuk dikutip.

## Membuka vault

Arahkan "Open folder as vault" Obsidian ke `knowledge/` (bukan root
repository). Tidak ada community plugin yang dibutuhkan untuk alur kerja
baseline.

## State Obsidian pribadi

Jika kamu membuka `knowledge/` di Obsidian, state workspace/plugin/UI-mu
sendiri hidup di `knowledge/.obsidian/`, yang di-gitignore sepenuhnya (lihat
`.gitignore` dan ADR-0124) — tidak ada baseline `.obsidian/` yang di-commit
sama sekali. Jangan commit layout workspace pribadi, hotkey, atau cache
plugin milikmu.

## Aturan untuk agent (termasuk yang ini)

Utamakan `graphify query`/`path`/`explain` dibanding memuat konteks luas saat
itu secara material mengurangi ukuran konteks, untuk discovery dan analisis
dampak. Perlakukan setiap temuan graf sebagai **hipotesis** yang diverifikasi
terhadap kode/`sql/`/`bun run check` — tidak pernah sebagai otoritas
implementasi dengan sendirinya. Jangan pernah menyunting
`knowledge/generated/graphify/` dengan tangan; ia dibangun ulang, bukan
disunting.
