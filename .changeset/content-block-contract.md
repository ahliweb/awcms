---
"awcms": minor
---

Terbitkan kosakata blok `content_json` sebagai kontrak yang bisa dibaca mesin,
dan patok ketiga tempat ia dinyatakan agar tak bisa menyimpang diam-diam.

Sampai perubahan ini kosakata itu hidup di dua tempat: tipe TypeScript
`ContentBlock` (tak terlihat siapa pun di luar `tsc`) dan **satu kalimat prosa**
di salah satu dari lima kemunculan `contentJson` di OpenAPI — empat sisanya
hanya menyebut `type: object`. Konsumen yang membaca kontrak punya peluang empat
dari lima untuk tidak mempelajari apa pun tentang isi field itu.

Akibatnya nyata dan sudah terjadi: `awcms-astro` menurunkan ulang kosakata itu
dengan membaca, lalu keliru dalam tiga hal sekaligus — mengarang tipe
`ordered_list` yang tak ada, dan menjatuhkan `gallery` serta `video_news` karena
keduanya tak punya field `text` sementara fallback-nya merender `text`. Tidak
ada yang gagal di mana pun. Daftar bernomor keluar berbutir dan bagian bermedia
lenyap dari halaman yang tayang.

Kosakata yang hanya hidup di prosa akan diturunkan ulang, dan penurunan ulang
itulah tempat ia patah.

- `CONTENT_BLOCK_TYPES` — kosakata sebagai nilai RUNTIME, disatukan dengan union
  `ContentBlock` lewat assertion saling-assignable. Menambah varian ke union
  tanpa menambahnya ke konstanta (atau sebaliknya) **memerahkan typecheck**,
  bukan sebuah test yang mungkin tak dijalankan orang. Terbukti dua arah.
- Skema `BlogContentBlock` + `BlogContentJson` di OpenAPI: `oneOf` enam varian
  lengkap dengan field-nya, dirujuk dari **kelima** kemunculan `contentJson`.
  Dua bentuk yang paling mudah salah tebak diberi catatan eksplisit — urutan
  adalah FIELD pada `list` (bukan tipe `ordered_list`), dan `gallery`/
  `video_news` TIDAK punya field `text`.
- `tests/content-block-contract.test.ts` memaku kontrak OpenAPI dan `switch`
  renderer ke konstanta yang sama, plus menegaskan setiap tipe merender sesuatu
  yang tak kosong dan tak ada varian HTML mentah. Diuji dengan mutasi: kontrak
  menyebut tipe berbeda (1 merah), satu `contentJson` kembali `type: object`
  polos (1 merah), renderer berhenti menangani `gallery` (2 merah).
