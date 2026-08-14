# ADR-0096 — Akun ANDA SENDIRI bukan permukaan administratif

- **Status:** Diterima (2026-08-14).
- **Konteks:** Permintaan produk — "manajemen profil pengguna". Yang ditemukan
  saat memeriksa kode bukan fitur yang kurang, melainkan **fitur yang sudah
  ada seluruhnya di backend dan tak punya satu pun permukaan**: tujuh belas
  endpoint self-service (`password/change`, `sessions` + `revoke-all`, MFA TOTP
  enroll/verify/disable, recovery codes, `sso/{provider}/link|unlink`,
  `auth/me`) dan **NOL** berkas di `src/pages` atau `src/components` yang
  memanggil satu pun di antaranya. Semuanya hanya bisa dijangkau dengan `curl`.
- **Membangun di atas:**
  [ADR-0058](0058-unenforced-permissions-disposition.md) §E (jebakan latent-authz —
  aksi yang tak di-seed menolak SEMUA ORANG),
  [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (gerbang per-handler,
  kepemilikan masuk sebagai `ownershipGrant` yang MELEBARKAN),
  [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (layar admin SYSTEM
  tinggal di repo ini), dan
  [ADR-0095](0095-the-interface-speaks-the-readers-language.md) (preferensi
  tampilan milik principal).

## Kenapa ADR untuk sebuah halaman

Karena halamannya bukan bagian yang sulit. Yang sulit satu kalimat: **apa yang
boleh diubah seseorang tentang dirinya sendiri tanpa izin apa pun**, dan
jawaban yang salah di sini adalah eskalasi privilese yang menyamar sebagai
editor profil.

Repo ini sudah memutuskan setengahnya secara implisit — `GET /api/v1/auth/sessions`
dan saudara-saudaranya sengaja TIDAK berizin — tetapi keputusan itu tersebar di
komentar tujuh belas berkas dan tidak pernah dituliskan sebagai aturan. Menambah
penulisan (`display_name`) tanpa menuliskannya adalah cara aturan itu menyimpang.

## Keputusan 1 — Subjek yang MENJADI pemanggil tidak butuh izin

Sebuah rute self-service dikenali dari satu sifat struktural, bukan dari niat:
**ia tidak menerima parameter yang bisa menunjuk orang lain.** Bukan
`tenantUserId`, bukan `profileId`, bukan `identityId`. Subjeknya diturunkan
SERVER-side dari sesi yang memanggil, jadi tidak ada yang perlu diotorisasi di
luar "apakah sesi ini hidup".

Menciptakan izin untuk itu bukan sekadar berlebihan, melainkan **merusak**:
ADR-0058 §E mencatat bahwa aksi yang tidak di-seed menolak semua orang termasuk
pemilik tenant, sementara kodenya terbaca seolah dijaga dengan benar. Sebuah
`identity_access.own_profile.update` akan mendarat sebagai 403 universal di
halaman yang justru paling tidak boleh punya tembok — dan
[memori proyek](../awcms/agent-memory.md) mencatat kelas cacat itu sudah
memakan korban di `awcms-admin-abac-write-notes`.

Yang TIDAK dibuat karena itu: tidak ada saudara berizin untuk rute-rute ini.
Mengubah bahasa ATAU nama tampilan ORANG LAIN bukan fitur; yang ada adalah
`PATCH /api/v1/profiles/{id}` yang memang administratif dan memang berizin.

## Keputusan 2 — Rute self-service TERPISAH dari rute administratif yang sepadan

`PATCH /api/v1/auth/profile` menulis kolom yang sama dengan
`PATCH /api/v1/profiles/{id}`. Ia tetap rute KEDUA, bukan pelonggaran rute
pertama.

Alternatif yang ditolak: menambahkan cabang "…atau profil ini milikmu" ke dalam
endpoint berizin. Itu memasukkan pemeriksaan kepemilikan ke dalam permukaan
administratif — bentuk yang persis digantikan ADR-0063 dengan gerbang
per-handler plus `ownershipGrant` yang MELEBARKAN. Sekali satu endpoint punya
dua mode otorisasi, pembacanya harus membuktikan cabang mana yang berlaku
sebelum bisa menyatakan apa pun tentang keamanannya.

Rute terpisah membuat pertanyaannya hilang: yang satu tidak menerima id sama
sekali.

## Keputusan 3 — Self-service menulis SEDIKIT, dan daftarnya beku

Yang boleh ditulis seseorang tentang dirinya: `display_name`, locale, tema, kata
sandi (dengan kata sandi lama), faktor MFA miliknya, sesinya, tautan SSO-nya.

Yang TIDAK, meski duduk di baris tabel yang sama:

| Kolom                               | Kenapa tidak                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legal_name`                        | `verification_status` ada justru karena nama legal DINYATAKAN lalu DIPERIKSA. Subjek yang bisa menulisnya ulang membuat verifikasinya tak bermakna. |
| `status`                            | Menonaktifkan/mengaktifkan diri sendiri adalah keputusan tenant, bukan preferensi.                                                                  |
| `verification_status`, `risk_level` | Penilaian TENTANG orang itu, bukan pernyataan OLEH orang itu.                                                                                       |
| identifier (email/telepon)          | Mengubah alamat login adalah pemulihan akun, bukan penyuntingan profil — ia butuh pembuktian kepemilikan alamat baru, yang bukan lingkup ADR ini.   |

Daftar ini beku dalam arti yang sama seperti daftar ADR-0039: menambahnya adalah
suntingan yang harus dibaca sebagai keputusan keamanan, bukan penambahan field.

## Keputusan 4 — Halamannya CORE, bukan milik modul

`/admin/account` masuk `CORE_NAV_ENTRIES`, bersanding dengan Dashboard.

`sidebar-menu.ts` sudah menulis alasannya sebelum halamannya ada: `/admin/profile`
disebut sebagai "pages this base does not have … they arrive if and when their
pages do". Ini kedatangan itu.

Ia bukan milik `identity_access` karena tiap entri navigasi modul itu
(`Users`, `Roles`, `Invitations`) adalah layar administratif ber-`requiredPermission`,
dan halaman ini tidak punya satu pun — menempatkannya di sana akan
mengelompokkannya dengan hal-hal yang bukan dirinya, di bawah bagian yang
menyiratkan wewenang atas orang lain.

Avatar di topbar menjadi tautan ke sana, memenuhi seam yang sudah didokumentasikan
`AdminLayout.astro` ("micro's points at `/admin/profile`, a page awcms does not
have").

## Konsekuensi

- Tujuh belas endpoint yang sebelumnya hanya bisa dijangkau `curl` mendapat
  permukaan. Ini menutup gap yang `admin:screen-coverage:check` **tidak** bisa
  lihat: gerbang itu bertanya "apakah tiap IZIN diklaim sebuah layar", dan
  rute-rute ini sengaja tak berizin — sehingga permukaan-nol-nya tidak pernah
  memerahkan apa pun.
- Tema kini tersimpan per-manusia, bukan hanya per-perangkat. `localStorage`
  tetap jalur cepatnya (toggle bekerja tanpa jaringan), dan nilai tersimpan
  berlaku di perangkat BARU lewat seam `data-tenant-default-theme` — tanpa
  menyentuh byte skrip init, sehingga hash CSP-nya utuh (ADR-0095).
- Penggantian alamat login TIDAK termasuk, dinyatakan sebagai celah yang
  disadari alih-alih diam: ia menuntut pembuktian kepemilikan alamat baru dan
  itu ADR-nya sendiri.
