---
"awcms": patch
---

fix(i18n): pengalih bahasa 403 di produksi — satu-satunya form POST asli di repo ini

v9.1.0 mengirim pengalih bahasa yang **tidak pernah bekerja di produksi**. Ia
mengembalikan `403 Cross-site POST form submissions are forbidden` untuk semua
orang, dan karena ia SATU-SATUNYA jalan menuju bahasa Indonesia, fitur utama
rilis itu inert di lingkungan yang sesungguhnya.

**Sebabnya.** `checkOrigin` Astro (`core/app/origin-check.js`) menolak tiap
request ber-content-type mirip-form kecuali
`request.headers.get("origin") === url.origin`. Deployment ini mengakhiri TLS di
Traefik sementara app-nya sendiri mendengarkan HTTP polos, jadi `url.origin`
adalah `http://…` sedangkan tiap browser mengirim `https://…`. Dua string itu
tak pernah sama.

**Kenapa NOL gerbang melihatnya.** Ia hanya salah di belakang proxy yang
mengakhiri TLS. Dev, `bun run build`, dan smoke test Playwright semuanya bicara
HTTP polos ke app, dan di sana `origin` DAN `url.origin` memang cocok. 47
gerbang hijau, 4.375 test hijau, dan permukaannya tetap mati saat menghadapi
pembaca sungguhan. Ini penegasan lain dari "jalankan, jangan dibaca" — kali ini
"jalankan DI TOPOLOGI YANG SEBENARNYA".

**Perbaikannya** mengirim `application/json` lewat `fetch`, yang `checkOrigin`
kecualikan dengan alasan yang benar: POST `application/json` lintas-situs sudah
dihentikan preflight CORS. Itu juga yang dilakukan SETIAP tulisan lain di
aplikasi ini — komponen ini satu-satunya form POST asli di seluruh repo, dan
itulah kenapa tak ada yang pernah menabrak dinding ini sebelumnya.

Ongkosnya: pengalih kini MEMBUTUHKAN script. Itu bukan batasan baru di halaman
mana pun yang memuatnya — `/login` mengirim kredensialnya dengan `fetch`, jadi
pembaca tanpa script tak bisa masuk sama sekali. Tombol fallback karena itu
dikirim `hidden` DI MARKUP, bukan disembunyikan belakangan oleh script: tombol
yang terlihat sampai script jalan adalah kontrol yang rusak persis bagi pembaca
yang tak bisa memakainya.

**Digerbangi** `tests/form-post-origin-check.test.ts`: tiap `<form method="post">`
di `src/` wajib membatalkan submit aslinya, dan daftar form yang mem-POST
dibatasi pada satu berkas yang diketahui. Dibuktikan GAGAL lebih dulu dengan
menghapus `preventDefault`.

Penulisan gerbang itu sendiri mengulang cacat yang baru saja ditutup CodeQL:
versi pertama pemotong komentarnya mencocokkan `{/* … */}` sebagai satu kesatuan,
tetapi `\{\s*\/\*` juga cocok dengan `interface Props {` beserta JSDoc-nya, lalu
BERLARI mencari `*/` yang kebetulan diikuti `}` — menelan seluruh markup di
antaranya. Pemindainya lalu melaporkan NOL form dan terbaca sebagai lulus.
Kuantifier malas yang meleset tidak gagal setempat; ia menelan.

**Utang yang dinyatakan, bukan ditutup:** `url.origin` app SALAH di produksi
(skema `http` untuk situs `https`). Tak ada satu pun tempat di repo ini yang
membaca `X-Forwarded-Proto`, dan adapter Node menurunkan protokol dari
listener-nya sendiri. PR ini menghindari akibatnya di satu titik; akarnya —
dan apa pun lain yang bersandar pada origin absolut — masih menunggu.
