---
"awcms": patch
---

Gerbang baru `data-lifecycle:table-coverage:check` (#437) — tabel baru tidak
bisa lagi mendarat tanpa menjawab pertanyaan retensi.

Rencananya menyebut gerbang atas tabel **volume-tinggi** yang daftarnya
DITURUNKAN, bukan ditulis tangan. Tiga cara menurunkannya dibangun dan diukur
terhadap skema ini, dan ketiganya gagal: _append-only di sumber_ (46 tabel —
`INSERT … ON CONFLICT DO UPDATE` terbaca sebagai append), _tanpa jalur hapus_
(94 tabel — repo ini memakai `ON DELETE CASCADE` di satu migrasi saja), dan
_tak-terbatas menurut skema_ (121 dari 128 — tabel terbatas yang nyata berkunci
pada teks terkurasi seperti `module_key`, yang tak bisa dibedakan dari nilai
bebas lewat DDL). Gerbang yang daftar pengecualiannya 90% skema adalah daftar
tulis-tangan yang menyamar.

Jadi pertanyaannya diganti. Alih-alih menurunkan tabel MANA yang volume-tinggi —
yang menuntut tahu bagaimana produknya dipakai — turunkan bahwa sebuah tabel
ADA, lalu buat kewajibannya mustahil dilewati. Tabel diambil dari `sql/` lewat
`deriveTableRlsStates`, fungsi yang sama yang dipakai `repo:inventory`, supaya
ada SATU jawaban untuk "tabel apa saja yang ada".

Tabel lolos lewat tiga jalan, dan tabel BARU hanya punya dua: deskriptor
`dataLifecycle`; `BOUNDED_BY_DESIGN` (**mulai kosong**, wajib beralasan); atau
`TABLES_PREDATING_THE_RULE` — 114 tabel yang sudah ada, hanya boleh MENYUSUT dan
tertutup untuk tabel baru. Entri ledger yang sudah punya deskriptor adalah
error, bukan duplikat yang ditoleransi, dan panjangnya dipatok test supaya entri
ke-115 tidak bisa bersembunyi di antara 114 lainnya.

Batasnya dinyatakan, bukan dibiarkan tersirat: ini tidak bisa memberi tahu bahwa
tabel LAMA di ledger sedang memakan disk. Itu pertanyaan tentang lalu lintas,
dan tempat jujurnya `security:readiness` terhadap basis data nyata.

Rantai `check` 37 → 38 segmen.
