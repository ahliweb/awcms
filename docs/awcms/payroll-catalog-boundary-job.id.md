🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](payroll-catalog-boundary-job.md)

<!-- i18n-source-hash: sha256:3d0c82cc36b171bbbdfe899bfd1fbc81405101e1809440d6c021e7812c6ffb3f -->

# Runbook: pemeriksaan katalog payroll terjadwal

Issue #1095 (keputusan pemilik K3, 22 November 2026). Latar belakang dan
aturannya sendiri: [`hr-payroll.id.md`](hr-payroll.id.md) bagian 13.3.

`bun run payroll:catalog-boundary:job` membaca **katalog** database yang
dideploy sekali sehari dan gagal bila sesuatu di luar keluarga payroll
menjangkau tabel payroll: view, rule, fungsi, trigger, atau grant, trigger atau
foreign key wajib yang hilang, tabel tiruan, atau objek dengan pemilik yang tak
diperhitungkan. Ia adalah alarm drift. Ia **tidak membaca satu baris data pun
dari tabel mana pun**.

Ia ada di job registry modul `hr_commission`, jadi `ops/awcms-jobs.crontab`
memuatnya (`17 3 * * *`, satu run per hari, di bawah `flock`).

## Cara berjalan di produksi

Image runtime produksi hanya berisi `dist/`. Seperti job lain, ia berjalan lewat
`ops/run-job.sh`, yang menjalankan image tahap `jobs` (`ghcr.io/ahliweb/awcms-jobs`,
commit yang sama dengan app) dengan `ops/awcms-jobs.env-global` dan
`ops/awcms-jobs.env-scoped` yang ter-generate. Tidak ada yang istimewa: pasang
crontab dan berkas runner seperti pada rilis mana pun, dan job terjadwal.

Ia adalah **job role-khusus** (kelas yang sama dengan `social-publishing:dispatch`):

- satu-satunya login adalah `PAYROLL_CATALOG_AUDIT_DATABASE_URL`, hanya diberikan
  kepada job ini di `ops/awcms-jobs.env-scoped`, **tanpa fallback** ke
  `DATABASE_URL` atau `WORKER_DATABASE_URL`;
- `ops/run-job.sh` menahan `DATABASE_URL`, `WORKER_DATABASE_URL`, dan
  `SETUP_DATABASE_URL` darinya tanpa syarat (blok ter-generate;
  `bun run jobs:env-allowlist:check` gagal bila basi);
- job menolak mulai bila salah satu dari ketiganya ada, dan menolak kecuali
  server menyatakan `session_user` dan `current_user` adalah
  `awcms_catalog_boundary_audit` dan role itu bukan SUPERUSER maupun BYPASSRLS.

## Pemasangan operator (sekali per deployment)

`sql/420` membuat role `awcms_catalog_boundary_audit` sebagai `NOLOGIN` tanpa
password. Ia memegang CONNECT pada database dan **tanpa privilege pada tabel
aplikasi mana pun** (view katalog dapat dibaca setiap role). Operator membuatnya
dapat dipakai:

1. Beri login dan password (buat baru; jangan pakai ulang milik role lain):

   ```sql
   ALTER ROLE awcms_catalog_boundary_audit LOGIN PASSWORD '<secret>';
   ```

   CONNECT berasal dari `CONNECT` bawaan PostgreSQL untuk `PUBLIC`, seperti role
   `awcms_` lain. Bila Anda mencabutnya, jalankan juga
   `GRANT CONNECT ON DATABASE <db> TO awcms_catalog_boundary_audit;`.

2. Taruh connection string di environment **layanan app** (aplikasi Coolify),
   di samping variabel lainnya, bukan di `DATABASE_URL`:

   ```
   PAYROLL_CATALOG_AUDIT_DATABASE_URL=postgres://awcms_catalog_boundary_audit:<secret>@<host>:5432/awcms
   ```

   `ops/run-job.sh` tidak membaca environment jobs yang terpisah: ia menyalin
   variabel ber-allow-list dari container app yang berjalan
   (`docker exec "$APP" printenv`). Berkas ter-generate memberikan variabel ini
   hanya kepada `payroll:catalog-boundary:job`, sehingga job lain tidak
   menerimanya, dan proses web tidak pernah membacanya. Konsekuensinya nilai itu
   memang berada di environment container app, itulah sebabnya role hanya
   memegang CONNECT dan katalog: nilai yang bocor membaca struktur, tidak pernah
   satu baris pun.

3. **Hanya deployment split-role** (migrasi dijalankan satu role, objek payroll
   dimiliki role lain): set `PAYROLL_EXPECTED_OWNERS=role1,role2` di environment
   yang sama. Bila tidak, pemilik yang diharapkan adalah pemilik ledger migrasi.

4. Batasi login itu sebatas kebutuhannya di `pg_hba.conf` (disarankan, tidak
   ditegakkan aplikasi): satu database, satu host sumber, TLS, mis.

   ```
   hostssl  awcms  awcms_catalog_boundary_audit  <cidr-host-jobs>  scram-sha-256
   ```

   dan tidak boleh ada baris `pg_hba` lain yang cocok untuk role ini
   (`host all all 0.0.0.0/0` membiarkan login dipakai dari mana saja). Role tidak
   punya privilege tabel, jadi ini mempersempit dari mana password yang bocor
   dapat dicoba, bukan apa yang dapat dibacanya.

