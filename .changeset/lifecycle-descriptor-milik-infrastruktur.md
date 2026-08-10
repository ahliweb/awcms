---
"awcms": minor
---

feat(data-lifecycle): tabel milik infrastruktur bisa menjawab pertanyaan retensi — dan klasifikator kepemilikan yang memutuskan siapa boleh

`awcms_edge_cache_purges` duduk di `TABLES_PREDATING_THE_RULE` bukan karena
belum sempat, melainkan karena kontraknya tidak bisa menyatakannya: registry
mewajibkan `ownerModuleKey` sama dengan key modul yang mendeklarasikan, dan
tabel ini dimiliki `src/lib/edge-cache/` yang **sengaja** bukan modul.

Masalahnya bukan satu tabel yang lolos. Ledger itu tidak bisa membedakan tabel
yang **belum** dideskripsikan dari yang **tidak bisa** — keduanya satu baris —
sehingga hitungannya berhenti bisa dibaca sebagai hitungan utang.

**Satu koreksi terhadap premis Issue #479:** retensinya bukan tidak ada.
`bun run edge-cache:purge` sudah memangkas baris `done` di atas tujuh hari sejak
ADR-0042. Yang hilang adalah kemampuan **menyatakannya** — persis bentuk
`executionMode: "delegated"`, yang satu-satunya penghalangnya adalah kata
*module*.

**Registry kedua, bukan `ownerModuleKey` yang dilonggarkan** (ADR-0076).
`INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS` memakai `ownerPath` sebagai ganti key
modul. Melonggarkan field-nya akan menghemat satu berkas dan membuat setiap
deskriptor modul kehilangan penjagaannya: sebuah deskriptor yang **lupa**
menyebut pemilik berhenti menjadi kesalahan dan mulai berarti "infrastruktur" —
kesalahan ketik menjadi klaim kepemilikan.

**Yang menahannya jadi tempat parkir bukan paragraf.** `data-lifecycle:registry:check`
kini memindai `src/` dengan `ownerOfFile()` — fungsi yang sama yang dipakai
`modules:table-writes:check` — dan menolak deskriptor infrastruktur untuk tabel
yang penulisnya sebuah modul, untuk tabel yang tak ditulis siapa pun, dan untuk
key yang namespace-nya sebuah modul terdaftar. Kepemilikan yang salah menjadi
tak bisa dinyatakan, di kedua arah. Gerbangnya karena itu berhenti murni; itu
harga yang dibayar sadar.

**Dua perubahan perilaku ikut mendarat, karena tanpanya deskriptornya tidak benar:**

- baris `failed` kini dipangkas setelah **180 hari**. Sebelumnya disimpan
  selamanya dengan sengaja — dan alasannya benar, mereka satu-satunya jejak
  bahwa sebuah invalidasi tak pernah mendarat. Alasan itu membatasi umur
  **bergunanya**, bukan memperpanjangnya tanpa akhir: setelah enam bulan konten
  yang gagal diinvalidasi sudah kedaluwarsa ribuan kali;
- purge-nya kini menghormati **legal hold**, lewat `LegalHoldGuardPort` yang sama
  dengan tujuh adopter terdelegasi lain. Tanpa ini `legalHold.applicable: true`
  akan jadi deklarasi tanpa penegak.

`GET /api/v1/data-lifecycle/registry` mendapat array `infrastructureDescriptors`
(aditif) dan `/admin/data-lifecycle` mendapat kolom **Owner**; legal hold bisa
menargetkan key-nya dari API maupun konsol. `POST /dry-run` menjawab 400
ber-alasan alih-alih 404 "key tak dikenal" — planner-nya tak punya predikat
status, jadi angka apa pun yang ia hasilkan akan memuat baris yang purge tak
akan pernah sentuh.

**Tanpa migrasi:** `GRANT SELECT, UPDATE, DELETE` ke `awcms_worker` dan index
`(tenant_id, status, created_at)` sudah ada sejak `sql/068`.

Ledger utang turun 110 → 109. Empat mutasi dibuktikan **merah** sebelum diklaim:
legal hold dilucuti, prune `failed` diarahkan ke `completed_at` (kolom yang NULL
pada baris yang justru dituju), deskriptor infrastruktur untuk tabel milik modul,
dan registry dikosongkan setelah entri ledger dilepas.

Menutup #479.
