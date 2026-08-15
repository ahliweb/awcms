🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0079-the-legacy-grant-table-becomes-read-only-history.md)

<!-- i18n-source-hash: sha256:8e37e73e2fe20db46bb7f106e512f128a3722714c395516ee67c4578a2ca69b6 -->

# ADR-0079 — Tabel grant lama menjadi sejarah read-only, dan semua pembacanya dijadikan satu

- **Status:** Diterima (2026-08-10).
- **Konteks:** Issue #423 Gelombang 3 PR 3.3. Migrasi `sql/103`.
- **Menyempurnakan:** [ADR-0078](0078-a-grant-carries-its-own-scope.md) — ia
  menciptakan `awcms_access_policies` dan membiarkan kedua tabel hidup
  berdampingan; ini menutup jendela itu.

## Keputusan

Tiga hal, dan yang ketiga adalah yang paling penting meski bukan yang diminta
rencana:

1. **Setiap baris `awcms_access_assignments` disalin ke `awcms_access_policies`
   dengan `id` yang DIPERTAHANKAN**, lalu `awcms_app` kehilangan
   `INSERT`/`UPDATE`/`DELETE` pada tabel lama. Ia menjadi sejarah read-only:
   barisnya tetap ada, `SELECT` tetap ada, tak ada lagi yang menulisnya.
2. **Tak ada lagi yang MEMBACANYA untuk otorisasi.** `UNION ALL` di
   `fetchGrantedPermissionKeys` runtuh menjadi satu sumber.
3. **Pertanyaan "peran apa yang dipegang orang ini" hanya punya satu
   implementasi**, `activeRoleGrants` di
   `identity-access/application/grant-source.ts`, dan setiap pembaca
   menyisipkannya sebagai subquery.

## Kenapa (2) tidak bisa ditunda ke PR berikutnya

Baris lama DIPERTAHANKAN — itulah yang membuatnya "sejarah" dan bukan "tabel yang
dulu berisi". Tetapi baris yang dipertahankan dan MASIH DIHITUNG adalah grant
yang tak bisa dicabut siapa pun: pencabutan kini memindahkan sebuah Policy ke
`revoked`, sementara `DELETE` yang dulu menghapus kembarannya sudah tidak
diizinkan. Membaca dan mencabut tak pernah bisa dipisahkan di sini.

Konsekuensi yang sama mengenai `subjectHoldsRole`: kalau ia masih melihat baris
lama, sebuah peran yang dicabut tak akan pernah bisa diberikan lagi — `409`
permanen yang tak bisa dibersihkan admin mana pun.

## Yang sebenarnya ditemukan: LIMA pembaca sudah basi

PR 3.2 memindahkan setiap PENULIS grant ke `awcms_access_policies`. Lima pembaca
tetap merakit join `awcms_access_assignments` sendiri, jadi untuk **setiap tenant
yang dibuat sesudah PR itu** mereka menjawab tentang tabel yang tak ditulis
siapa pun. Semuanya senyap, dan tiap satunya salah dengan cara berbeda:

| Pembaca                    | Akibatnya                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `auth-context.ts`          | `TenantContext.roles` kosong → `subject.roles` kosong di ABAC                                                  |
| `session-introspection.ts` | `GET /api/v1/auth/session` melaporkan owner TANPA peran                                                        |
| `access-directory.ts`      | `/admin/users` menampilkan setiap pengguna tanpa peran                                                         |
| `business-scope-facts.ts`  | SoD berhenti melihat grant RBAC biasa, dan melaporkan "tak ada konflik"                                        |
| `user-admin.ts`            | Guard `last_admin_blocked` menyimpulkan tenant tak punya administrator → **owner terakhir bisa dinonaktifkan** |

Dua di antaranya bukan sekadar tampilan salah:

- **`subject.roles` kosong membuat kebijakan DENY menjadi INERT.** Kebijakan
  `allow` yang berhenti cocok adalah penyempitan (aman); kebijakan `deny` yang
  berhenti cocok adalah **pelebaran**, dan tak ada yang mengamatinya.
- **Guard administrator terakhir yang buta akan MENGIZINKAN** penonaktifan owner
  tunggal — tenant terkunci tanpa jalan pulih di dalam aplikasi.

Ketiga puluh delapan gerbang hijau selama itu. `bun run check` lewat. Test unit
lewat — karena setiap satunya meng-assert sebuah pembaca terhadap dirinya
sendiri. Yang tidak dilakukan siapa pun adalah **menulis grant lewat penulis
sungguhan lalu BERTANYA kepada para pembacanya**.

Itu sebabnya perbaikannya bukan "betulkan lima query" melainkan "hilangkan
kemungkinan lima query berbeda". Sebuah pembaca kini memakai `activeRoleGrants`
atau ia bukan pembaca; `tests/grant-source-parity.test.ts` mengunci itu secara
statis, dan `tests/integration/grant-readers.integration.test.ts` secara
perilaku — yang terakhir adalah bentuk yang akan menangkapnya sejak awal, karena
sebuah pembaca bisa diarahkan ke tabel apa pun dan tetap ter-compile.

## Fragmen SQL, bukan VIEW

Sebuah view basis data juga akan menjadi satu definisi, tetapi repo ini belum
punya satu pun, dan yang pertama harus menjawab pertanyaan yang tak boleh
dijawab bersamaan dengan perubahan ini: `security_invoker` (tanpanya view
berjalan sebagai PEMILIKNYA dan **melewati FORCE RLS** tabel di bawahnya —
isolasinya hilang dan setiap test RLS yang ada tetap hijau), grant privilege-nya,
dan apa yang dilakukan sapuan tabel `security-readiness` terhadap relasi yang
bukan tabel.

