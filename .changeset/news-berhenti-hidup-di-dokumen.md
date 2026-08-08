---
"awcms": patch
---

docs(kosakata,gerbang): `/news/**` berhenti hidup di dokumen yang paling banyak dibaca — dan gerbangnya berhenti bisa dibohongi berkas `.astro`

[ADR-0071](../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
membelah kosakata URL publik — `/blog/**` permanen di repo ini, `/news/**` milik
`ahliweb/awcms-astro` — dan §4-nya sudah berbunyi **SUDAH DILAKSANAKAN**:
`src/pages/news/` tidak ada, `withHostResolvedBlogTenant` dan `publicRouteMode`
hanya tersisa sebagai komentar sejarah.

Dokumennya belum menyusul, dan yang paling parah justru yang paling banyak
dibaca:

- **`AGENTS.md`** — berkas **pertama yang dibaca setiap agen** — masih memuat
  blockquote "**Jendela yang masih terbuka**" yang menyatakan keempat rute
  "MASIH ADA di `src/pages/news/`" dan **MENJADWALKAN** penghapusannya, sambil
  menyebut `tests/url-vocabulary-split.test.ts` sebagai penegak jadwal itu.
  Sebuah jadwal untuk pekerjaan yang sudah selesai membuat pembaca berikutnya
  mencari berkas yang tidak ada lalu menyimpulkan repo-nya rusak — atau
  membangun ulang keluarga rute yang **dilarang tiga paragraf di atasnya**.
- **`docs/ARCHITECTURE.md`** — "Rute `/news/**` host-resolved kini **SUDAH
  ada**".
- **`docs/PROJECT_STATE.md`** — entri "Rute publik host-resolved — SELESAI"
  berada di bawah heading **"Yang sudah selesai (jangan dibangun ulang)"**.
- **`docs/awcms/standar-performa-dan-keamanan.md`** — baris §11 masih
  membingkai "kapan memakai `awcms-astro` alih-alih rute publik `awcms`"
  sebagai pilihan per situs.
- **`.claude/skills/awcms-blog-content/SKILL.md`** — frontmatter mengiklankan
  "**DUA keluarga rute publik**", dan badannya menyatakan Issue #560 "menambah
  `src/pages/news/` (7 `APIRoute` paralel)". Skill DIIKUTI, bukan sekadar
  dibaca.

Semuanya ditulis ulang **per konteks**, bukan dengan `sed` seragam — dan dua
kutipan yang sengaja dipertahankan (agar catatan "apa yang dulu dipercaya" tidak
hilang) dipagari penanda `<!-- historis:mulai -->`/`<!-- historis:selesai -->`.

**Dan gerbangnya sendiri punya dua lubang.**

1. **Ia hanya membaca ADR + filesystem, tak pernah dokumen.** Kelima klaim di
   atas lolos aturan (a)–(d) tanpa satu pun memerah. Aturan **(e)** menutupnya:
   selama rutenya tidak ada, dokumen **current-state** tidak boleh menyatakan
   keluarga itu ADA. Deteksinya **sempit dengan sengaja** — sebuah token
   (`src/pages/news`, `publicRouteMode`, `withHostResolvedBlogTenant`,
   `/news/**`) hanya memerah bila berdampingan dengan **frasa klaim keberadaan**
   dalam jarak 160 karakter. Larangan token telanjang akan memerahkan kalimat
   yang justru BENAR — README dan descriptor `blog_content` menyebut ketiganya
   persis untuk mengatakan bahwa mereka hilang, dan itu teks yang paling
   dibutuhkan pembaca. Gerbang yang memerah pada prosa benar melatih pembacanya
   melemahkannya; `skills:check` butuh tiga draf untuk belajar itu.
   Korpusnya ditulis eksplisit dan **tidak** melebar ke seluruh `docs/awcms/`
   (§10 sudah menolaknya); ADR sengaja **di luar** korpus — ADR-0059 memang
   harus tetap berkata `/news/**` ada, itu catatan keputusan pada satu waktu.
2. **Ia mengikat EMPAT NAMA BERKAS, bukan direktori.** `NEWS_ROUTE_FILES`
   mendaftar `index.ts`/`[slug].ts`/`category/[slug].ts`/`tag/[slug].ts`, jadi
   sebuah `src/pages/news/index.astro` — rute yang sama, ekstensi yang justru
   lebih lazim untuk halaman Astro — menghidupkan kembali keluarga itu tanpa
   satu pun asersi bergerak. **Diverifikasi terhadap gerbang LAMA, bukan
   disimpulkan:** menaruh berkas satu baris di sana meninggalkannya di
   **9 pass / 0 fail**. Kini ia memindai direktorinya.

Mutation-proven keduanya: mengembalikan teks AGENTS.md hari ini → MERAH
menyebut `AGENTS.md:98`; menaruh `src/pages/news/index.astro` → MERAH menyebut
berkasnya.

Proksimitas 160 karakter itu sendiri lahir dari satu false positive nyata:
pemasangan token↔frasa se-BARIS memerahkan baris skill sepanjang **1.721
karakter**, di mana "sudah ada" (tentang helper iklan/widget) duduk ~300
karakter dari sebutan `src/pages/news` yang tak berhubungan. Vonisnya kebetulan
benar tentang berkasnya dan salah tentang alasannya — jenis yang paling buruk,
karena ia mengajari pembaca bahwa pesan gerbang tak bisa dipercaya.

Nol perubahan kode produksi. Tiga entri surface cache tepi `news-*` yang kini
inert dan komentar `surface-registry.ts` yang menyertainya **sengaja tidak
disentuh di sini** — itu perubahan kode dengan pemeriksanya sendiri, dan
dikerjakan sebagai unit terpisah.
