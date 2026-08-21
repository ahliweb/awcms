🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0103-newsletter-is-its-own-module.md)

<!-- i18n-source-hash: sha256:c07ca6c3b74c2037a8ff75928f50143729909da34a34d0b678d970e689858d2f -->

# ADR-0103 — Daftar pelanggan menjadi modulnya sendiri, dan endpoint publiknya tidak memberi tahu siapa pun apa pun

- **Status:** Accepted
- **Tanggal:** 2026-08-21
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #598; PRD LenteraKalteng §22, §30, FR-NWL-002, FR-NWL-004, FR-NWL-005; ADR-0055 (gerbang reuse); ADR-0041 (`comments` — tulis publik anonim yang lain); ADR-0094 (hak subjek data)

## Konteks

Tidak ada kapabilitas newsletter dalam bentuk apa pun, dan ini mudah dikira sudah ada.

Modul `email` lengkap dan matang: template dengan allow-list variabel per-kategori, dispatcher outbox dengan lease claiming, retry dan backoff, circuit breaker, serta penekanan per-alamat. **Ia dapat MENGIRIM surat.**

Yang tidak ada adalah hal yang berbeda: **daftar pelanggan yang bisa dimasuki seorang pembaca dari halaman publik.** Tidak ada tabel subscriber, tidak ada endpoint yang bisa di-POST siapa pun, tidak ada double opt-in, tidak ada unsubscribe, tidak ada layar admin. "Modul email bisa mengirim" dan "ada daftar langganan" adalah dua kapabilitas, dan hanya satu yang ada.

Portal legacy MEMILIKI ini dan sudah live (`subscribe.php` + `newsletter_subscribers` + admin, sejak 16 Agustus 2026). Jadi memigrasikan SeputarBorneo sebagai tenant kedua akan menjadi REGRESI fungsional, bukan sekadar celah fitur.

### Gerbang reuse, dijalankan sebelum membangun apa pun

ADR-0055 mewajibkan bertanya apakah kapabilitas yang diinginkan adalah perluasan modul yang sudah ada.

**`email` — ditolak, dan ini yang menarik.** Ia rumah yang paling jelas: daftarnya adalah daftar alamat email, dan `email` sudah memiliki alamat, penekanan, dan pengiriman. Alasannya salah adalah PERSETUJUAN. `email` menjawab "boleh tidak alamat ini ditulisi, dan apakah pesannya sampai" — pertanyaan OPERASIONAL tentang keterkiriman. Sebuah langganan menjawab "apakah seseorang memintanya, kapan, dari mana, dan bisakah ia membuktikan bahwa ia berhenti meminta" — pertanyaan HUKUM tentang persetujuan, yang catatannya harus bertahan terlepas dari apakah ada pesan yang pernah dikirim.

Menggabungkan keduanya akan membuat `awcms_email_suppressions` mengerjakan dua tugas: ia akan berarti "alamat ini bounce" DAN "orang ini menarik persetujuannya" dalam satu kolom, sementara yang pertama adalah fakta operasional yang boleh dibersihkan operator dan yang kedua adalah keputusan yang tidak boleh. Tabrakan itu punya namanya sendiri di repo ini — satu kata menutupi dua hal, dan yang akhirnya salah adalah yang legal (`sql/137` mengajukan argumen yang sama tentang `media.verify`).

**`profile_identity` — ditolak.** Seorang pelanggan bukan pengguna. Ia tidak punya akun, sesi, atau keanggotaan tenant, dan memberinya baris di graf identitas akan membuat "siapa yang punya akses ke tenant ini" menjadi pertanyaan dengan jawaban yang jauh lebih besar dan jauh kurang menarik.

**`comments` — ditolak**, meski ia analogi struktural terdekat (tulis publik anonim, moderasi, isolasi per-tenant). Piagamnya adalah diskusi yang menempel pada sebuah resource. Sebuah langganan tidak menempel pada apa pun.

## Keputusan

**`newsletter` menjadi modulnya sendiri**, memiliki satu tabel, tiga endpoint publik anonim, dan satu layar admin.

### Siklus hidupnya empat status, dan yang keempat bukan yang ketiga

`pending` → `active`, dengan `unsubscribed` dan `suppressed` sebagai cabang terminal.

