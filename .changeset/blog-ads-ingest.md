---
"awcms": minor
---

ADR-0044 §4 Fase 2, langkah kedua: job `bun run blog:ads:ingest` yang
memindahkan sistem iklan free-URL ke sistem berbasis media — dan **melaporkan
setiap baris yang tidak bisa dipindahkan**.

Pratinjau adalah default, bukan flag. Job scheduled lain memakai `--dry-run`
sebagai opt-in karena mereka berjalan tanpa penunggu dan mode normalnya adalah
bekerja. Yang ini kebalikannya: ia tidak menulis apa pun sampai diberi
`--apply`. Kesalahan mahal di sini bukan "lupa pratinjau", melainkan
"sudah pratinjau, lalu tidak pernah membaca residunya" — oleh operator yang
sebentar lagi menghapus tabel sumbernya.

**Yang otomatis hanya satu kasus, dan itu disengaja.** Sebuah iklan pindah bila
`image_url`-nya sudah merupakan URL publik salah satu objek media tenant itu
yang **terdaftar** di registry. Selain itu — remote, malformed, object key milik
tenant lain, atau byte di bucket yang tidak diklaim baris registry mana pun —
menjadi residu, dilaporkan lengkap dengan URL-nya untuk diunggah ulang manusia
lewat media library.

Dua jalan pintas yang ditolak, dan alasannya:

- **Mengambil URL eksternal dari server.** Itu primitif SSRF, dan tempat
  terburuk untuk membangunnya adalah skrip migrasi data yang dijalankan sekali,
  di bawah tekanan waktu, oleh operator yang sedang mengawasi jumlah baris
  alih-alih egress. Repo ini sudah memutuskan sikapnya soal ini di jalur
  discovery OIDC (ADR-0031).
- **Mendaftarkan objek yang ada di bucket tapi tanpa baris registry.** Itu akan
  membuat skrip migrasi mencetak baris `verified` untuk byte yang tidak pernah
  ia ambil, sniff, atau batasi ukurannya — persis pernyataan yang menjadi alasan
  keberadaan pipeline unggah. Peran `awcms_worker` bahkan tidak diberi INSERT
  yang memungkinkannya (`sql/079`).

Rincian lain:

- `--apply` **wajib** disertai `--placement-key=<key>`. Sistem lama tidak punya
  konsep slot, yang baru menuntut satu dari dua belas, dan tidak ada di data
  lama yang menyatakan mana. Job menolak menebak.
- Idempoten lewat `source_legacy_ad_id` di bawah unique index PARSIAL dengan
  `NULLS NOT DISTINCT` (`sql/079`). Keduanya load-bearing: tanpa `NULLS NOT
  DISTINCT` sebuah run kedua menggandakan seluruh iklan `global`; tanpa
  predikat parsial, index itu justru menolak pekerjaan editorial biasa. Kedua
  sisi dibuktikan dengan mutasi terhadap PostgreSQL 16 nyata.
- Job tidak menulis satu pun statement sendiri — semuanya di
  `application/legacy-ad-ingest-directory.ts`, milik modul pemilik tabel
  (`modules:table-writes:check`).
- Tidak ada tabel yang dihapus. Menghapus `awcms_blog_ads` adalah keputusan
  manusia yang sudah membaca laporan residu, bukan efek samping dari job yang
  menghasilkannya.

Ditemukan sambil jalan: seluruh blok `NEWS_MEDIA_R2_*` tidak pernah ada di
`.env.example`, jadi operator yang menyalin berkas itu tak punya cara menemukan
lima variabel wajib `media_library`. Sekarang terdokumentasi.
