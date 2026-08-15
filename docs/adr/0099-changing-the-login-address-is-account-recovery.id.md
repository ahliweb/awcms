🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0099-changing-the-login-address-is-account-recovery.md)

<!-- i18n-source-hash: sha256:a8950f1df818003389121e92c7f5a855717bcfd0f911f6579528b4a42be7a0b4 -->

# ADR-0099 — Mengubah alamat login adalah pemulihan akun, dan dibangun seperti itu

- **Status:** Accepted (belum diimplementasikan)
- **Tanggal:** 2026-08-15
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0096](0096-your-own-account-is-not-an-administrative-surface.id.md) (sengaja mengecualikannya), [ADR-0087](0087-mfa-moves-to-the-principal.id.md) (step-up assurance), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md) (maker/checker), `src/modules/identity-access/`, `src/modules/email/`

## Konteks

`/admin/account` merender alamat masuk dan menyatakan, dengan sejelas itu, bahwa ia tidak bisa diubah di sana karena melakukannya "butuh pembuktian bahwa alamat baru itu milik Anda". ADR-0096 menaruhnya di luar cakupannya sendiri dengan sengaja: semua hal lain di layar itu adalah penyuntingan profil, dan ini bukan.

Alasan mengapa ia bukan layak dinyatakan dengan tepat, karena itulah yang menentukan seluruh desainnya. **Alamat login ADALAH akun itu.** Ia pengenal yang dituju reset kata sandi, jadi siapa pun yang menguasainya bisa memperoleh akun itu tanpa tahu kata sandinya. Kendali yang mengubahnya karena itu adalah kendali yang bisa _memindahtangankan_ sebuah akun, dan ia berjarak satu sesi terbajak dari penyerang yang sama sekali tidak punya kredensial — rantai klasiknya: pinjam sesi selama enam puluh detik, arahkan ulang alamatnya, pergi, lalu reset kata sandinya santai dari alamat yang tak bisa dilihat pemilik aslinya.

Itu menjadikannya tindakan swalayan berisiko paling tinggi di produk ini, di atas penggantian kata sandi di sebelahnya: mengganti kata sandi dengan sesi curian mengunci pemiliknya keluar secara _terlihat_, sedangkan mengganti alamat menguncinya keluar secara _senyap_ sambil menyerahkan kanal pemulihannya.

Jadi pertanyaannya bukan "bagaimana kita mengizinkan orang menyunting field ini". Pertanyaannya "pembuktian apa, dan pemberitahuan apa, yang membuat pemindahan alamat itu aman" — dan brief untuk keputusan ini adalah opsi paling aman yang tersedia, bukan yang paling nyaman.

## Keputusan

1. **Dua alamat harus sama-sama dibuktikan, dan keduanya dibuktikan secara berbeda.**

   - Alamat **baru** dibuktikan dengan token sekali pakai yang dikirim ke sana dan dikembalikan oleh orangnya. Tidak ada yang berubah sampai ia dikembalikan; permintaan yang belum dikonfirmasi bersifat inert.
   - Alamat **lama** tidak diminta membuktikan apa pun — ia _diberi tahu_, seketika, dengan tautan **batalkan** sekali klik yang berlaku lebih lama daripada jendela konfirmasi. Pemiliknya tidak harus menyadarinya tepat waktu untuk menghentikannya; ia hanya harus menyadarinya.

   Desain yang hanya memverifikasi alamat baru adalah yang umum dan persis merupakan lubang pemindahan senyap di atas: kotak surat korban tidak pernah mendengarnya.

2. **Perubahan ini menuntut pembuktian segar atas pemilik SESI SAAT INI.** Otentikasi ulang tepat sebelum permintaan: kata sandi saat ini, dan faktor kedua bila principal punya (step-up ADR-0087, `aal2`). Sesi saja bukan wewenang yang cukup untuk memindahkan kanal pemulihan — justru itulah ancamannya.

3. **Token bersifat sekali pakai, berumur pendek, di-hash saat disimpan, dan TERIKAT.** Ia disimpan sebagai hash — perlakuan yang sama dengan token sesi — dan membawa identitas, alamat saat ini, serta alamat yang diminta. Pengikatan itulah yang mencegah token yang dicetak untuk satu perubahan di-replay setelah perubahan berikutnya; token tak-terikat adalah kredensial pembawa untuk "ubah alamat akun ini menjadi apa pun yang tertulis sekarang".

   Jendela konfirmasi sengaja pendek (jam, bukan hari) sedangkan jendela **pembatalan** dari keputusan 1 lebih panjang. Asimetri itulah intinya: tindakan yang aman mendapat waktu lebih banyak daripada yang berbahaya.

