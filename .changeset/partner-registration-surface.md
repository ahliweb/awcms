---
"awcms": minor
---

feat(auth): registri partner punya penulis — `GET`/`POST /api/v1/partners` (ADR-0089, #423)

`sql/116` mengirim `awcms_partners` tanpa penulis: satu-satunya cara membuat baris
partner adalah operator dengan prompt psql, dan suite E2E gelombang itu
menuliskannya sendiri dengan komentar "belum ada jalur request untuk ini". Ini
menutup sisa #423 nomor 3.

KEDUANYA BER-SCOPE PLATFORM, DAN `read` BUKAN KELALAIAN. `create` menyatakan siapa
yang BOLEH MENJADI partner — paruh platform dari pemisahan yang ADR-0089 jaga
terhadap `partner_access.configure` milik pelanggan ("partner mana yang menjangkau
tenant SAYA"). Tidak ada satu aktor pun yang memegang keduanya. `read` mendaftar
SELURUH partner, dan versi tenant-scoped-nya adalah persis direktori lintas-tenant
yang ADR yang sama tolak sebagai tabel — dibangun ulang sebagai permission. Dua
mekanisme independen menjaganya: RLS menaruh setiap baris di tenant platform, dan
chokepoint menolak permission ber-scope platform kecuali tenant yang bertindak
MEMANG tenant platform.

TIDAK ADA `DELETE`, DAN ITU KEPUTUSAN. `awcms_partners.partner_tenant_id` adalah
target FK dari keterlibatan DAN dari grant terdelegasi yang `sql/120` buat sengaja
HIDUP LEBIH LAMA dari kemitraannya. DELETE akan gagal begitu satu kemitraan pernah
ada, dan "memperbaikinya" dengan `ON DELETE CASCADE` memutus setiap kemitraan di
instalasi. Pensiun adalah perubahan `status`, dan `status` dipatok `sql/116` sampai
ada yang MEMBACA suspensi — jadi permukaan ini juga tidak menerima `status` sama
sekali. Field yang diterima API lalu ditolak basis data lebih buruk daripada tidak
ada field; field yang diterima dan disimpan sementara tak ada yang membacanya lebih
buruk lagi.

KONFLIK DISELESAIKAN TANPA MEMBACA SQLSTATE. Kedua kunci naturalnya punya index unik
GLOBAL, jadi pendaftaran ganda bisa kalah pada salah satu dari dua index — dan
membedakannya lewat error driver berarti membaca SQLSTATE dari tempat yang di repo
ini bukan `error.code`. `ON CONFLICT DO NOTHING` menghindari pertanyaannya dan
menjaga transaksi tetap bisa dipakai untuk satu pembacaan yang memberi tahu kunci
MANA yang terpakai. Karena itu juga tidak ber-`Idempotency-Key`: submit ganda adalah
409, bukan baris kedua, jadi tidak ada hasil untuk diputar ulang.

`partnerCode` divalidasi di aplikasi meski `sql/116` tidak memberinya CHECK, dan
alasannya index uniknya global tanpa normalisasi apa pun: `Acme-Digital` dan
`acme-digital` adalah dua partner bagi Postgres dan satu partner bagi manusia yang
membaca daftarnya.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau (41 segmen). Empat
mutasi memerahkan test yang tepat: INSERT ikut menulis `status`, seed grant berjalan
di atas `awcms_tenants` alih-alih `awcms_setup_state` (cacat asli yang ADR-0053
tutup), `partnerCode` menerima huruf besar, dan pendaftaran diri sendiri diloloskan.
Suite E2E partner kini MEMULAI seluruh alurnya dari penulis ini alih-alih dari INSERT
tangan — lewat `withTenantOrThrow`, karena `set_config` bersifat per-koneksi dan tiga
pernyataan pada pool tidak akan selamat seperti satu pernyataan selamat.

`NOT_YET_SCREENED` tumbuh 60 → 62. Layarnya BUKAN `/admin/partners`: halaman itu
adalah pandangan PELANGGAN atas siapa yang menjangkau tenant-nya sendiri, dan
menaruh registri di sana menaruh daftar setiap kemitraan platform di depan setiap
pelanggan.
