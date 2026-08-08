---
"awcms": patch
---

feat(gerbang): kelas "hanya bisa lewat `curl`" berhenti dicari dengan tangan — 54 permission tanpa layar jadi angka yang hanya boleh mengecil

[ADR-0051](../docs/adr/0051-admin-screens-consolidated-in-awcms.md) memutuskan
setiap layar admin SISTEM dibangun di repo ini, lalu **tidak memasang apa pun
yang mengukur kepatuhannya**. Akibatnya "modul ini hanya bisa dipakai lewat
`curl`" ditemukan dengan tangan — berulang kali, dan tiap kali terlambat.

Pemeriksa yang tampak berdekatan menjawab pertanyaan lain:

- `access:permissions:enforcement:check` — "apakah permission ini punya
  **penegak**?" Sebuah rute sudah cukup. Permukaan `curl`-only lolos selamanya.
- `tests/admin-navigation-registry.test.ts` — "apakah tiap entri `navigation`
  menunjuk halaman, dan sebaliknya?" Modul tanpa `navigation` tak punya apa pun
  untuk diperiksa.
- contract test per-layar — "apakah layar INI menggerbangi key yang benar?" Ia
  tak bisa melihat permission yang tak disebut layar mana pun.

`bun run admin:screen-coverage:check` (murni, di rantai `check`, gerbang ke-36)
menanyakan yang hilang: **apakah ada layar yang mengklaim permission ini?**
Hasil pemindaian pertama: **32 layar mengklaim 133 dari 203 permission**; 16
keputusan tertulis, **54 menunggu layar, tersebar di sembilan modul.**

Dua daftar, dan pemisahannya adalah inti desainnya:

- **`DELIBERATELY_UNSCREENED`** — keputusan ber-alasan ("operator memang tidak
  seharusnya menggerakkan ini dari halaman"), bentuk yang sama dengan register
  `permission-enforcement-check.ts`. Isinya diambil dari alasan yang **sudah
  tertulis di kode**: keenam `workflow.definition.*` (butuh editor graf; textarea
  JSON yang menerima graf rusak sampai `publish` menolaknya lebih buruk daripada
  tak ada), unggah media tiga-langkah, saklar `enforcement` satu-arah,
  `blog_content.ads.*` yang ADR-0044 pensiunkan jadi 410, dan tiga lainnya.
- **`NOT_YET_SCREENED`** — ledger **satu arah** yang isinya bukan penilaian
  apa-apa, hanya "belum ada yang membangunnya". Memberi sebuah permission layar
  lalu meninggalkan barisnya di sini **memerahkan CI**, jadi angkanya selalu
  angka yang sebenarnya. Itulah yang membuatnya layak ditulis: sebelum berkas
  ini, "13 dari 21 modul tanpa layar" adalah kalimat yang harus diturunkan ulang
  dengan tangan, dan pernah diturunkan **salah** lebih dari sekali.

Mencampur keduanya akan membuat pekerjaan yang belum selesai memperoleh
penampilan sebuah penilaian — persis cara ADR-0058 menemukan enam entri
pengecualian yang ternyata enam bug.

Dua kelompok terbesar di ledger bukan kosmetik, dan namanya disebut di
berkasnya: seluruh key `email.suppression.*` (alamat yang di-suppress berhenti
menerima email **termasuk reset password**, dan tak ada halaman untuk
melihat/menghapusnya) dan seluruh `identity_access.business_scope_*` (assignment
plus alur exception maker/checker tanpa inbox untuk checker-nya).
`module_management.settings.*` adalah yang punya alibi palsu: tiga dokumen
menyatakan panel setting generik `/admin/modules/{key}` sudah ada, dan satu
memakai klaim itu untuk membenarkan tidak membangun editor. Layar itu tak pernah
ada (dikoreksi di PR sebelumnya).

**Matcher-nya menyelesaikan helper file-first, dan itu load-bearing.** Matcher
yang hanya membaca triple literal `permissionKey("m","a","x")` melaporkan
**delapan** permission `blog_content` yang ter-ship dan bekerja sebagai
tak-terklaim, karena `blog-presentation.astro` mengikat
`const can = (activity, action) => …permissionKey("blog_content", activity, action)`
lalu memanggilnya delapan kali dengan literal. Diverifikasi dengan membuang
resolusi itu: **8 false positive**. Scanner yang menjawab "tak tercakup" untuk
yang tercakup lebih buruk daripada tak ada scanner — ia melatih pembacanya
menambah pengecualian sampai gerbangnya tak menanyakan apa pun, dan
`permission-enforcement-check.ts` butuh empat draf untuk mempelajarinya.
Resolusinya sengaja **sempit**: helper hanya dihitung bila badannya mengikat
module key sebagai LITERAL dan meneruskan kedua parameternya sendiri. Selain itu
dibiarkan tak-terselesaikan — dan gagal ke arah "tak-terklaim", arah yang
memaksa manusia melihat.

**Batas yang dinyatakan di docblock-nya:** gerbang ini menjawab "apakah ada yang
mengklaim?", **bukan** "apakah kontrolnya benar". Tombol Restore `/admin/blog`
mengklaim `posts.restore` sambil dirender pada baris yang pasti 404 (#351);
gerbang ini akan berkata "tercakup" sepanjang waktu itu. Kebenaran kontrol tetap
tugas contract test per-layar.

**Mutation-proven empat arah:** permission tanpa layar & tanpa entri → MERAH;
entri ledger basi (layarnya sudah ada) → MERAH "only ever shrinks"; resolusi
helper dibuang → 8 false positive; layar menggerbangi key yang tak dideklarasikan
siapa pun → MERAH. Plus 15 unit test atas aturannya, digerakkan snapshot
tertanam.
