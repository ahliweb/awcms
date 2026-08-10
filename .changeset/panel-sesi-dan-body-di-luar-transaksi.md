---
"awcms": patch
---

fix(admin,auth): panel sesi yang tak bisa ditutup di ponsel, dan body yang dibaca di dalam transaksi

Dua cacat dari review terhadap PR yang mendarat hari ini (#496, #498). Keduanya
hijau di seluruh 38 gerbang, dan keduanya hanya terlihat dengan membaca dua
berkas bersamaan.

**1. `<tr hidden>` TIDAK tersembunyi di dalam tabel stacked.** `admin.css`
mengubah tiap baris `.data-table--stack` menjadi kartu di bawah `--bp-md`
lewat `.data-table--stack tr { display: block }`. Selektor itu berspesifisitas
(0,1,1); aturan user-agent yang membuat atribut `hidden` bekerja —
`[hidden] { display: none }` — berspesifisitas (0,1,0). Aturan author menang,
jadi `hidden` **diam-diam berhenti menyembunyikan**, dan berhentinya persis di
layout yang tak diperiksa siapa pun lebih dulu.

Akibatnya bukan kosmetik seperti kedengarannya: baris detail yang tak bisa
menutup akan me-render isinya untuk **setiap** baris tabel sekaligus, dan tombol
yang seharusnya membukanya tidak melakukan apa pun yang terlihat. Panel sesi di
`/admin/users` mendarat dengan persis itu.

Perbaikannya `.session-panel-row[hidden] { display: none }` — (0,2,0), menang
dua arah — dan **di luar** media query, karena media query tak menambah
spesifisitas sehingga satu aturan meliputi kedua layout.

Test regresinya menegakkan sifat UMUM, bukan satu berkas: tiap layar admin yang
memakai tabel stacked **dan** menyembunyikan baris dengan atribut `hidden` wajib
membawa aturan `[hidden] { display: none }`-nya sendiri. Draf pertamanya
**dipuaskan oleh komentar CSS-nya sendiri** yang mengutip aturan itu verbatim —
mutasi yang MENGHAPUS perbaikannya tetap hijau. Komentar kini dibuang sebelum
pencocokan; ini kali keenam bentuk itu muncul di repo ini, dan selalu
PERBAIKAN-lah yang menanam false positive, karena sebuah perbaikan menjelaskan
apa yang ia hapus.

**2. `POST /auth/password/change` membaca body di DALAM transaksi.**
`await request.json()` menunggu **klien**. Melakukannya di dalam `withTenant`
menahan satu koneksi pool tercadang — berikut slot work-class-nya — selama
pemanggil memilih untuk mengirim body-nya, sehingga satu permintaan lambat
menjadi koneksi yang ditahan terhadap setiap permintaan lain di pool.
`queueTimeoutMs` membatasi **memperoleh** koneksi, tak pernah **menahan**-nya.

`defineTenantRoute` punya `prepare` justru untuk ini; seam self-service tidak
punya, jadi rutenya tak punya tempat lain. Seam-nya kini punya `prepare` yang
sama bentuknya — penambahan murni, nol call site berubah. `beforeTransaction`
tidak bisa mengerjakannya: ia hanya mengembalikan `Response | undefined`, jadi
body yang di-parse di sana tak punya tempat tujuan dan harus di-parse dua kali.

Asersinya **posisional**, bukan "apakah muncul": `prepare` dan `handler`
sama-sama menyinggung body dengan satu atau lain cara, dan pertanyaannya adalah
di sisi mana batas transaksi pembacaan itu berada.
