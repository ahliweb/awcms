🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:884ee0e55de58760ff569e49538e42fc6831a3fa3b4388fd304057c48ec0df03 -->

# `knowledge/generated/` — ditulis mesin, disposable

Tidak ada apa pun di bawah direktori ini kecuali berkas ini yang di-track di
Git (lihat `.gitignore`: `knowledge/generated/*` dengan
`!knowledge/generated/README.md`). README ini sengaja tetap di-track supaya
direktorinya tidak terbaca kosong/hilang pada checkout baru — konten
sebenarnya dibangun ulang sesuai permintaan.

`graphify/` diisi oleh `bun run knowledge:obsidian:export`
(`scripts/knowledge-obsidian-sync.ts`), yang menyalin subset ber-allowlist
dari ekspor Obsidian Graphify di `graphify-out/obsidian-staging/`. Lihat
`../README.md` dan `docs/awcms/knowledge-graph.md` untuk pipeline lengkap,
jaminan fail-closed-nya, dan aturan "peta, bukan wilayahnya" yang mengatur
segala sesuatu yang ditulis Graphify di sini.

Tidak ada yang pernah disunting tangan di sini. Jika terlihat salah, hapus
dan jalankan ulang ekspornya — ia dibangun ulang dari `graphify-out/` dan
`knowledge/curated/` (hanya dibaca, untuk deteksi collision), tidak pernah
di-merge inkremental.
