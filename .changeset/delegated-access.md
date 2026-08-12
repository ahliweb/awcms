---
"awcms": minor
---

feat(auth): akses terdelegasi mencetak tenant user SUNGGUHAN (ADR-0090, #423)

Gelombang 8 PR 8.2, `sql/117`. Grant yang ditebus **tidak menghasilkan aktor
jenis baru**. Ia menghasilkan baris `awcms_tenant_users` biasa di tenant target,
terikat role yang DIPILIH PELANGGAN, dengan tanggal mati.

ITULAH SELURUH IDENYA: RLS, decision log, audit, SoD, dan business-scope facts
bekerja TANPA SATU PUN PERUBAHAN, karena aktornya memang benar-benar tenant user
di sana. Alternatifnya — "aktor partner" yang bukan tenant user — menuntut setiap
pembaca otorisasi di repo ini belajar bentuk kedua, dan yang lupa belajar akan
gagal TERBUKA. Yang menyeberangi batas antar-organisasi hanyalah kode penebusan
berumur pendek (`awcmsd_…`, hash `dg-sha256:`), preseden ADR-0050: bukan
kredensial hidup, bukan pembacaan lintas-tenant.

RENCANA MEMINTA ROLE `support` YANG DITANAM PLATFORM, DAN ITU DITOLAK. Role di
repo ini adalah baris PER-TENANT dan satu-satunya yang ditanam adalah `owner`,
jadi menanam `support` menuntut seed migration PLUS backfill — seed hanya
menjangkau tenant yang dibuat sesudahnya, dan tenant lama akan diam-diam 403.
Tetapi keberatan sebenarnya bukan mekanis: ia membuat PLATFORM MEMUTUSKAN APA
YANG BOLEH DISENTUH PARTNER DI DALAM TENANT ORANG LAIN, membatalkan ADR-0089
dari sisi lain. Pelanggan memilih role yang sudah ada; `materializeMembership`
menolak role `is_system`, jadi `owner` bukan pilihan.

SATU HAL YANG PILIHAN ROLE TIDAK BISA BATASI: otoritas access-control. Aktor
terdelegasi yang boleh memberi role menciptakan kuasa yang HIDUP MELEWATI
GRANTNYA SENDIRI — cabut grantnya, matikan tenant usernya, dan baris yang ia
berikan kepada orang lain tetap ada. Pencabutan berhenti menjadi pencabutan, dan
tidak ada gerbang yang akan menyebutkannya karena setiap langkahnya sah.
Chokepoint menolak deny-only di atas `fetchGrantedPermissionKeys`: di modul
`identity_access`, aktor terdelegasi hanya MEMBACA. Satu kalimat, bukan daftar
aksi — daftar aksi menua diam-diam setiap kali modul itu menumbuhkan aktivitas
baru, dan yang menua adalah lubang.

`principal_kind` HIDUP DI `awcms_tenant_users`, BUKAN DI SESI. Ada DUA jalur ke
chokepoint — lewat sesi dan lewat tenant user langsung — dan menyandarkan
gerbangnya pada `awcms_sessions.origin_auth` akan membuat jalur kedua TIDAK
TERGERBANGI, kelas "penulis pindah, pembacanya tidak" yang menghasilkan
ADR-0079. Kolomnya ada di baris yang KEDUA resolver sudah SELECT, jadi gerbangnya
gratis dan tidak bisa dilewati; ia write-once, jadi tidak ada kewajiban penulis
kedua yang bisa hanyut.

Kode penebusan bergabung dengan token seleksi ADR-0088 sebagai bearer kedua yang
gerbang TOLAK di pernyataan pertama, karena seseorang akan menempelkannya ke
header `Authorization` dan "hash itu toh tidak cocok dengan baris sesi mana pun"
adalah kebetulan penyimpanan, bukan kontrol. Prefiksnya juga masuk
`RESERVED_TOKEN_PREFIXES`.

Pencabutan dan kedaluwarsa menonaktifkan keanggotaan DAN mencabut sesinya di
transaksi yang sama. `setTenantUserStatus` sengaja tidak dipakai: aturan "admin
sistem terakhir" dan "tidak boleh menonaktifkan diri sendiri" di sana adalah
kontrol untuk ANGGOTA, dan sebuah keanggotaan terdelegasi tidak boleh bisa
memblokir pencabutannya sendiri. Sesi `delegated` tidak boleh berpindah tenant —
grant untuk tenant C yang bisa dibawa ke tenant D bukan grant, ia pintu masuk —
dan aturan non-switchable berhenti dieja inline menjadi
`NON_SWITCHABLE_ORIGIN_AUTH`.

Penebusan memakai `materializeMembership` (ADR-0082) alih-alih menjadi penulis
keanggotaan KELIMA, yang juga memberinya penolakan role sistem secara gratis.
`attachIdentityToPrincipal` ditambahkan bersamanya: alamat manusia dibaca dari
baris principal GLOBAL, tidak pernah diturunkan dari string yang dipasok tenant
target — kalau tidak, tenant bisa memilih principal SIAPA yang keanggotaannya
menempel.

TTL dibatasi 30 hari di aplikasi dan 31 di basis data. Selisih satu hari
disengaja: `created_at` DEFAULT `now()` adalah instant MULAI TRANSAKSI sementara
`expires_at` dihitung jam aplikasi yang selalu belakangan, jadi CHECK "tepat 30
hari" akan menolak baris yang benar-benar normal. Karena TTL-nya terbatas,
deskriptor retensi 365 hari aman memakai `executionMode: 'generic'` — tidak ada
grant hidup yang cukup tua untuk dijangkau sapuan berbasis umur. Ini
satu-satunya deskriptor di modul ini yang bisa mengatakan itu.

DIVERIFIKASI DENGAN MENJALANKAN. 117 migrasi di-apply dari nol pada Postgres 16
nyata; 13 asersi membuktikan setiap constraint MENOLAK (TTL, pasangan
penebusan, kemitraan yang tak ada, role tenant lain, kode kembar, aktor tanpa
waktu, nilai `principal_kind` ketiga) dan RLS-nya mengisolasi. Empat mutasi
memerahkan test yang tepat: memindahkan gerbang ke bawah `fetchGrantedPermissionKeys`,
menghapus `tu.principal_kind` dari satu resolver, menghapus `delegated` dari
daftar non-switchable, dan mencabut penolakan namespace kode di gerbang.

Mendarat INERT — belum ada rute yang memanggilnya. Permukaannya PR 8.4, dan PR
itu tidak akan juga menambahkan model datanya.