Fragmen tidak butuh satu pun: SQL yang sampai ke Postgres persis SQL yang akan
ditulis pembacanya, jadi RLS berlaku sama seperti sebelumnya. Bun.SQL
menyisipkan tagged template bersarang sebagai SQL (parameter tetap pada
posisinya), sehingga jumlah query tidak bertambah.

## Kenapa `awcms_business_scope_assignments` TIDAK ikut

Rencana program menyebut PR 3.3 memensiunkan "dua tabel lama". Ia memensiunkan
satu.

Sebuah baris `awcms_business_scope_assignments` membawa `role_id` yang **tidak
memberi satu pun permission key hari ini** — `fetchGrantedPermissionKeys` tak
pernah membaca tabel itu; hanya SoD yang membacanya, dan hanya sebagai fakta.
Menyalin baris-baris itu ke `awcms_access_policies` akan memberi setiap subjek
ber-scope permission peran itu **di SELURUH tenant**, karena belum ada yang
mengualifikasi scope saat evaluasi sampai PR 3.4. `role_id`-nya juga nullable
sedangkan `awcms_access_policies.role_id` tidak, jadi baris keanggotaan-scope
tanpa peran tak punya bentuk untuk menjadi apa pun.

Memensiunkannya adalah keputusan yang letaknya SESUDAH kualifikasi scope, bukan
sebelumnya.

## Efek samping yang ikut ditemukan: setup wizard sudah rusak

`awcms_setup` (`sql/022`) memegang `INSERT` pada `awcms_access_assignments`.
Sejak PR 3.2 memindahkan grant bootstrap ke `awcms_access_policies`, wizard
setup gagal `permission denied for table awcms_access_policies` di setiap
deployment yang memakai `SETUP_DATABASE_URL`.

**Tak ada gerbang yang bisa melihatnya**, dan alasannya layak dicatat:
`checkWorkerSetupRoleGrants` meng-assert grant COCOK dengan matriks yang
dideklarasikan — dan kedua sisi memang masih setuju satu sama lain. Yang tidak
diperiksa siapa pun adalah apakah matriksnya cocok dengan apa yang DIBUTUHKAN
kode. `sql/103` memberi role itu `SELECT, INSERT` pada `awcms_access_policies`
dan `INSERT` pada `awcms_access_policy_events`, dan mencabut `INSERT` yang lama.

## Tabel tenant-scoped yang sengaja read-only harus DIDEKLARASIKAN

Default `checkRuntimeRoleGrants` untuk tabel tenant-scoped adalah keempat verb,
dan default itu menanggung beban: tabel FORCE RLS yang tak bisa ditulis runtime
adalah `permission denied` yang menunggu request pertama, dan tak ada hal lain di
repo ini yang akan mengatakannya.

Pensiun membalik ekspektasi itu, jadi ia dicatat di
`RETIRED_TENANT_TABLE_PRIVILEGES` — disiplin yang sama yang sudah dipakai
`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` untuk tabel RLS-free, dan karena alasan yang
sama: pemeriksanya harus bisa membedakan "dipersempit dengan sengaja" dari
"rusak", dan hanya manusia yang bisa memasok perbedaan itu. Kedua arah
ditegakkan, jadi ini bukan pintu keluar: tabel terdaftar yang mendapatkan
kembali `INSERT` gagal sekeras tabel tak-terdaftar yang kehilangan `SELECT`.

## Baris yang tidak bisa dipindahkan

FK `awcms_access_assignments.role_id` berkolom tunggal, jadi ia tak bisa mencegah
rujukan lintas-tenant; FK komposit `awcms_access_policies` bisa, dan akan
**membatalkan seluruh migrasi** pada satu baris seperti itu. Baris semacam itu
tidak memberi apa pun hari ini juga (setiap pembaca menyaring peran berdasarkan
tenant, dan RLS menyembunyikannya), jadi meninggalkannya tidak mengubah akses
siapa pun — tetapi migrasinya harus selamat melewatinya, dan itu diuji terhadap
basis data sungguhan.

Yang ditinggalkan dihitung dan disebut lewat `RAISE WARNING`. Melewatinya secara
senyap akan terbaca sebagai "tak ada yang perlu dipindahkan".

## Konsekuensi

- Sebuah grant hidup punya SATU rumah. Pertanyaan "di mana grant ini" berhenti
  punya dua jawaban.
- `access:grant-readers:check` menyusut dari sebelas berkas ke sembilan, dan
  `awcms_access_assignments` tetap ada di `GRANT_TABLES` justru supaya tak ada
  berkas yang boleh menyebutnya lagi — pesan gerbangnya kini menyebut
  `activeRoleGrants`, bukan "tambahkan entri allow-list".
- Urutan deploy adalah yang biasa (migrasi jalan sebelum rilis baru melayani
  trafik). Rilis SEBELUM ini tetap berperilaku benar sesudah migrasi terpasang —
  pembacanya melihat baris lama yang masih ada dan masih akurat; satu-satunya
  statement yang akan gagal adalah `DELETE` lama di dalam unassign, selama
  deploy berlangsung.
- Retensi tidak berubah: baris sejarah tidak tumbuh (nol penulis), jadi tak ada
  deskriptor siklus hidup baru yang perlu ditulis.
