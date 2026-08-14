---
"awcms": minor
---

feat(identity): akun Anda sendiri akhirnya punya PERMUKAAN (ADR-0096)

Permintaan "manajemen profil pengguna" menemukan bukan fitur yang kurang,
melainkan fitur yang **sudah ada seluruhnya di backend dan tak punya satu pun
permukaan**: tujuh belas endpoint self-service — ganti kata sandi, daftar sesi
dan pencabutannya, enrol/matikan MFA TOTP, kode pemulihan, tautan SSO — dan
**NOL** berkas di `src/pages` atau `src/components` yang memanggil satu pun.
Semuanya hanya bisa dijangkau dengan `curl`.

Kenapa tak ada yang melihatnya: `admin:screen-coverage:check` bertanya "apakah
tiap IZIN diklaim sebuah layar", dan rute-rute ini **sengaja tak berizin**.
Permukaan-nol-nya karena itu tidak pernah memerahkan gerbang mana pun.

Halamannya bukan bagian yang sulit. Yang sulit satu kalimat: **apa yang boleh
diubah seseorang tentang dirinya sendiri tanpa izin apa pun** — dan jawaban yang
salah di situ adalah eskalasi privilese yang menyamar sebagai editor profil.
Karena itu daftarnya ditulis dan DIBEKUKAN: `display_name`, locale, tema, kata
sandi (dengan kata sandi lama), faktor MFA, sesi, tautan SSO. TIDAK termasuk
`legal_name` (`verification_status` ada justru karena nama legal dinyatakan lalu
DIPERIKSA), `status`, `verification_status`, `risk_level`, dan identifier —
mengganti alamat login adalah PEMULIHAN AKUN yang menuntut pembuktian
kepemilikan alamat baru, dinyatakan sebagai celah yang disadari alih-alih
didiamkan.

**Rute self-service TERPISAH, bukan pelonggaran rute administratif.**
`PATCH /api/v1/auth/profile` menulis kolom yang sama dengan
`PATCH /api/v1/profiles/{id}`, tetapi ia tidak menerima id sama sekali — subjeknya
diturunkan dari sesi. Menambahkan cabang "…atau ini milikmu" ke endpoint berizin
akan memasukkan pemeriksaan kepemilikan ke permukaan administratif (bentuk yang
digantikan ADR-0063), dan sekali sebuah endpoint punya dua mode otorisasi,
pembacanya harus membuktikan cabang mana yang berlaku sebelum bisa menyatakan
apa pun tentang keamanannya.

Dua gerbang menolak draf pertama, keduanya benar:

- `modules:table-writes:check` — `awcms_profiles` milik `profile_identity`, dan
  `identity_access` memiliki permukaan `/api/v1/auth/*` TIDAK menjadikannya
  ko-pemilik baris itu (ADR-0013 §6). Tulisannya pindah ke
  `updateOwnDisplayName` di modul pemiliknya, yang menerima id IDENTITAS dan
  bukan id profil — itulah yang membuatnya self-service alih-alih administratif.
- `access:chokepoint:check` — tiap layar admin wajib melewati chokepoint. Layar
  ini tak punya izin masuk untuk dievaluasi, dan menciptakannya adalah jebakan
  ADR-0058 §E persis: aksi yang tak di-seed menolak SEMUA ORANG termasuk pemilik
  tenant, di halaman yang dituju orang saat mengira kata sandinya bocor.
  `authorize: []` juga bukan jawabannya — ia MENOLAK, fail-closed, dan aturan itu
  dipertahankan apa adanya.

  Jadi lahir `loadSelfServiceScreen`: fungsi TERPISAH (bukan flag pada
  `loadAdminScreen`, yang akan membuat helper pengotorisasi kadang-kadang tidak
  mengotorisasi), tetap membuka satu transaksi tenant ber-work-class, menuntut
  `selfServiceReason` tertulis, dan dibatasi daftar ter-enumerasi di
  `tests/admin-screen-self-service.test.ts` — satu entri, dan berbar seperti
  `BOUNDED_BY_DESIGN`.

Tema kini tersimpan per-MANUSIA, bukan hanya per-perangkat. `localStorage` tetap
jalur cepatnya (toggle bekerja tanpa jaringan) dan nilai tersimpan berlaku di
perangkat BARU lewat seam `data-tenant-default-theme` — tanpa menyentuh byte
skrip init, sehingga hash CSP-nya utuh.

Avatar di topbar menjadi tautan, memenuhi seam yang komentar `AdminLayout.astro`
sendiri catat sejak lama ("micro's points at `/admin/profile`, a page awcms does
not have").

Gerbang `i18n:catalog:check` juga diperbaiki di sini: ia melaporkan `t("Light")`
yang muncul di dalam KOMENTAR sebagai msgid tak dideklarasikan. Godaannya adalah
menulis ulang komentarnya; itu terbalik — ia menjadikan false positive sebagai
pajak permanen atas penulisan komentar. Gerbangnya kini membuang komentar lebih
dulu, dengan pemindai yang melacak state string supaya `//` di dalam `"https://…"`
tidak menelan sisa barisnya (false negative di gerbang cakupan lebih buruk
daripada false positive yang diperbaikinya).