5. Jalankan sekali dengan tangan untuk melihatnya lulus sebelum malam pertama:

   ```
   ops/run-job.sh payroll:catalog-boundary:job
   ```

`security:readiness` mengunci role itu (ada; bukan SUPERUSER, BYPASSRLS, CREATEDB,
atau CREATEROLE; tanpa privilege tingkat tabel atau kolom pada relasi mana pun;
tanpa keanggotaan; tidak memiliki objek). Memberinya apa pun menggagalkan cek itu.

## Seperti apa sebuah run

Setiap hasil adalah **baris log terstruktur** dari logger repo (satu objek JSON
per baris di stdout, dengan `level`, `message`, `moduleKey: "hr_commission"`, dan
`job`), bukan baris teks biasa, sehingga log shipper yang menyaring `level: "error"`
melihatnya. Status keluar membawa putusan yang sama.

| Hasil                                                                                 | Exit | Log                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bersih                                                                                | 0    | `info` `payroll.catalog_boundary.ok` dengan ringkasan (agar "berjalan dan tak menemukan apa-apa" berbeda dari "tidak berjalan").                                                                                                                                                                     |
| **Belum diaktifkan** (`PAYROLL_CATALOG_AUDIT_DATABASE_URL` tidak di-set)              | 0    | `warning` `payroll.catalog_boundary.skipped_not_activated` dan baris `payroll:catalog-boundary:job SKIPPED (not activated)`. Tidak ada pemeriksaan yang berjalan: **tidak ada alarm drift sampai operator mengaktifkannya.** `security:readiness` memperingatkan keadaan yang sama (lihat di bawah). |
| Ada temuan                                                                            | 1    | Satu `error` `payroll.catalog_boundary.finding` per temuan (`code`, `object`, `detail`), lalu satu `error` `payroll.catalog_boundary.failed` berisi jumlahnya. `expectedOwnersMissing: true` menandai kasus split-role di bawah.                                                                     |
| Pemilik tak diperhitungkan dan `PAYROLL_EXPECTED_OWNERS` kosong                       | 1    | Sama, dengan `expectedOwnersMissing: true` dan ringkasan yang menyebut `PAYROLL_EXPECTED_OWNERS`: pada deployment split-role isi variabel itu; pada deployment lain itu adalah objek payroll yang berpindah tangan, yaitu temuan di sebelahnya.                                                      |
| Salah konfigurasi: URL di-set tetapi role salah, tak terjangkau, atau URL bersama ada | 1    | `error` `payroll.catalog_boundary.job_refused` dengan alasannya (hanya nama role, tidak pernah connection string).                                                                                                                                                                                   |

`security:readiness` memuat dua cek untuk role ini: pin **critical** (role tidak
memegang apa pun: tanpa privilege tabel atau kolom, tanpa `EXECUTE` pada fungsi
SECURITY DEFINER mana pun, `NOINHERIT`, tanpa keanggotaan, tidak memiliki objek)
dan **warning** "Scheduled payroll catalog check is activated", yang gagal selama
role belum punya LOGIN. Warning itu tidak pernah memblokir go-live; database baru
atau lokal menampilkannya karena belum diaktifkan.

Log job ada di `$AWCMS_JOB_LOG/payroll-catalog-boundary-job.log`. Status keluar
gagal dan baris `error` itulah yang diperingatkan oleh cron mail atau log shipper
host: **sambungkan ke seseorang**; log yang hijau secara bawaan dan tak dibaca
siapa pun bukan alarm, begitu pula job yang tetap "belum diaktifkan".

## Bila gagal

1. Baca temuannya. Tiap temuan punya `code` (lihat tabel di
   `scripts/lib/payroll-catalog-boundary.ts`) dan menyebut objeknya.
2. Temuan pada rilis yang baru dideploy adalah migrasi yang menjangkau payroll
   di luar keluarga: perlakukan sebagai temuan keamanan
   ([`SECURITY.md`](../../SECURITY.md)), bukan cek yang goyah.
3. Jangan menambah entri `PAYROLL_CATALOG_EXEMPTIONS` untuk membungkamnya. Jalan
   keluarnya adalah nama keluarga payroll.

## Batas

- Cek ini adalah **pertahanan berlapis**. Review migrasi (CODEOWNERS dan review
  keamanan untuk `sql/` yang menyentuh payroll) tetap kontrol utama, dan residual
  yang dicantumkan #1095 (pembangunan ulang di balik konstruksi yang tak
  dimodelkan, daftar helper terbatas, slot replikasi logis, superuser) tidak
  berubah.
- Harian, jadi perubahan yang dibuat dan dibatalkan dalam sehari tidak terlihat.
- Belum diaktifkan berarti tidak berjalan: sebelum operator mengisi URL dan role
  punya LOGIN, job mencatat `SKIPPED (not activated)` dan keluar 0.
- `payroll:catalog-boundary:check` (`DATABASE_URL`) tetap bentuk operator untuk
  database hasil pemulihan; ia bukan job dan tidak dijadwalkan.
