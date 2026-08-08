---
"awcms": minor
---

fix(keamanan): approve registrasi berhenti bisa memberikan role `owner`

`POST /api/v1/registration-requests/{id}/approve` memvalidasi `roleIds` hanya
dengan `SELECT id FROM awcms_roles WHERE tenant_id = … AND deleted_at IS NULL`
(`identity-access/application/self-registration.ts`), lalu menulis langsung ke
`awcms_access_assignments`. Tidak ada penyaringan `is_system`.

`owner` **adalah** system role, dan `tenant-admin/application/platform-bootstrap.ts`
men-seed-nya dengan **seluruh** katalog permission tenant. Jadi prinsipal yang
hanya memegang `identity_access.registration_requests.{read,approve}` — peran
yang docblock rutenya sendiri rancang agar **tidak** menyentuh katalog RBAC
("the authority to admit someone to a tenant is not the authority to edit
roles") — bisa meng-approve dengan `roleIds: [<id owner>]` dan mencetak akun
ber-izin penuh. Dan bukan lewat `curl` saja: `/admin/registrations` merender
picker dari `listRoles`, yang tidak menyaring `is_system`, sehingga `owner`
tampil sebagai salah satu opsi di dropdown.

Jalur resmi menolaknya sejak awal: `user-admin.ts#assignRole` melempar
`SystemRoleAssignmentError` dan rutenya digerbangi `access_control.assign`
(→ `409 ROLE_SYSTEM_PROTECTED`). **Dua penulis satu tabel dengan dua aturan
berbeda** — itu kelas cacatnya, bukan satu baris yang terlewat.

Perbaikannya:

- Service menolak sebelum menulis apa pun (`outcome: "system_role"` +
  `roleCodes`). Sengaja **bukan** dikolapskan ke `unknown_role`: role-nya ada
  dan layar reviewer baru saja merendernya, jadi menjawab "tidak ada" adalah
  kebohongan tentang baris yang mereka lihat. Ia juga tidak membocorkan apa pun
  — `registration_requests.read` sudah menampilkan daftar role tenant itu.
- Route memetakannya ke **`409 ROLE_SYSTEM_PROTECTED`**, kode yang SAMA dengan
  `POST /api/v1/access/assignments` untuk penolakan yang sama.
- Baris audit `registration_approved` kini membawa `roleCodes`, bukan hanya
  `roleCount`. Approval yang memberi role adalah pemberian privilese, dan
  `roleCount: 1` tak bisa menjawab satu-satunya pertanyaan auditor tentangnya.
- Picker di `/admin/registrations` tidak lagi menawarkan system role —
  presentasi saja; otoritasnya tetap endpoint.

Gerbang yang ikut mendarat, dan ia menutup KELASNYA bukan kejadiannya:
`tests/access-assignment-writers.test.ts` menuntut **setiap** berkas `src/**`
yang memuat `INSERT INTO awcms_access_assignments` juga membaca `is_system`,
atau terdaftar sebagai pengecualian ber-alasan (hari ini tepat satu:
`platform-bootstrap.ts` — bootstrap tenant memang perbuatan membuat owner
pertama, berjalan sebelum ada sesi mana pun). Entri basi ikut memerahkan.
Mutation-proven: mengembalikan cacat aslinya membuatnya MERAH dan menyebut
berkasnya; menghapus filter picker memerahkan contract test.
Dua test integrasi (`system_role` → nol baris `awcms_access_assignments`, nol
identitas, request tetap `pending`; role biasa tetap diberikan dan disebut
namanya) menjaga sisi database — arah kedua itu perlu, karena
`AND is_system = false` yang salah tulis bisa menolak **semua** role sambil
membuat test pertama tetap hijau.

**Yang SENGAJA tidak dikerjakan di sini, dan alasannya.** Approval tetap boleh
memberikan role NON-system tanpa pemanggilnya memegang
`access_control.assign`. Itu desain yang tertulis eksplisit di docblock rutenya,
dan menyempitkannya adalah perubahan **otoritas** — tempatnya ADR, bukan
perbaikan bug. Konsekuensinya dinyatakan, bukan disembunyikan: tenant yang
membuat role non-system ber-izin besar membuat pemegang `approve` bisa
memberikannya. Yang ditutup PR ini adalah eskalasi ke katalog PENUH lewat role
yang tak seorang pun bisa buat lewat API (`role-admin.ts#createRole` menulis
`is_system` sebagai `false` tetap).

Nol migrasi: kolom, katalog permission, dan proteksi system-role di jalur
sebelah sudah ada — yang hilang hanya penegakannya di penulis kedua.
