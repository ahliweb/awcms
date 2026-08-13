---
"awcms": minor
---

feat(auth): permukaan kemitraan — pelanggan menyewa, partner menebus, keduanya tergerbangi (#423, ADR-0089/0090/0091)

Gelombang 8 PR 8.4, `sql/119` + `sql/120`. Enam endpoint yang menghidupkan tiga
PR sebelumnya, plus satu koreksi terhadap PR 8.2 yang ditemukan E2E.

CAKUPANNYA LEBIH LEBAR DARI YANG RENCANA SEBUT, DAN ITU KEPUTUSAN. Rencana
Gelombang 8 hanya menyebut `/api/v1/partner/tenants/**`. Mengirim sisi partner
sendirian akan menghasilkan permukaan di atas data yang tidak ada satu pun jalur
request bisa membuatnya — inert karena kelalaian, bukan karena desain. Sisi
pelanggan (menyewa, memutus, menyetujui, mencabut) ikut mendarat.

FUNGSI SECURITY DEFINER-nya DIUKUR, BUKAN DIASUMSIKAN. `sql/048` sendiri
mendokumentasikan bahwa di postur repo ini definer TIDAK mem-bypass RLS, jadi
"fungsinya ada" tidak membuktikan apa pun. Diuji sebagai `awcms_app` terhadap
Postgres nyata: fungsinya mengembalikan buku partner, SELECT langsung dari kursi
yang sama tetap NOL baris, pemiliknya NOLOGIN NOSUPERUSER NOBYPASSRLS tanpa
anggota, dan EXECUTE dicabut dari PUBLIC. Parameternya diisi dari KONTEKS TENANT
pemanggil, tidak pernah dari input — fungsi yang menyerahkan penyaringan ke
TypeScript adalah direktori kemitraan lintas-tenant dengan satu `WHERE` yang bisa
dilupakan.

KOREKSI TERHADAP `sql/117`, DITEMUKAN E2E DAN BUKAN REVIEW. FK komposit
grant→kemitraan terbaca benar di setiap pembacaan, dan salah begitu urutan
lengkapnya dijalankan: sekali satu grant pernah dibuat, MEMUTUS KEMITRAAN GAGAL
SELAMANYA, karena grant yang sudah dicabut tetap mereferensi baris pemetaan dan
pencabutan sengaja tidak menghapusnya — ia catatan retensi 365 hari. Pelanggan
yang paling butuh memutus, yang partnernya pernah benar-benar masuk, adalah
satu-satunya yang tidak bisa. `sql/120` memindahkan FK-nya ke registri partner:
grant adalah SEJARAH, kemitraan adalah keadaan sekarang. Invarian "tidak ada
grant tanpa kemitraan hidup" tetap ditegakkan basis data SAAT PENULISAN lewat
`INSERT … SELECT … WHERE EXISTS` — predikat di dalam statement yang sama, bukan
pemeriksaan yang mendahuluinya, karena yang kedua adalah TOCTOU.

TIGA AKSI PERMISSION, BUKAN LIMA. `read`, `configure`, `assign`. Menyewa dan
memutus adalah dua arah dari satu authority, dan memisahkannya menjadi
`create`/`delete` menghasilkan kombinasi yang tidak boleh ada: seseorang yang
bisa memasukkan partner dan tidak bisa mengeluarkannya. Persetujuan digerbangi
`assign` karena yang ia kerjakan adalah MEMBERI ROLE kepada orang luar —
authority yang sudah punya nama (ADR-0081, diulang ADR-0082). Ketiganya `tenant`
scope: kemitraan adalah keputusan pelanggan tentang tenantnya sendiri, dan
`platform` justru akan memindahkannya ke operator.

PENEBUSAN MENGEMBALIKAN KEANGGOTAAN, BUKAN SESI. Login biasa atau
`POST /auth/session/switch` bekerja sesudahnya, karena sesudahnya mereka memang
anggota. Menerbitkan sesi di sini berarti menyalin ulang kebijakan masuk tenant
tujuan — auth policy, MFA policy, serviceability — dan salinan kedua adalah
tempat gerbang MFA diam-diam terlewat. Kode penebusan tidak mengautentikasi apa
pun: yang membuktikan penebusnya adalah sesi hidup di tenantnya sendiri dan
principal GLOBAL di baliknya.

Kode akses dikembalikan TEPAT SEKALI. `GET` daftar grant bahkan tidak
men-SELECT kolom hash-nya, sehingga tidak ada kesalahan serialisasi yang bisa
membocorkannya. `purpose` wajib dan tidak pernah di-default — "kenapa vendor ini
punya akses" adalah pertanyaan pertama sebuah audit, dan jawaban kosong yang
dipasok sistem terbaca sebagai jawaban. Setiap penolakan penebusan menjawab 404
yang sama: pemegang kode tidak boleh belajar apakah kodenya nyata.

DIVERIFIKASI DENGAN MENJALANKAN. 120 migrasi dari nol pada Postgres 16 nyata; 8
asersi pada fungsi definer-nya; suite E2E route-level baru (18 test, terdaftar di
kedua workflow) menempuh seluruh busurnya — menyewa, menyetujui, menebus,
mencabut, memutus — dan membuktikan bahwa pencabutan benar-benar mematikan sesi
hidup, bahwa role sistem tidak bisa didelegasikan, dan bahwa kode yang sama tidak
bisa ditebus dua kali.
