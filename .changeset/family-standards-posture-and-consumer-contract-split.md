---
"awcms": minor
---

Postur standar keluarga dan kontrak konsumen: tiga celah asesmen putaran kedua
ditutup, satu dinyatakan terblokir dengan alasan eksternal yang diverifikasi.

**Kontrak konsumen `awcms-astro` dipisah `CONSUMED` vs `COMMITTED`** (§9.5).
`CONSUMER_PATHS` semula membekukan enam permukaan karena diturunkan dengan
mem-grep repo sebelah **tanpa membuang komentar** — tiga di antaranya prosa: sebuah
docblock tipe, sebuah komentar yang menjelaskan kenapa build justru TIDAK memanggil
`/auth/session`, dan sebuah pesan error yang memberi tahu manusia cara menerbitkan
kredensial. Repo sebelah punya jawaban otoritatifnya dan menggerbanginya ("tepat
tiga permukaan", komentar dibuang lebih dulu). Kini tiga permukaan yang benar-benar
dipanggil dipisahkan dari dua yang **dijanjikan ADR** tetapi belum dipanggil
(`/auth/session`, `/access/machine-credentials` — keduanya milik BFF ADR-0050 yang
belum dibangun). `/api/v1/blog/posts/{id}` keluar dari kontrak sepenuhnya:
ADR-0018 di repo sebelah menghapus fetch per-id, jadi membekukannya mengikat repo
ini pada bentuk yang tak punya pembaca. Tiap entri `COMMITTED` wajib menyebut ADR
yang menjanjikannya, dan sebuah test menegakkan bahwa ADR itu punya berkas.

**Dua lubang `bun run skills:check` ditutup** (§9.6). Pembebasan
`ASPIRATIONAL_SKILLS` dulu bersifat per-SKILL dan **total**: `awcms-performance`
terdaftar dengan alasan yang menyebut PERINTAH sementara pembebasannya juga menutupi
PATH, sehingga skill itu bisa berkata "perintah ini tidak ada" di banner-nya dan
"gunakan suite yang sudah ada di `src/lib/performance/`" enam puluh baris kemudian —
direktori yang tidak ada — tanpa gerbang berpendapat. Kini ada blok bertanda
`<!-- aspirational:mulai -->` yang membatasi pembebasan ke passage yang memang
memerlukannya; sisanya tetap digerbangi, dan `awcms-performance` keluar dari daftar.
Lubang kedua mekanis: ekstraktor path hanya melihat path berbacktick **satu baris**,
sehingga path yang terpotong pembungkusan markdown tak terlihat — aturan 1 sebenarnya
berbunyi "path yang disebut DAN kebetulan muat satu baris wajib ada", dan selisih itu
tak tertulis di mana pun. Keduanya mutation-proven.

**ADR-0068 menuliskan pin edisi standar dan tiga divergence keluarga.**
`awcms-astro` ADR-0028 menyatakan mengikuti edisi OWASP repo ini dan tidak
mendahuluinya — sementara keputusan itu tidak pernah ada, karena pinnya datang lewat
sebuah skill lalu diikuti karena sudah tertulis. `intentionalDivergences` yang kosong
sejak ADR-0055 kini memuat tiga entri ber-`reviewDate`: HSTS `includeSubDomains`
(benar di kedua sisi, alasan berbeda), `.astro` tak-terperiksa-tipe, dan pin edisi itu
sendiri.

**`astro check` TIDAK bisa ditambahkan, dan itu diverifikasi bukan diasumsikan.**
`@astrojs/check` menuntut API programatik TypeScript 6.x; repo ini di 7.0.2, yang
tidak menyediakannya. Dipasang, dijalankan, ditolak, lalu dependensinya dicabut lagi
alih-alih meninggalkan 73 paket yang tak bisa berbuat apa-apa. Dicatat sebagai
divergence bertanggal, bukan sebagai janji.

**ADR-0067 mendapat Opsi D — pengukuran lab.** Ketiga opsi draf pertama semuanya RUM,
sehingga seluruh keputusan bertabrakan dengan postur privasi `visitor_analytics` dan
menunggu. Pengukuran lab (Playwright, sudah terpasang) mengumpulkan **nol** data
pengunjung dan menjawab pertanyaan yang berbeda — "apakah perubahan ini membuat
halaman lebih lambat" — jadi ia tidak perlu menunggu keputusan RUM.
