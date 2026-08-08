---
"awcms": patch
---

docs(kosakata): `/blog/**` di sini, `/news/**` di `awcms-astro` — ADR-0071 men-supersede ADR-0059

[ADR-0070](../docs/adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) menyatakan `awcms-astro` memikul halaman publik sebagai fungsi utama, tetapi §Konsekuensi-nya masih menyebut keluarga `/news/**` sebagai permukaan publik repo ini. Akibatnya kedua repo boleh melayani berita publik, pada dua alamat, dari satu sumber konten yang sama — dua jawaban untuk satu pertanyaan, dan pertanyaannya ditanyakan setiap kali sebuah deployment dibangun.

**ADR-0071 membelah kosakata URL publik keluarga: satu keluarga rute per repo, dan tidak pernah keduanya di satu repo.** `/blog/{tenantCode}/**` di sini (path-scoped, ADR-0009); `/news/**` di `awcms-astro` (sebuah tab bernama `news` ber-`urutanSeksi: "terbaru"`, ADR-0033 repo sana).

- **Yang dibelah URL, bukan kepemilikan konten.** Keduanya dilayani modul `blog_content` yang sama di sini, dan repo sebelah membacanya lewat `GET /api/v1/blog/posts` yang sudah dibekukan ADR-0065. Aturan cermin ADR-0070 §4 — tidak ada kemampuan yang hanya ada di sana — karena itu terpenuhi tanpa pekerjaan tambahan: tidak ada kemampuan yang **pindah**, yang pindah rendering halamannya.
- **ADR-0059 di-supersede, tetapi dua keputusannya dinyatakan ULANG** supaya tidak ikut gugur: invarian §C (tenant yang mematikan permukaan publiknya mendapat sitemap **kosong**, bukan sitemap berisi tautan yang pasti 404) dan penolakan §E mendeklarasikan surface cache tepi host-resolved sebelum kunci per-host diverifikasi di VCL. Men-supersede mencabut seluruh keputusan sebuah ADR; kedua hal itu tidak boleh ikut tercabut diam-diam.
- **Premis ADR-0061 §A gugur ke arah yang menguntungkan.** ADR itu menyimpulkan cache tepi "mempercepat bentuk warisan dan tidak menyentuh bentuk maju sama sekali" — benar, tetapi bersandar pada premis bahwa `/blog/{tenantCode}` sedang ditinggalkan. Ia kini kosakata permanen, dan ia path-scoped, jadi sudah bisa di-cache hari ini. ADR-0061 diberi banner, **tidak** di-supersede: analisisnya tetap benar untuk rute discovery root, yang adalah mayoritas isinya.

Yang hanya terasa saat mengembangkan:

- **Ada jendela nyata antara aturan ini dan kodenya, dan ia digerbangi.** Empat rute masih ada di `src/pages/news/` dan `publicRouteMode` masih `domain_default` — artinya `/news/**` **menyala** untuk setiap tenant yang tidak mematikannya. `tests/url-vocabulary-split.test.ts` mengikat penanda §4 pada keberadaan rutenya **dua arah**: rute ada → ADR wajib berkata BELUM; rute hilang → wajib berkata SUDAH, pada PR yang sama.
- **Kualifikasi `Accepted (belum diimplementasikan)` tidak bisa dipakai, dan itu informatif.** Gerbangnya mengikat kualifikasi pada **keberadaan** artefak yang dijanjikan (absen → berkualifikasi, ada → polos). ADR ini menjanjikan sebuah **penghapusan**, jadi arahnya terbalik, dan aturan (d) gerbang itu melarang kualifikasi dipakai di luar petanya. Karena itu §4 mendapat gerbangnya sendiri: disiplin dua arah yang sama, untuk bentuk janji yang berlawanan.
- **PR implementasinya wajib membawa 301, bukan 404.** URL `/news/**` sudah diiklankan sitemap dan feed repo ini; mematikannya tanpa penerus adalah biaya SEO yang dibayar pembaca. Ia juga wajib **mematikan auto-redirect legacy** `/blog/{tenantCode}` → `/news`, yang arahnya terbalik di bawah aturan ini — ia akan mengirim lalu lintas ke keluarga yang repo ini tidak lagi layani.
- **Penanda §4 memakai prefiks yang kebal prosa.** Draf pertama mencocokkan kata telanjang dan menghitung DUA: daftar langkah §4 sendiri menyuruh implementernya membalik penanda itu, jadi ia mengeja keadaan tujuannya. Penanda status yang bisa dijatuhkan instruksinya sendiri adalah penanda yang melaporkan kata-katanya, bukan keadaannya.

**Nol perubahan kode berjalan.** Modul `blog_content`, kontrak ADR-0065, seluruh layar admin, dan setiap izin tetap persis seperti sebelumnya.
