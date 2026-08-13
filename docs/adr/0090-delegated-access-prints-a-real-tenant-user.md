# ADR-0090 — Akses terdelegasi mencetak tenant user SUNGGUHAN

- **Status:** Diterima (2026-08-13).
- **Konteks:** Issue #423 Gelombang 8 PR 8.2. Migrasi `sql/117`.
- **Membangun di atas:**
  [ADR-0089](0089-a-partner-is-an-ordinary-tenant.md) (partner adalah tenant
  biasa; jangkauan adalah data, dan barisnya milik tenant TARGET),
  [ADR-0050](0050-bff-session-handoff-code.md) (artefak ber-hash berumur pendek
  yang MENCETAK sesi segar — bentuk yang dipinjam persis di sini),
  [ADR-0082](0082-an-invitation-carries-its-own-policy.md)
  (`materializeMembership`: satu penulis keanggotaan, dan ia menolak role
  sistem), dan [ADR-0085](0085-one-human-one-credential-many-tenants.md)
  (manusia yang menebus sudah punya kredensial global — tanpa itu ADR ini
  harus menciptakan kredensial kedua untuk orang yang sama).

## Keputusan

Sebuah grant yang ditebus **tidak menghasilkan aktor jenis baru.** Ia
menghasilkan baris `awcms_tenant_users` biasa di tenant target, terikat role
yang **dipilih pelanggan**, dengan tanggal mati.

Itu seluruh idenya: **RLS, decision log, audit, SoD, dan business-scope facts
bekerja tanpa satu pun perubahan**, karena aktornya memang benar-benar tenant
user di sana. Alternatifnya — sebuah "aktor partner" yang bukan tenant user —
menuntut setiap pembaca otorisasi di repo ini belajar bentuk kedua, dan yang
lupa belajar akan gagal terbuka.

Yang menyeberangi batas antar-organisasi adalah **kode penebusan berumur
pendek** (`awcmsd_…`, hash `dg-sha256:`), bukan kredensial hidup dan bukan
pembacaan lintas-tenant.

## Tidak ada role `support` yang ditanam platform

Rencana Gelombang 8 menulis "terikat role `support` terbatas". Diperiksa:
**role di repo ini adalah baris PER-TENANT**, dan satu-satunya yang ditanam
adalah `owner` (`platform-bootstrap.ts`). Menanam `support` ke setiap tenant
menuntut seed migration **plus backfill** — seed hanya menjangkau tenant yang
dibuat sesudahnya, dan tenant lama akan diam-diam 403, jebakan yang sudah
tercatat di repo ini.

Tetapi keberatan yang sebenarnya bukan mekanis. Menanam `support` berarti
**platform memutuskan apa yang boleh disentuh partner di dalam tenant orang
lain.** ADR-0089 baru saja menolak bentuk itu untuk pertanyaan siapa partnernya;
menerimanya untuk pertanyaan apa yang boleh dilakukannya akan membatalkannya
dari sisi lain.

`role_id` menunjuk role yang **sudah ada di tenant target**. Pelanggan memilih.
`materializeMembership` menolak role `is_system`, jadi `owner` bukan pilihan —
penolakan yang sudah ada dan kini menanggung beban baru.

## Satu hal yang pilihan role TIDAK bisa batasi

Pilihan role adalah kontrol umumnya. Ada satu hal yang tidak bisa ia batasi
dengan aman: **otoritas access-control**.

Aktor terdelegasi yang boleh memberi role, membuat grup, atau menyetel kebijakan
dapat menciptakan kuasa yang **hidup melewati grantnya sendiri**. Cabut
grantnya, matikan tenant usernya, dan baris yang ia berikan kepada orang lain
tetap ada. **Pencabutan berhenti menjadi pencabutan** — dan tidak ada satu pun
gerbang yang akan menyebutkannya, karena setiap langkahnya sah.

