---
"awcms": minor
---

feat(auth): sesi orang lain bisa dilihat dan diakhiri — dengan `read` sebagai izin yang LEBIH mahal dari `revoke`

Gelombang 2 PR 2.2 dari #423. `GET /api/v1/users/{id}/sessions` dan
`POST /api/v1/users/{id}/sessions/revoke-all`, ditambah panel sesi di
`/admin/users`. Pasangan self-service yang mendarat di PR 2.1 menyelesaikan
subjeknya dari token pemanggil dan tak bisa diarahkan ke siapa pun; dua endpoint
ini melakukan kebalikannya — subjeknya disebut di URL — jadi keduanya digerbangi,
diaudit, dan dipecah ke **dua** izin.

**Pemecahannya terbalik dari `machine_credentials`, dan justru itu isinya.**
`sql/083` memisah `create`/`revoke` karena hanya satu dari keduanya MENCIPTAKAN
kapabilitas. Di sini yang memisah adalah kebalikannya: hanya satu dari keduanya
MENGUNGKAPKAN sesuatu. `read` adalah jendela permanen ke gerak-gerik seorang
kolega — kapan ia masuk, dari berapa bentuk perangkat, jam berapa — dan itu tetap
bahan pengawasan ketika yang membacanya administrator. `revoke` menghancurkan
akses dan mengembalikan sebuah angka.

Jadi yang dibeli pemecahan ini adalah arah yang penting saat insiden: seorang
responder bisa diberi kemampuan mengeluarkan akun yang diduga jebol dari
mana-mana **tanpa** sekalian diberi pandangan ke pergerakan semua orang. Satu izin
yang mencakup keduanya membuat tindakan darurat yang aman berharga izin permanen
yang tidak aman.

**Sesi pemanggil tidak pernah ikut mati.** `UPDATE`-nya membawa
`token_hash <> ${callerTokenHash}`, dan untuk target selain tenant user pemanggil
sendiri klausa itu tidak mencocoki apa pun — hash token pemanggil tak bisa muncul
di antara sesi identitas lain. Jadi ia gratis di kasus normal dan membeli satu
properti di kasus tidak normal: administrator yang sedang membereskan insiden tak
bisa mengeluarkan dirinya dari konsol yang sedang ia pakai dengan menekan baris
yang kebetulan miliknya. `keptCallerSession` melaporkannya alih-alih diam —
operator yang diberi tahu "3 diakhiri" sementara konsolnya masih hidup perlu tahu
sebabnya, atau ia menyimpulkan kontrolnya tidak bekerja.

Itu bukan lubang: mengeluarkan diri sendiri dari mana-mana adalah
`DELETE /api/v1/auth/sessions/{id}` dan `POST /api/v1/auth/logout`, keduanya tanpa
izin. Endpoint ini menolak menjadi cara ketiga untuk hal yang sudah dilakukan dua
endpoint tak-berizin, dalam satu-satunya susunan di mana melakukannya adalah
kecelakaan.

**Aktivitas `user_sessions` baru, bukan `access_control` yang diperluas** — alasan
yang sama ditulis `sql/075` untuk `registration_requests` dan `sql/083` untuk
`machine_credentials`: melipatnya ke `access_control.read` akan menjadikan setiap
pembaca katalog RBAC seorang pengamat gerak-gerik koleganya, sebagai efek samping,
tanpa satu migrasi pun mengatakannya.

**Empat keputusan yang lebih kecil:**

- **Id yang tak berbentuk UUID dijawab 404, bukan 400.** 400 untuk "bukan uuid"
  plus 404 untuk "tak ada usernya" bersama-sama memberi tahu pemanggil id mana yang
  berbentuk benar DAN id mana yang ada.
- **User nonaktif didaftar kosong, bukan 404.** `setTenantUserStatus` sudah
  mencabut sesinya, jadi daftar kosong adalah jawaban yang diharapkan — dan itulah
  yang sedang diperiksa operator saat itu. 404 tak bisa dibedakan dari salah id.
- **Diaudit meski nol sesi diakhiri.** "Seseorang mencoba mengeluarkan akun ini
  dan tak ada yang tersisa untuk diakhiri" justru entri yang paling dicari
  investigasi; jejak audit yang hanya mencatat aksi efektif tak bisa
  membedakannya dari tak ada yang pernah melihat.
- **Tanpa `Idempotency-Key`.** Panggilan kedua tidak menemukan apa pun yang hidup
  dan melaporkan `revokedCount: 0` — tak ada duplikat untuk ditekan, jadi tak ada
  yang perlu dilindungi respons tersimpan.

`tokenHash` kini ikut diserahkan `defineTenantRoute` ke handler-nya. Nilainya sudah
dihitung seam itu untuk `authorizeInTransaction`; menurunkannya kedua kali di dalam
rute adalah cara dua turunan satu nilai mulai berbeda pendapat.

`sql/101` hanya memperluas katalog global — tenant lama mendapatkannya lewat
`bun run identity-access:permissions:backfill`, yang memberi tepat baris katalog
yang LEBIH BARU dari role-nya sehingga tak bisa menghidupkan kembali izin yang
sengaja dicabut admin.