`unsubscribed` adalah keputusan PELANGGAN. `suppressed` adalah keputusan OPERATOR atau penyedia — hard bounce, laporan penyalahgunaan, instruksi hukum. Keduanya dipisahkan karena berlangganan ulang diizinkan dari yang satu dan tidak dari yang lain: seseorang yang berhenti pada Maret boleh mendaftar lagi pada Juni, dan mengizinkannya itu benar. Alamat yang ditangguhkan karena penyalahgunaan tidak boleh bisa ditambahkan ulang oleh orang yang menyalahgunakannya, dan satu status `inactive` tunggal akan menjadikan itu soal mengingat alih-alih soal tipe.

### Double opt-in, dan token konfirmasinya di-hash

Sebuah baris dimulai `pending` dan tidak membawa cap waktu persetujuan. `consent_at` ditulis ketika tautan konfirmasi DIIKUTI — tidak pernah saat pengiriman formulir — sehingga catatannya menyatakan apa yang benar-benar terjadi.

Kedua token disimpan TER-HASH, tidak pernah mentah. Keduanya adalah kredensial pembawa: siapa pun yang memegang token konfirmasi dapat mengonfirmasi langganan, dan siapa pun yang memegang token unsubscribe dapat mengakhirinya. Pembacaan basis data tidak boleh menyerahkan keduanya, dengan alasan yang sama token sesi disimpan ter-hash.

Token unsubscribe STABIL sepanjang umur barisnya, karena ia dicetak di footer setiap pesan yang akan pernah diterima pelanggan itu. Merotasinya akan merusak setiap tautan yang sudah ada di kotak masuk seseorang.

### Endpoint publiknya bukan oracle enumerasi

`POST /api/v1/newsletter/subscribe` anonim dan ber-rate-limit per IP. Ia menjawab **body netral yang SAMA untuk setiap hasil**: alamat baru, alamat yang sudah `active`, alamat yang `suppressed`, dan alamat cacat yang lolos pemeriksaan bentuk. Ia tidak pernah menyebut yang mana.

Inilah keputusan yang berbiaya dan sepadan. Respons yang membedakan mengubah endpoint publik menjadi cara bertanya "apakah orang ini berlangganan daftar ruang redaksi ini", dan untuk situs berita di Kalimantan Tengah itu pertanyaan dengan konsekuensi bagi orang yang ditanyakan. Biayanya: pembaca yang salah mengetik alamatnya tidak mendapat umpan balik selain "periksa surat Anda" — diterima, dan pertukaran yang sama sudah dibuat `POST /api/v1/auth/password/forgot` di sini.

Idempotensi (FR-NWL-005) jatuh dari desain yang sama: POST kedua atas alamat yang sama tidak membuat baris kedua, dan tidak memberi tahu pemanggil bahwa ia tidak membuatnya.

### Unsubscribe tidak pernah menuntut login

PRD §30. Endpoint unsubscribe menerima token dan tidak lebih — tanpa sesi, tanpa header tenant, tanpa alamat email. Menuntut salah satunya berarti seseorang yang ingin keluar harus membuktikan dirinya lebih dulu, yang sekaligus tidak ramah dan tidak perlu: tokennya sudah membuktikan ia memegang tautannya.

### Isolasi tenant adalah FORCE RLS, dan diuji secara negatif

FR-NWL-002. Pelanggan satu tenant tidak boleh terlihat oleh tenant lain, dan endpoint anonimnya menyelesaikan tenant dari HOST permintaan alih-alih sebuah header, sehingga pemanggil tidak bisa memilih daftar siapa yang sedang ia tulisi.

### Deskriptor retensi dan hak subjek bukan opsional

Alamat email adalah data pribadi. `subject-data:coverage:check` menuntut deskriptor dan akan menolak tabelnya tanpa itu. Baris `pending` yang konfirmasinya tidak pernah diikuti disimpan sebentar lalu dihapus — ia catatan tentang permintaan yang tidak selesai, dan menyimpannya selamanya berarti menyimpan alamat yang tidak seorang pun setujui.

## Konsekuensi

- Satu modul lagi, satu tabel lagi, tiga rute publik lagi yang harus di-rate-limit.
- Respons netral membuat penelusuran masalah langganan lebih sulit bagi staf dukungan; layar admin adalah tempat status sebenarnya terlihat, di balik gerbang.
- Tenant yang belum mengonfigurasi templat `derived.newsletter_confirmation` tidak mengirim surat konfirmasi, sehingga langganannya tetap `pending`. Itu kegagalan yang BENAR — mengaktifkan diam-diam tanpa konfirmasi adalah yang salah — dan layar admin menampilkan hitungannya sehingga hal itu bisa ditemukan.