4. **Konfirmasi mencabut setiap sesi lain dan setiap token reset yang masih beredar.** Bila permintaannya milik penyerang, konfirmasi adalah saat aksesnya harus berakhir; bila milik pemiliknya, dikeluarkan dari tempat lain adalah ongkos ringan yang bisa mereka jelaskan. Token reset sama pentingnya dengan sesi — membiarkan satu hidup berarti meninggalkan kunci cadangan di bawah keset yang menunjuk ke alamat _lama_.

5. **Ia dibatasi laju per identitas dan per alamat, dan diaudit sebagai berisiko tinggi** — diminta, dikonfirmasi, dibatalkan, dan kedaluwarsa semuanya dicatat, dengan kedua alamat disamarkan sesuai dokumen 04. Baris audit itulah yang menjawab "kapan kanal pemulihan akun ini berpindah, dan siapa yang meminta", pertanyaan pertama dari insiden apa pun yang bermula di sini.

6. **Alamatnya tidak bebas-bentuk: keunikan ditegakkan saat konfirmasi, bukan saat permintaan.** Memeriksa keunikan ketika permintaan _dibuat_ mengubah formulirnya menjadi orakel keberadaan akun — ketik sebuah alamat, ketahui apakah sudah ada yang masuk dengannya. Memeriksa saat konfirmasi berarti si penjajak harus sudah menguasai alamat yang ia tanyakan, dan pada titik itu ia tidak belajar apa pun yang tak bisa ia pelajari dengan mencoba login.

7. **Ini swalayan saja. Tidak ada saudara administratifnya.** Penalaran ADR-0096 tetap berlaku: mengubah alamat masuk orang lain adalah pengambilalihan akun dengan izin yang menempel padanya. Jalur pemulihan bagi orang yang kehilangan akses ke alamatnya adalah _undangan_ ke identitas baru plus penonaktifan yang lama — dua tindakan teraudit oleh dua permukaan yang sudah ada — bukan satu pengarahan ulang yang senyap.

## Konsekuensi

- **Positif:** rantai pemindahan akun tertutup. Sesi pinjaman tidak bisa memindahkan kanal pemulihan: ia gagal di keputusan 2 tanpa kata sandi, gagal di keputusan 1 tanpa kotak surat baru, dan ia mengumumkan dirinya ke kotak surat lama bagaimanapun juga.

- **Positif:** setiap mode kegagalan _bisa dibalikkan dari sisi korban_. Tautan batal di keputusan 1, pencabutan sesi di keputusan 4, dan jejak audit di keputusan 5 membuat kasus terburuknya adalah gangguan, bukan akun yang hilang.

- **Trade-off, dan ini nyata:** ini lebih banyak mesin daripada kendali mana pun di `/admin/account` — sebuah tabel token, dua templat email, empat endpoint, dan satu layar konfirmasi — untuk sebuah field yang kebanyakan orang ubah sekali. Alternatifnya adalah versi yang ada di banyak produk dan diam-diam kehilangan akun, dan repo ini sudah mencatat berapa ongkosnya menemukan sebuah kendali ternyata dekoratif baru setelah produksi.

- **Trade-off:** pemilik yang kehilangan akses ke alamat lama sama sekali tidak bisa memakai alur ini, secara konstruksi. Keputusan 7 menyebutkan jalur yang melayaninya, yang sengaja bersifat administratif dan teraudit alih-alih otomatis.

- **Netral:** surat keluarnya menumpang outbox dan daftar penyaringan `src/modules/email` yang sudah ada. Kedua pemberitahuan bersifat transaksional dan harus dikecualikan dari logika penyaringan yang akan membuat bounce sebelumnya membungkam peringatan keamanan di keputusan 1.

- **Ditolak: ubah-saat-konfirmasi tanpa memberi tahu alamat lama.** Ia memverifikasi hal yang benar dan memberi tahu orang yang salah. Pemberitahuan adalah satu-satunya bagian desain ini yang menolong orang yang _sudah_ dikompromikan, dan justru kasus itulah yang tak bisa dijangkau bagian selebihnya.
