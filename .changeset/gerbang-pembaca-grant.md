---
"awcms": patch
---

feat(gerbang): sebelas berkas membaca tabel grant — sekarang daftarnya tertulis, dan yang kedua belas memerahkan CI

Gerbang baru `access:grant-readers:check` di rantai `check`. Setiap berkas yang
menyebut `awcms_access_assignments` atau `awcms_role_permissions` ada di daftar,
berikut **alasannya**; apa pun di luar itu menggagalkan build. Hijau hari ini,
nol perubahan perilaku — dan itulah maksudnya.

**Apa yang dijaganya.** Hari ini sebuah grant adalah `(tenant_user, role)` dan
menjawab satu pertanyaan: apakah orang ini memegang role itu, **di mana pun**
dalam tenant. Gelombang 3 program keanggotaan (#423) membuat grant membawa
**scope**-nya sendiri, sehingga join yang sama berhenti berarti "boleh
bertindak" dan mulai berarti "boleh bertindak **DI SUATU TEMPAT**" — dan tiap
pembaca yang merakit join-nya sendiri tetap memberi jawaban lama yang lebih
lebar sambil terlihat tak tersentuh.

Itu bukan mode kegagalan hipotetis. Bentuknya persis PROJECT_STATE §4 R3, tempat
31 layar admin memutuskan dari RBAC mentah dan **tiap satu di antaranya terbaca
benar**.

**Kenapa mendarat SEBELUM benda yang dijaganya.** Gerbang yang harus hijau hari
ini paling murah ditambahkan hari ini — dan daftar yang ditulis **sesudah**
perubahan berisiko adalah daftar yang ditulis orang yang sudah punya alasan
memendekkannya. `access:decision-log:coverage:check` (#426) mendarat atas
argumen yang persis sama, satu gelombang lebih awal.

**Kenapa daftar BERKAS, bukan aturan call-graph.** Sinyal yang jujur adalah
"berkas ini menyebut tabelnya". Aturan tentang modul mana boleh meng-IMPOR modul
mana akan melewatkan semuanya: kesebelas berkas menjangkau tabelnya lewat
template SQL, bukan impor, jadi DAG modul tak punya pendapat apa pun tentang
mereka dan `modules:table-writes:check` hanya mengatur TULIS. **Tiga** dari
sebelas berada **di luar** `identity_access`, dan tak satu pun melanggar gerbang
yang sudah ada:

- `tenant-admin/…/platform-bootstrap.ts` — menyemai grant owner tenant baru
  sebelum `identity_access` punya permukaan untuk melakukannya. Fakta urutan
  bootstrap, dicatat bukan dimaafkan.
- `pages/api/v1/access/policies/simulate.ts` — sebuah **RUTE** yang merakit
  join-nya sendiri. Satu-satunya entri yang berupa refactor terjadwal, bukan
  keputusan: simulator ABAC yang menghitung himpunan grant berbeda dari jalur
  nyata **mensimulasikan sistem yang salah**, dan bedanya muncul sebagai policy
  yang berperilaku di produksi tidak seperti pratinjaunya.
- `email/…/announcement-directory.ts` — menyelesaikan "siapa memegang role X"
  untuk menyasar pengumuman. Keanggotaan, bukan otorisasi, jadi jawaban
  union-lintas-scope tetap benar sesudah Gelombang 3. Terdaftar karena
  penalarannya tidak jelas dari call site-nya.

**Komentar tidak bisa memutuskan hasilnya, dua arah.** Tiga berkas di repo ini
membahas tabel-tabel itu di docblock dan tak menyentuhnya — mereka tidak masuk
daftar. Sebaliknya, sebuah berkas tidak bisa **mempertahankan** slotnya dengan
menyebut tabelnya di komentar setelah query-nya dicabut: entri basi dilaporkan.
Keduanya diuji. `stripComments` dipakai ulang dari `access-chokepoint-check.ts`,
yang sudah mencatat kenapa justru PERBAIKAN yang menanam false positive — sebuah
perbaikan menjelaskan apa yang ia hapus.

**Dibuktikan mengikat, bukan sekadar hijau:** menyisipkan
`"SELECT 1 FROM awcms_access_assignments"` ke `src/pages/admin/roles.astro`
membuat gerbangnya **merah** dengan pesan yang menyebut nama tabelnya dan
alternatifnya. Pesan yang berkata "tidak" tanpa berkata "pakai ini" adalah pesan
yang dipuaskan orang dengan menambah pengecualian.

`awcms_permissions` sengaja **tidak** termasuk: ia katalog global tentang apa
sebuah permission ITU, tak membawa grant, dan dibaca migrasi seed serta picker
admin yang tak ada urusannya dengan daftar ini. Daftar sepanjang itu adalah
daftar yang tak dibaca siapa pun.
