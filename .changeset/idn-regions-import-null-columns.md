---
"awcms": patch
---

Impor dataset wilayah menulis SQL NULL, bukan string `"null"`. `tx.array(values, "text")` tidak bisa membawa NULL — Bun menyerialkan elemen `null` menjadi teks empat karakter `"null"` (diprobe terhadap PostgreSQL 18.4 di Bun 1.3.14; varian tanpa tipe pun bukan NULL). Akibatnya impor nyata mengisi setiap kolom nullable dengan `'null'`: 38 provinsi ber-`parent_code` `'null'` dan 7.285 kecamatan ber-`local_term` `'null'`, yang dirender apa adanya oleh layar lookup dan membuat filter `IS NULL` mengembalikan nol baris. Nilai null kini melintas sebagai sentinel dan dipulihkan `NULLIF(t.col, '')` di SELECT — benar juga bila Bun kelak mengirim NULL sungguhan. Digerbangi test integrasi yang hanya bisa merah di database nyata.
