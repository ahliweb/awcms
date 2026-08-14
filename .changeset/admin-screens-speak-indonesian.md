---
"awcms": minor
---

feat(i18n): 25 dari 43 layar admin kini berbicara lewat katalog, sisanya TERDAFTAR

Gelombang ketiga ADR-0095: memindahkan literal Inggris di layar admin ke `t()`.
Angkanya, karena angka yang tidak dinyatakan adalah angka yang menyusut sendiri:

- **1.663 → 25** literal yang belum diterjemahkan di seluruh `src/pages/admin`.
- **25 dari 43** layar bersih sepenuhnya; **18 sisanya** ada di ledger
  `i18n:screens:check` yang **hanya boleh MENYUSUT**.
- **1.258 msgid** dideklarasikan; **540 diterjemahkan**, **718 belum** — dan
  jumlah itu adalah ledger `i18n:catalog:check`, dinaikkan dari 0 dengan alasan
  tertulis, sekali, persis seperti yang diramalkan catatan sebelumnya.

**Kenapa sisanya DIDEKLARASIKAN alih-alih ditunggu.** String yang tidak ada di
`locales/` bukan "belum diterjemahkan" melainkan **tidak bisa diterjemahkan** —
tak terlihat oleh penerjemah dan tak terhitung oleh apa pun. Mendeklarasikan
semuanya membuat utangnya PUNYA ANGKA. Dan itu aman karena entri kosong menurun
ke `msgid`, yang ADALAH teks sumber Inggris (ADR-0095 §"Keputusan 2"): pembaca
Indonesia melihat bahasa Inggris yang BENAR pada bagian yang belum selesai,
bukan kunci yang bocor atau elemen kosong.

**Gerbang baru `i18n:screens:check`** menjawab pertanyaan yang sengaja TIDAK
dijawab `i18n:catalog:check`: bukan "apakah msgid yang dipakai dideklarasikan"
(konsistensi), melainkan "layar mana yang masih merender literal" (cakupan).
Menggabungkan keduanya akan melahirkan gerbang yang hijau sambil semua
jawabannya salah — kelas cacat yang sudah tercatat di repo ini.

Menulis gerbang itu memakan tiga koreksi, dan ketiganya layak dicatat karena
semuanya adalah versi dari kesalahan yang sama:

1. Versi pertama melewati SEMUA isi `{...}` dengan menghitung kedalaman kurung.
   Ia melaporkan **7** literal di dasbor yang punya lebih dari **tiga puluh** —
   karena mayoritas teks layar admin hidup di dalam kondisional JSX. Gerbang
   cakupan yang diam-diam mengabaikan mayoritas hal yang diukurnya adalah
   kegagalan yang paling mahal, karena ia terbaca sebagai kabar baik.
2. Komentar JSX (`{/* … */}`) terhitung sebagai prosa. Beberapa layar
   menjelaskan escaping `set:text`-nya sendiri di sana, lengkap dengan tag
   `<pre>`, sehingga tiap kalimat penjelasan dilaporkan sebagai string yang
   belum diterjemahkan.
3. `class={count > 0 ? …}` memuat `>` di TENGAH ekspresi, jadi pemindai
   menutup tag di operator perbandingan dan melaporkan sisa ternary sebagai
   prosa.

Alat bantu migrasinya juga salah tiga kali sebelum benar — placeholder
proteksinya sendiri ikut terbungkus `t()` (isi komentar hilang, bukan
dipulihkan), dan dua kelas kode ter-bungkus sebagai string. Semuanya ketahuan
karena `bun run build` DIJALANKAN: `tsc` tidak memeriksa template `.astro`, jadi
sumber yang rusak lolos typecheck dan hanya kompiler Astro yang melihatnya.
Itu penegasan pelajaran "jalankan, jangan dibaca" yang sudah ada di memori
proyek.

**Keterbatasan yang dinyatakan, bukan disembunyikan:** 12 dari 1.258 msgid
(<1%) adalah PENGGALAN kalimat, karena kalimatnya terpotong oleh `<code>` atau
`<strong>` di tengah. Ia diterjemahkan dengan benar tetapi canggung bagi
penerjemah; menggabungkannya menjadi satu msgid ber-placeholder adalah pekerjaan
tangan yang menunggu di 18 layar ledger itu.
