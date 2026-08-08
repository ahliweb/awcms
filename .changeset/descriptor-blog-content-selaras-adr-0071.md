---
"awcms": patch
---

docs(blog_content): descriptor dan README berhenti menjanjikan keluarga `/news/**` yang sudah dihapus

Pelaksanaan ADR-0071 §4 menghapus keempat rute `/news/**`, gerbang
`withHostResolvedBlogTenant`, dan setting `publicRouteMode` dari kode — tetapi
**deskripsi descriptor `blog_content` dan `README.md`-nya tidak ikut berubah**.
Keduanya masih menyajikan ketiganya sebagai permukaan hidup:

- `module.ts` `description` masih berbunyi "ADR-0059 adds the SECOND,
  host-resolved public family `/news/**` … carries its own switch
  `publicRouteMode`". Deskripsi descriptor bukan komentar — ia yang dibaca
  `listModules()` dan yang muncul di layar Module Management, jadi operator
  membacanya sebagai daftar kapabilitas.
- `README.md` memuat ~180 baris yang mendokumentasikan gerbang, saklar, dan
  keempat rute itu, termasuk **tabel setting yang mencantumkan `publicRouteMode`
  sebagai field yang bisa ditulis** lengkap dengan write path
  `PATCH /api/v1/tenant/modules/blog_content/settings` — instruksi untuk menulis
  setting yang sudah tidak ada.

Ini kelas cacat yang sama yang berulang di repo ini: dokumen yang membantah
kodenya sendiri, dan tak satu gerbang pun melihatnya karena semua gerbang
cakupan mengukur ENDPOINT, bukan prosa descriptor.

Yang dipertahankan sebagai catatan historis, bukan dihapus: paragraf yang
menyatakan keluarga itu PERNAH ada dan kenapa dipensiunkan. Menghapusnya akan
membuat orang berikutnya mengusulkannya lagi sebagai fitur baru enam bulan
kemudian — alasan yang sama dipakai tabel celah §9 untuk menahan baris yang
sudah tertutup.

Nol perubahan perilaku: hanya string deskripsi dan markdown.
