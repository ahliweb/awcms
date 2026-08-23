🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0108-what-an-export-withholds-and-what-an-erasure-destroys-are-different-questions.md)

<!-- i18n-source-hash: sha256:bbbf08f0bb8775722467f2c6e4d58e0c513c4f5489778a39cc593320a226938f -->

# ADR-0108 — Apa yang DITAHAN sebuah ekspor dan apa yang DIHANCURKAN sebuah penghapusan adalah dua pertanyaan berbeda

- **Status:** Accepted
- **Tanggal:** 2026-08-23
- **Pengambil keputusan:** ahliweb
- **Terkait:** ADR-0094 (hak subjek data); Issue #557 (eksekutornya); ADR-0013 §6 (sebuah modul memiliki jawaban tabelnya sendiri); `MODULE_CONTRACT_VERSION` 4.1.0

## Konteks

`SubjectDataDescriptor` punya satu daftar kolom, `redactedColumns`, yang didokumentasikan sebagai _"kolom yang TIDAK BOLEH dibawa ekspor portabilitas — hash, token, rahasia"_. Eksekutor penghapusan memakai daftar yang SAMA sebagai himpunan kolom yang ditimpa oleh penghapusan `anonymize`.

Untuk tabel yang kedua jawabannya kebetulan sama, itu bekerja sempurna. `awcms_identities.password_hash` tidak boleh diekspor dan harus dihancurkan; satu daftar, satu deklarasi, perilaku benar. Sembilan dari dua belas deskriptor `anonymize` berbentuk begitu — itulah sebabnya tidak ada yang tampak salah.

**Untuk tabel yang memuat identitas orangnya sendiri, kedua jawaban itu berlawanan**, dan satu daftar memaksa penulisnya memilih yang keliru:

- `awcms_profiles` memuat `display_name` dan `legal_name`. Keduanya harus **diekspor** — permintaan akses subjek justru sebagian besar tentang itu — dan harus **dihancurkan** oleh penghapusan. Mendeklarasikannya berarti menahannya dari ekspor milik subjek sendiri, jadi deskriptornya tidak mendeklarasikan apa pun. Komentarnya sendiri menyebut keduanya _"SALINAN detail pribadi yang tinggal di sini"_ yang dibiarkan berdiri oleh anonimisasi identitas. Penghapusannya pun membiarkannya berdiri.
- `awcms_identities.login_identifier` — alamat yang dipakai orang itu masuk. Jebakan sama, hasil sama: hanya `password_hash` yang pernah ditulis.
- `awcms_registration_requests` memuat nama dan alamat yang disuplai orangnya sendiri. Komentarnya menyatakan itu. Ia tidak menamai satu kolom pun, jadi `anonymize`-nya menulis **tidak ada apa-apa**.
- `awcms_invitations`: komentarnya berbunyi _"`login_identifier` dan `display_name` adalah detail kontak undangan itu sendiri… Memutus identitas TIDAK menjangkau keduanya, dan justru itu sebabnya inilah jawabannya"_ — sementara kodenya hanya menjangkau `token_hash`.
- `awcms_comments_comments` menyimpan `author_display_name` dan `author_email_masked`; `awcms_visitor_sessions` menyimpan `login_identifier_snapshot`, yang rasionalnya sendiri bilang _"penghapusan harus menjangkau dan membersihkannya"_.

Di setiap kasus, prosa deskriptornya menggambarkan perilaku yang benar dan mekanismenya tidak bisa menyatakannya. Diverifikasi terhadap database nyata: setelah penghapusan selesai, `SELECT login_identifier FROM awcms_identities` masih mengembalikan `subject@example.test`.

Tiga konsekuensi membuatnya lebih buruk daripada sekadar daftar kolom yang tertinggal:

1. **~90 deskriptor menjawab `severed_with_subject_row`** dengan premis tertulis bahwa menganonimkan `awcms_identities` membuat stempel mereka tidak menunjuk siapa pun. Stempel yang menunjuk baris yang masih membawa alamat login menunjuk seseorang. Premis yang menopang jawaban mayoritas itu keliru.
2. **Kolom yang tak muat sentinel dilewati diam-diam**, dilaporkan dalam daftar `skippedColumns` yang tak diasersikan siapa pun. `awcms_visitor_sessions.ip_address` (`inet`) dan `awcms_visit_events.geo` (`jsonb`) selamat dari setiap penghapusan lewat jalur itu.
3. **Penghapusan bisa gagal total.** `awcms_invitations.token_hash` UNIQUE secara global; orang yang mengirim dua undangan akan membuat keduanya ditulis ulang menjadi sentinel `[erased]` yang sama — `23505` di tengah transaksi, setelah permintaannya telanjur diklaim. `awcms_profile_identifiers.value_hash` dan `awcms_email_suppression_list.recipient_hash` berbentuk sama.

## Keputusan

**Dua pertanyaan mendapat dua deklarasi.**

- `redactedColumns` — bolehkah subjek diberi ini? Semantik tidak berubah, nilai tidak berubah.
- `anonymizedColumns` — haruskah penghapusan menghancurkan ini? Baru. Sebuah kolom bisa berada di keduanya, salah satu, atau tak satu pun — dan ketiga tabel di atas membuktikan keempat kombinasi itu nyata.

Eksekutor menulis apa yang dinamai `anonymizedColumns`. Setiap deskriptor `anonymize` diperbarui dalam perubahan yang sama, jadi tidak ada tabel yang kehilangan perilaku yang sudah dimilikinya.

### Gerbangnya yang menjadi inti, bukan dua belas suntingannya

`subject-data:registry:check` kini menolak:

