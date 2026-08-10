---
"awcms": minor
---

feat(access): tabel grant lama menjadi sejarah, dan lima pembaca yang sudah basi diperbaiki

[ADR-0079](../docs/adr/0079-the-legacy-grant-table-becomes-read-only-history.md).
`sql/103` menyalin setiap baris `awcms_access_assignments` ke
`awcms_access_policies` dengan **`id` dipertahankan** — rujukan audit menamai
sebuah grant lewat id-nya, dan backfill yang mencetak id baru akan memutus
semuanya secara senyap — lalu mencabut `INSERT`/`UPDATE`/`DELETE` dari
`awcms_app`. `SELECT` sengaja ditahan: sejarah yang tak bisa dibaca bukan
sejarah, ia hanya tak bisa diubah.

**Yang dicari dan yang ditemukan bukan hal yang sama.** Yang direncanakan adalah
backfill. Yang ternyata ada di sana: sejak PR sebelumnya (#506) memindahkan
setiap PENULIS grant ke tabel baru, **lima pembaca masih membaca tabel lama** —
dan untuk setiap tenant yang dibuat sesudah PR itu, mereka menjawab tentang
tabel yang tak ditulis siapa pun. Tiap satunya salah dengan cara berbeda:

- `GET /api/v1/auth/session` melaporkan owner **tanpa satu pun peran**;
- `/admin/users` menampilkan setiap pengguna dengan daftar peran kosong;
- `TenantContext.roles` kosong, sehingga kebijakan ABAC `subject.roles` berhenti
  cocok — `allow` yang berhenti cocok itu penyempitan (aman), tetapi **`deny`
  yang berhenti cocok adalah PELEBARAN**, dan tak ada yang mengamatinya;
- SoD berhenti melihat grant RBAC biasa dan melaporkan "tak ada konflik";
- guard `last_admin_blocked` menyimpulkan tenant tak punya administrator, jadi
  **owner terakhir bisa dinonaktifkan** — tenant terkunci tanpa jalan pulih di
  dalam aplikasi.

38 gerbang hijau selama itu, `bun run check` lewat, dan test unit lewat — karena
setiap satunya meng-assert sebuah pembaca terhadap **dirinya sendiri**. Tak ada
yang menulis grant lewat penulis sungguhan lalu bertanya kepada para pembacanya.

**Jadi perbaikannya bukan membetulkan lima query.** `activeRoleGrants`
(`identity-access/application/grant-source.ts`) adalah satu-satunya definisi
"peran apa yang sedang dipegang", disisipkan setiap pembaca sebagai subquery.
Sebuah pembaca memakainya atau ia bukan pembaca:
`tests/grant-source-parity.test.ts` mengunci itu secara statis dan
`tests/integration/grant-readers.integration.test.ts` secara perilaku — yang
kedua adalah bentuk yang akan menangkapnya sejak awal, karena sebuah pembaca
bisa diarahkan ke tabel apa pun dan tetap ter-compile. Mengembalikan satu
pembaca ke tabel lama memerahkan keduanya (diuji).

**Fragmen, bukan VIEW.** View juga akan jadi satu definisi, tetapi yang pertama
di repo ini harus menjawab `security_invoker` di perubahan yang sama — tanpanya
view berjalan sebagai PEMILIKNYA dan **melewati FORCE RLS** tabel di bawahnya,
dan setiap test RLS yang ada akan tetap hijau. Fragmen menghasilkan SQL yang
persis sama dengan yang akan ditulis pembacanya, jadi RLS berlaku seperti
sebelumnya dan jumlah query tidak bertambah.

**`awcms_business_scope_assignments` sengaja TIDAK ikut dipensiunkan**, meski
rencana program menyebut "dua tabel lama". `role_id` di sana tidak memberi satu
pun permission key hari ini — hanya SoD yang membacanya, dan hanya sebagai
fakta. Memindahkannya sekarang akan memberi setiap subjek ber-scope permission
peran itu **di seluruh tenant**, karena belum ada yang mengualifikasi scope saat
evaluasi sampai PR 3.4; dan `role_id`-nya nullable sedangkan tujuannya tidak.

**Satu cacat lain ikut ketahuan, dan gerbangnya tak bisa melihatnya.**
`awcms_setup` tak pernah diberi privilege pada tabel Policy, jadi setup wizard
gagal `permission denied for table awcms_access_policies` di setiap deployment
ber-`SETUP_DATABASE_URL` sejak #506. `checkWorkerSetupRoleGrants` memeriksa
apakah grant COCOK dengan matriks yang dideklarasikan — dan kedua sisi memang
masih setuju satu sama lain; tak ada yang memeriksa apakah matriksnya cocok
dengan yang DIBUTUHKAN kode.

Sisanya adalah kelas gerbang baru: tabel tenant-scoped yang sengaja read-only
harus **dideklarasikan** di `RETIRED_TENANT_TABLE_PRIVILEGES`, dan ditegakkan
**dua arah** — tabel terdaftar yang mendapatkan kembali `INSERT` gagal sekeras
tabel tak-terdaftar yang kehilangan `SELECT`. Default keempat-verb untuk tabel
tenant-scoped menanggung beban nyata (tabel FORCE RLS yang tak bisa ditulis
runtime adalah `permission denied` yang menunggu request pertama), jadi
membaliknya harus jadi kalimat yang ditulis seseorang, bukan efek samping sebuah
migrasi.