Karena itu chokepoint menolak, deny-only, di atas `fetchGrantedPermissionKeys`
bersama gerbang struktural lain (aturan lintas-gelombang 1): **di modul
`identity_access`, aktor terdelegasi hanya MEMBACA.**

Bentuknya satu kalimat, bukan daftar aksi. Daftar aksi akan menua diam-diam
setiap kali modul itu menumbuhkan aktivitas baru, dan yang menua di sini adalah
lubang. Melebarkannya kelak menuntut menyebut aksi mana dan mengapa aksi itu
tidak bisa menciptakan persistensi. Kegagalannya juga berpihak dengan benar:
terlalu ketat berarti pelanggan mengerjakan sendiri satu langkah, bukan lubang
keamanan.

## `principal_kind` ada di `awcms_tenant_users`, bukan di sesi

Gerbang itu harus bisa dijawab oleh **setiap** jalur yang sampai ke chokepoint,
dan ada dua: lewat sesi (`resolveTenantPrincipal`) dan lewat tenant user
langsung (`resolveTenantPrincipalForTenantUser`, jalur kredensial mesin).

Menyandarkannya pada `awcms_sessions.origin_auth` akan membuat jalur kedua
**tidak tergerbangi**, dan kegagalannya senyap — kelas "penulis pindah,
pembacanya tidak" yang menghasilkan ADR-0079. Kolomnya karena itu ada di baris
yang **kedua jalur sudah SELECT**: gerbangnya gratis dan tidak bisa dilewati.

Ia **write-once**. Sebuah keanggotaan terdelegasi lahir terdelegasi dan tidak
pernah menjadi anggota biasa, jadi tidak ada kewajiban penulis kedua yang bisa
hanyut. `machine` sengaja tidak menjadi nilai ketiga meski atribut ABAC
`subject.principalKind` yang direncanakan program memuatnya: kredensial mesin
bukan tenant user, jenisnya dibawa namespace hash-nya (ADR-0049), dan
menyalinnya ke sini menciptakan sumber kedua yang bisa berbeda pendapat.

## Kode penebusan adalah bearer kedua yang harus DITOLAK gerbang

ADR-0088 menetapkan bahwa token seleksi tidak boleh pernah mengautentikasi
`authorizeInTransaction`. Kode ini bergabung dengannya di pernyataan pertama
yang sama, dengan alasan yang sama: seseorang **akan** menempelkannya ke header
`Authorization`, dan sebuah hash yang kebetulan tidak cocok dengan baris sesi
mana pun adalah kebetulan penyimpanan, bukan kontrol.

Prefiksnya juga masuk `RESERVED_TOKEN_PREFIXES`, sehingga token sesi acak tidak
akan pernah lahir di namespace yang gerbangnya tolak.

## Mati bersama grantnya, di transaksi yang sama

Pencabutan dan kedaluwarsa menonaktifkan keanggotaan **dan** mencabut sesinya di
transaksi yang sama — pola `setTenantUserStatus`, dengan taruhan lebih tinggi
karena akun itu milik organisasi lain.

`setTenantUserStatus` sendiri sengaja **tidak** dipakai: aturan "tidak boleh
menonaktifkan diri sendiri" dan "admin sistem terakhir" di sana adalah kontrol
untuk ANGGOTA, dan keduanya salah di sini. Sebuah keanggotaan terdelegasi tidak
boleh bisa memblokir pencabutannya sendiri dengan memegang role sistem — dan
lewat `materializeMembership` ia memang tidak bisa memegangnya, yang membuat
aturan itu bukan sekadar salah tetapi juga tak berlaku.

Sesi terdelegasi membawa `origin_auth = 'delegated'` dan **tidak boleh
berpindah tenant**. Sebuah grant untuk tenant C yang bisa dibawa ke tenant D
bukan grant; ia pintu masuk. Aturan non-switchable berhenti dieja inline di
`switch.ts` dan menjadi satu daftar, `NON_SWITCHABLE_ORIGIN_AUTH` — dua nilai
masih boleh dieja, tiga sudah menjadi tempat nilai keempat terlupakan.