- deskriptor `anonymize` yang tidak menamai **satu pun** `anonymizedColumns` dan tidak punya kolom subjek `jsonb_array_contains` — kombinasi itu persis "melaporkan anonimisasi, tidak menulis apa pun";
- entri `anonymizedColumns` yang menamai kolom yang tidak dimiliki tabelnya. Redaksi salah eja membocorkan kolom ke ekspor yang bisa dilihat orang; anonimisasi salah eja meninggalkan data pribadi di database dan menyebut dirinya selesai;
- jawaban `severed_with_subject_row` ketika jangkar pemutusannya sendiri tidak menganonimkan apa pun. Klausa ketiga itulah yang keliru selama berbulan-bulan, dan itulah yang mengikat ~90 jawaban mayoritas ke pemutusan yang benar-benar terjadi.

### Keunikan DITURUNKAN, bukan dideklarasikan

Kolom yang berada di bawah index unique mana pun mendapat sentinel unik per-baris (`[erased]:<uuid>`) alih-alih yang dipakai bersama. Kolom mana saja itu dibaca dari `pg_index` di dalam transaksi yang sama, berdampingan dengan pembacaan `information_schema` yang sudah dilakukan eksekutor.

Flag `unique: true` pada deskriptor ditolak: ia salinan kedua dari skema, dipelihara tangan, di berkas yang penulisnya tidak punya alasan melihat definisi index — dan salinan basi gagal sebagai `23505` di tengah penghapusan yang sudah diklaim. Index parsial ikut dihitung, karena keunikan `awcms_invitations` bersifat parsial dan dua undangan pending justru kasus yang bertabrakan.

### Tipe yang tak muat sentinel bukan alasan lolos

Kolom `jsonb`/`json` disetel menjadi dokumen kosong — `awcms_email_messages.variables` memuat data merge saat sebuah pesan dirender, dan di situlah nama penerimanya tinggal. Kolom bertipe lain yang NULLABLE disetel NULL, karena "terhapus" adalah persis yang dikatakan NULL untuk kolom yang memang boleh kosong sejak awal. Hanya kolom NOT NULL bertipe yang tak bisa ditulis yang masih dilaporkan sebagai skipped, dan uji integrasi kini menegaskan daftar itu KOSONG untuk registry sungguhan — jadi kolom semacam itu berikutnya menggagalkan tes, bukan dilaporkan kepada siapa-siapa.

### `awcms_tenant_users` berganti jawaban

Ia `anonymize` dan tidak menamai apa pun, dan rasionalnya sendiri menjelaskan sebabnya: _"Ia tidak membawa detail pribadi apa pun selain tautannya."_ Itulah definisi `severed_with_subject_row`. Di bawah gerbang baru jawaban lama adalah kegagalan; di bawah jawaban baru laporannya menyatakan apa yang sungguh terjadi.

## Konsekuensi

- **Positif:** penghapusan yang dieksekusi kini menghancurkan nama orangnya, nama legalnya, alamat loginnya, alamat dan nama pada undangan yang ia kirim, nama di bawah komentarnya yang terbit, pengenal termaskingnya, alamat yang ia suppress, alamat IP-nya, dan geografi kasarnya. Janji ADR-0094 menjadi benar, bukan sekadar dimaksudkan.
- **Positif:** penghapusan tidak bisa lagi gagal pada subjek yang punya dua baris di satu tabel.
- **Positif:** jawaban mayoritas `severed_with_subject_row` kini berjangkar pada pemutusan yang sudah diperiksa gerbang.
- **Negatif / kompromi:** dua belas deskriptor bertambah satu daftar, dan penulis deskriptor berikutnya harus menjawab dua pertanyaan. Itu ongkos dari kenyataan bahwa keduanya memang berbeda; gerbangnya menolak diam pada yang penting.
- **Negatif / kompromi:** `login_identifier` yang teranonimkan berbentuk `[erased]:<uuid>`, yang bukan alamat surel yang masuk akal. Tidak ada yang mengurai kolom itu sebagai alamat — ia dibandingkan kesetaraannya saat login dan tidak di tempat lain — tetapi laporan yang merendernya akan menampilkan sentinel itu.
- **Netral:** penghapusan yang sudah SELESAI tidak diperbaiki surut. Deployment yang sudah pernah mengeksekusi permintaan penghapusan menyimpan baris yang seharusnya dibersihkan perubahan ini, dan menjalankannya ulang adalah keputusan operator dengan jejak auditnya sendiri, bukan sebuah migrasi.

## Alternatif yang dipertimbangkan

- **Melebarkan makna `redactedColumns` menjadi keduanya.** Ditolak: itu menahan nama subjek dari ekspor akses-subjeknya sendiri, yang justru hal spesifik yang menjadi alasan hak portabilitas ada. Deskriptor yang ada sudah memilih "ekspor benar, hapus tidak apa-apa" ketimbang itu, dan pilihan mereka tepat.
- **Menganonimkan setiap kolom teks dari tabel `anonymize`.** Ditolak. `awcms_tenant_auth_policies.allowed_email_domains` adalah kebijakan TENANT, bukan data subjek — aturan pukul rata akan menghancurkan konfigurasi tenant saat seseorang dihapus. Modul pemiliknya yang memutuskan apa yang pribadi (ADR-0013 §6); tugas mesin adalah melakukan yang diperintahkan dan menolak tidak diperintahkan apa pun.
- **Mendeklarasikan keunikan di deskriptor.** Ditolak — lihat di atas. Diturunkan lebih baik daripada dideklarasikan di mana pun database sudah tahu.
- **Menghapus barisnya alih-alih menganonimkan.** Ditolak dengan alasan yang sudah dicatat kosakatanya: id-id ini adalah target FK dari audit event, log keputusan, dan catatan penghapusan itu sendiri.
