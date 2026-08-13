---
"awcms": minor
---

feat(privacy): hak subjek data punya PERMUKAAN — ekspor yang menyatakan cakupannya, dan penghapusan yang tak bisa disetujui pemintanya (ADR-0094, #557)

ADR-0094 mendaratkan fondasi dan gelombang 2 (#558) membawa ledger utang ke NOL.
Yang tersisa adalah yang issue ini namai: **permukaannya**. Empat rute, empat izin,
satu tabel, satu aturan SoD, satu layar.

## Ekspor: sebuah PENGUNGKAPAN, dan laporannya menyatakan cakupannya sendiri

`POST /subject-requests/export` merakit jawaban dari registry `subjectData` —
bukan dari daftar tabel tulis-tangan, yang justru kelas cacat yang melahirkan
seluruh mekanisme ini. Ia diaudit `subject_data.disclosed` pada `critical`, bukan
sebagai pembacaan, karena ADR-0094 Keputusan 3 menulis alasannya: siapa pun yang
bisa mengekspor subjek mana pun bisa mengeksfiltrasi seluruh basis pengguna satu
permintaan pada satu waktu. Pembacaan yang tak meninggalkan jejak membuat kalimat
itu tak bisa diperiksa, jadi satu baris `awcms_subject_requests` mendarat di
transaksi yang sama.

**Responsnya membawa `unanswered`**: tiap tabel yang rencananya sengaja TIDAK
jangkau — global (ADR-0094 Keputusan 1) atau tak punya kolom yang bisa dicocokkan
— beserta alasan yang ditulis modul pemiliknya. Laporan subjek yang tidak lengkap
DAN tidak mengatakannya lebih buruk daripada tidak ada laporan, karena ia
ditandatangani.

## Penghapusan: maker/checker, dan lapisan yang tidak bisa dibalap

`POST .../erase` MEREKAM dan tidak menghapus apa pun; `POST .../{id}/decide`
menyetujui (dan menjalankan) atau menolak. Empat lapis, dan tiap lapis menangkap
kegagalan yang tidak ditangkap lapis lain:

1. **Dua izin terpisah** — `subject_erasure.create` vs `.approve`. Maker dan
   checker yang berbagi satu kunci bukan maker/checker sama sekali.
2. **Aturan SoD `critical`** — memegang keduanya adalah konflik. `exceptionPolicy`
   sengaja `allowed: true` dengan 7 hari (bukan 14 seperti legal hold, dan bukan
   `false`): aturan yang melarang pengecualian tidak punya baris tertunda untuk
   dilihat checker, jadi satu-satunya jalan keluar saat insiden adalah perubahan
   grant di luar sistem yang tak seorang pun review.
3. **CHECK constraint `decided_by <> requested_by`** — invarian per-baris yang
   ditegakkan di JS bisa dibalap, dan repo ini sudah membayar pelajaran itu
   (lockout login dulu read-modify-write, K percobaan paralel = 1 increment).
4. **Klaim bersyarat satu UPDATE** — `status = 'pending_approval'` ada di `WHERE`,
   jadi approval kedua yang tiba bersamaan tidak cocok satu baris pun dan tidak
   pernah sampai ke penulisan. Baca-lalu-tulis akan menjalankan penghapusan yang
   tak bisa dibalik DUA KALI.

**Eksekutornya menulis ke ~7 tabel, bukan ~100.** `erasureTargets` menjatuhkan
setiap deskriptor `severed_with_subject_row` — itulah gunanya anggota union yang
gelombang 2 tambahkan. Eksekutor yang mengulang `plan.entries` akan menulis ulang
sembilan puluh kolom stempel dan menghancurkan catatan tenant tentang siapa
menghapus sebuah halaman, demi memutus tautan yang sudah tak teresolusi.

Kolom yang tipenya tidak bisa memuat sentinel TIDAK diam-diam dilewati: ia
dilaporkan di respons DAN di baris audit, karena kolom yang gagal ditulis adalah
justru hal yang paling ingin ditemukan reviewer kepatuhan nanti.

## Tabel barunya menjawab pertanyaannya sendiri

`awcms_subject_requests` mendapat deskriptor `subjectData` DAN `dataLifecycle`,
karena kedua gerbang menuntutnya untuk tabel baru — modul ini memakan makanannya
sendiri. Jawaban penghapusannya `retain_under_obligation`, dan itu satu-satunya
yang tidak melumpuhkan diri sendiri: baris yang membuktikan sebuah penghapusan
terjadi harus hidup lebih lama daripada penghapusan itu. Retensinya
`audit_security` dengan LANTAI 730 hari, bukan `operational_queue` seperti tabel
lain modul ini.

## Layar, dan tiga gerbang yang terpisah

`/admin/subject-requests`. Bacanya digerbangi `subject_request.read` yang
mengungkapkan NOL data subjek — supaya petugas perlindungan data bisa memantau
antrean tanpa memegang otoritas mengekspor atau menghapus siapa pun. Ekspor,
minta-hapus, dan putuskan masing-masing memeriksa kuncinya SENDIRI: menurunkan
ketiganya dari gerbang baca akan menawarkan operator tombol yang 403 saat submit
— jebakan latent-authz yang sudah tercatat dua kali di repo ini. Karena kedua
paruh penghapusan adalah konflik SoD, di tenant yang dikonfigurasi benar TIDAK
ADA yang melihat form permintaan dan tombol keputusan sekaligus; halamannya
dibangun untuk itu sebagai keadaan normal.

Hasil ekspor dirender ke halaman dan tidak ke mana pun lagi — tanpa unduhan,
tanpa berkas server. Memberinya URL akan memberinya umur di luar sesi yang
diizinkan dan diaudit.