## Konsekuensi

- Grant yang berumur lebih dari 31 hari **tidak bisa ada** (CHECK `sql/117`),
  dan aturannya 30 (`DELEGATED_ACCESS_MAX_TTL_DAYS`). Selisih satu hari
  disengaja: `created_at` DEFAULT `now()` adalah instant MULAI TRANSAKSI
  sementara `expires_at` dihitung jam aplikasi yang selalu belakangan, jadi
  CHECK "tepat 30 hari" akan menolak baris yang benar-benar normal.
- Karena TTL-nya terbatas, deskriptor retensi 365 hari **aman memakai
  `executionMode: 'generic'`** — sapuan berbasis umur tidak bisa menghapus grant
  hidup, karena tidak ada grant hidup yang cukup tua untuk dijangkaunya. Ini
  satu-satunya deskriptor di modul ini yang bisa mengatakan itu.
- Grant tidak bisa ada tanpa kemitraan hidup: FK komposit ke
  `awcms_partner_managed_tenants (tenant_id, partner_tenant_id)`.
- PR ini mendarat **inert** — belum ada rute yang memanggilnya. Permukaannya PR
  8.4, dan PR itu tidak akan juga menambahkan model datanya.

## Koreksi (PR 8.4, `sql/120`) — grant hidup lebih lama dari kemitraannya

`sql/117` mengikat grant ke baris kemitraan dengan FK komposit, dan alasannya
terdengar benar: "sebuah grant hanya bisa ada di tempat kemitraannya ada".

**Diukur dengan menjalankannya, itu salah.** Begitu satu grant pernah dibuat,
memutus kemitraan GAGAL selamanya: grant yang sudah dicabut tetap mereferensi
baris pemetaan, dan pencabutan sengaja tidak menghapusnya — ia catatan retensi
365 hari. Jadi pelanggan yang paling butuh memutus kemitraan, yang partnernya
PERNAH benar-benar masuk, adalah satu-satunya yang tidak bisa.

Yang benar: **grant adalah SEJARAH, kemitraan adalah KEADAAN SEKARANG.** "Siapa
yang pernah bisa melihat data kami" justru paling ditanyakan setelah vendornya
diberhentikan. FK-nya dipindahkan ke registri `awcms_partners`, dan invarian
"tidak ada grant tanpa kemitraan hidup" tetap ditegakkan basis data **saat
penulisan** lewat `INSERT … SELECT … WHERE EXISTS` — predikat di dalam statement
yang sama, bukan pemeriksaan yang mendahuluinya, karena yang kedua adalah TOCTOU.

Ditemukan E2E, bukan review. Itu sendiri catatan yang layak: FK-nya terbaca
benar di setiap pembacaan sampai ada yang menjalankan urutan lengkapnya.

## Ditolak

- **Role `support` yang ditanam platform** (dan seed+backfill yang menyertainya).
- **Aktor partner yang bukan tenant user** — setiap pembaca otorisasi harus
  belajar bentuk kedua, dan yang lupa gagal terbuka.
- **Menyalin hash kredensial principal ke `awcms_identities.password_hash`
  tenant target** — kredensial di tempat kedua, persis yang ADR-0085 hindari.
  Kolomnya diisi hash dari 32 byte acak: "tidak" yang tetap "tidak" siapa pun
  yang membacanya nanti.
- **Menurunkan alamat manusia dari string yang dipasok tenant target** — itu
  akan membiarkan tenant memilih principal SIAPA yang keanggotaannya menempel.
  Alamatnya dibaca dari baris principal global, lewat store yang memilikinya.
- **Memakai `setTenantUserStatus` untuk mematikan keanggotaan terdelegasi.**
- **Membiarkan sesi terdelegasi berpindah tenant.**
- **Daftar aksi terlarang** alih-alih satu kalimat tentang satu modul.
