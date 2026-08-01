---
"awcms": minor
---

`GET /api/v1/blog/posts` dapat traversal stabil ber-cursor — build feed tidak
lagi berhenti di 100 post.

Endpoint ini hanya punya `?limit=` (maks 100) dan tanpa cursor, jadi tidak ada
cara membaca lebih dari 100 post. Adapter `awcms-astro` **melempar** saat
menyentuh batas itu alih-alih memotong diam-diam, sehingga situs dengan lebih
dari 100 artikel tidak bisa di-build sama sekali.

Yang TIDAK dilakukan: menambahkan `?cursor=` ke urutan yang sudah ada.
Default-nya `updated_at DESC` — benar untuk tabel admin dan tidak sah sebagai
kunci keyset, karena menyunting sebuah post memindahkannya: satu baris bisa
melintasi batas halaman di antara dua permintaan lalu terlewat atau muncul dua
kali, dan tak ada apa pun yang bisa mendeteksinya. Sebuah cursor hanya sah di
atas urutan yang tidak berubah oleh tulisan yang dibalapinya.

Jadi `?order=created_at` memilih traversal stabil (kolom immutable) dan
`?cursor=` hanya berlaku bersamanya; `?cursor=` di atas urutan default **ditolak
400** dengan alasannya, bukan diam-diam dilayani. Default endpoint tidak berubah
sama sekali — tabel admin tetap urut `updated_at`.

`nextCursor` dicetak di lapisan yang masih memegang teks presisi mikrodetik,
tidak pernah diturunkan ulang dari `Date` JS di rute. Itu bukan kehati-hatian
teoretis: `timestamptz` menyimpan mikrodetik, `Date` hanya milidetik, dan driver
MEMBULATKAN KE BAWAH — cursor dari `Date` menunjuk instant yang lebih awal dari
barisnya sendiri dan melewatkan setiap baris yang berbagi milidetik itu (Issue
#158; terukur: 105 baris → halaman 2 berisi 4, batch-insert → halaman 2 berisi
0).

Diverifikasi terhadap PostgreSQL nyata dengan kasus terburuknya: 25 post
di-insert dalam SATU statement sehingga berbagi `created_at` sampai mikrodetik.
Mutation-proven — mengganti sumber cursor jadi `new Date(row.created_at)`
memerahkan 3 dari 5 test.

`BlogPostSummary` mendapat field `createdAt` (aditif).
