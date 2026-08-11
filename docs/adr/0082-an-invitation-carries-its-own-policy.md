# ADR-0082 — Sebuah undangan membawa Policy-nya sendiri

- **Status:** Diterima (2026-08-11).
- **Konteks:** Issue #423 Gelombang 4 PR 4.1. Migrasi `sql/106` (skema) dan
  `sql/107` (permission).
- **Membangun di atas:**
  [ADR-0078](0078-a-grant-carries-its-own-scope.md) (bentuk Policy),
  [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md) (satu
  sumber grant), [ADR-0080](0080-a-scoped-grant-covers-only-what-its-role-confers.md)
  (batas kualifikasi scope — dikutip di bawah dan **dijawab dengan tidak
  memproduksinya**), dan [ADR-0081](0081-a-user-group-is-a-subject-that-grants-roles.md)
  (pemisahan otoritas keanggotaan vs pemberian peran).

## Keputusan

`awcms_invitations` + `awcms_invitation_policies`. Sebuah undangan menyebut
alamat, dan membawa daftar peran yang akan dipegang orang itu begitu ia
menerima. Penerimaan (PR 4.2) memberikan peran-peran itu lewat penulis grant
yang sudah ada — bukan lewat jalur kedua.

Registrasi-mandiri **tetap ada**. Arahnya berlawanan: registrasi adalah _tarik_
(orang asing meminta), undangan adalah _dorong_ (admin menawarkan). Masing-masing
punya permission dan cerita auditnya sendiri.

## Mengundang dan MEMBERI PERAN adalah dua otoritas

Ini pengulangan ADR-0081 §"Kenapa memberi grup sebuah PERAN memakai
`access_control.assign`", dan pengulangannya disengaja karena undangan
memperburuk taruhannya.

`invitations.create` memutuskan **siapa yang boleh diajak masuk**.
`access_control.assign` — yang sudah ada dan sudah berarti "membagikan peran" —
adalah yang memutuskan **peran apa yang ia bawa**. Undangan ber-peran menuntut
KEDUANYA; undangan tanpa peran hanya menuntut yang pertama.

Menyatukannya akan melahirkan eskalasi yang persis seperti eskalasi grup, hanya
lebih buruk pada satu sumbu: grant kepada grup menjangkau orang yang bergabung
nanti, sedangkan grant lewat undangan menjangkau orang yang **belum ada** —
tidak ada baris untuk di-review, tidak ada nama untuk dikenali, dan penerimanya
memilih sendiri kapan grant itu menjadi hidup.

Karena itu penolakan `is_system` diperiksa **dua kali**: saat undangan dibuat
dan lagi saat diterima. Presedennya `approveRegistrationRequest`, dan alasan
pemeriksaan kedua adalah jeda waktunya — sebuah peran bisa menjadi `is_system`,
di-soft-delete, atau dicabut dari katalog di antara kedua momen itu.

## Undangan membawa kolom scope-nya, DIPATOK tenant-wide — dan itu jawaban atas ADR-0080

ADR-0080 menutup dirinya dengan batas yang eksplisit: kualifikasi scope hanya
sekuat rute yang **menyatakan** required scope, karena `fetchGrantedPermissionKeys`
tetap mengembalikan kunci dari semua grant — ia harus, sebab gerbang RBAC
berjalan lebih dulu. Pada rute yang tak menyatakan scope, sebuah grant ber-scope
memberi permission itu **di seluruh tenant**. Batas itu inert selama nol penulis
grant ber-scope ada, dan ADR-0080 menuliskan bahwa PR yang menambahkan penulisnya
tidak boleh mendarat tanpa menjawabnya.

Undangan ber-scope adalah penulis itu. PR ini menjawabnya dengan **menolak
menjadi penulis itu**, bukan dengan menghindari kolomnya.

`awcms_invitation_policies` membawa `scope_type` dan `scope_id`, dan sebuah
CHECK memaku keduanya:

```sql
CONSTRAINT awcms_invitation_policies_tenant_wide_only_check
  CHECK (scope_type = 'tenant' AND scope_id = tenant_id)
```

Preseden persisnya ADR-0078 §"`subject_type` sengaja menerima satu nilai": kolom
yang lahir dengan satu nilai legal, supaya penambahan berikutnya adalah satu
`DROP CONSTRAINT`/`ADD CONSTRAINT` dan bukan backfill. ADR-0081 memanen imbalan
itu — grup mendarat tanpa memindahkan satu baris pun.

Pertimbangan yang ditolak, dan alasannya layak ditulis karena ia terdengar lebih
aman: **menghilangkan kolomnya sama sekali**. Argumennya adalah bahwa
`grantRolePolicy` meng-hardcode `('tenant', ${tenantId})` — ia tidak punya
parameter scope — sehingga kolom scope akan diterima, disimpan, lalu diabaikan
diam-diam saat materialisasi; admin yang mengundang seseorang "hanya untuk
cabang Bandung" mendapat orang dengan peran itu di seluruh tenant sementara
barisnya menyatakan sebaliknya.

Argumen itu benar untuk kolom yang **tidak dibatasi**, dan CHECK di atas
menghapusnya seluruhnya: nilai yang bisa berbohong tidak bisa direpresentasikan.
Yang tersimpan dan yang dimaterialisasi selalu sepakat, karena hanya ada satu
nilai yang bisa keduanya pegang. Sebuah kolom yang tak bisa berbohong dan
menghemat satu migrasi berikutnya lebih baik daripada kolom yang absen.

Saat penulis grant ber-scope benar-benar dibangun, CHECK ini dilonggarkan di
migrasi yang **sama** dengan yang mengajari `grantRolePolicy` menerima scope —
dan sejak detik itu `SCOPE_NARROWING_ENABLED = false` berhenti menjadi rollback
yang aman (`scope-narrowing.ts` §22-25 menuliskannya). Itu ADR tersendiri.

## `skip_email_confirmation` bergerbang, bukan sekadar tercatat

Kolom ini menghapus satu-satunya bukti bahwa orang di ujung sana benar-benar
memegang mailbox-nya. Rencana program mengunci pemakaiannya pada permission
ber-`scope: 'platform'`, atau pada principal target yang sudah terverifikasi.

Principal global belum ada (Gelombang 7), jadi paruh kedua diturunkan ulang
untuk dunia hari ini: **identitas aktif yang sudah ada di tenant ini** dengan
`login_identifier` yang sama sudah pernah membuktikan kendali mailbox-nya —
mengundangnya lagi (peran baru, keanggotaan yang sama) tidak menuntut bukti
kedua.

Selain itu ia menuntut `identity_access.invitations.configure`, satu-satunya
permission modul ini yang ber-`scope: 'platform'` — ditolak chokepoint kecuali
tenant yang bertindak adalah tenant platform ([ADR-0053](0053-platform-scoped-permissions.md)).

Tanpa gerbang itu, admin tenant mana pun bisa mencetak akun tak terverifikasi
untuk alamat siapa pun. Hari ini akun itu terkurung di tenantnya; setelah
Gelombang 7 ia adalah **principal global**, dan `materializeMembership()` —
diperkenalkan di PR 4.2 sebagai satu fungsi justru supaya Gelombang 7 punya satu
tempat untuk diarahkan ulang — adalah yang akan mencetaknya. Gerbangnya mendarat
sekarang, bersama kolomnya, karena pelebaran hanya mendarat setelah penyempitan
yang membatasinya (aturan lintas-gelombang §6.5).

## Resend MEROTASI, dan `resend_count` dibatasi DATABASE

Tanpa rotasi, "kirim ulang" adalah permukaan perbanyakan token: satu undangan
menumbuhkan N tautan hidup, dan mencabut undangan berarti mencabut N rahasia
yang tak seorang pun hitung. Resend karena itu menulis `token_hash` baru di
baris yang sama — tautan lama mati pada detik yang sama tautan baru lahir.

`CHECK (resend_count <= 5)` ada di basis data, bukan di TypeScript, dengan alasan
yang sama `awcms_session_handoff_codes` menaruh TTL-nya di sana: batas yang hanya
hidup di lapisan aplikasi adalah batas yang hilang begitu ada pemanggil kedua.

## Kedaluwarsa dijawab 404, bukan 410

`410 Gone` memberi tahu pemegang token bahwa token itu **pernah sah**. Undangan
dikirim ke alamat email, dan alamat email bocor; 404 seragam untuk token tak
dikenal, kedaluwarsa, tercabut, dan sudah diterima membuat permukaan ini bukan
oracle status.

Ini menyimpang dari `POST /auth/password/reset`, yang menjawab
`400 PASSWORD_RESET_INVALID` untuk kelas kegagalan yang setara. Keduanya benar
untuk bentuknya masing-masing: token reset tiba di **body** sebuah POST, jadi
404 akan berarti "rute ini tidak ada"; token undangan tiba di **path**, jadi 404
adalah jawaban yang sama persis dengan yang diberikan URL yang salah ketik.

## Yang DITOLAK

1. **Kolom scope TANPA CHECK yang memakunya** — dan, pada arah sebaliknya,
   menghilangkan kolomnya sama sekali. Keduanya dibahas di §"Undangan membawa
   kolom scope-nya" di atas: yang pertama bisa berbohong, yang kedua membayar
   satu migrasi lagi tanpa membeli apa pun.
2. **`invitations.assign` sebagai permission tersendiri** — undangan ber-peran
   memakai `access_control.assign`, permission yang sudah berarti "membagikan
   peran". Permission kedua akan menciptakan pemberi peran yang tak terlihat
   oleh siapa pun yang meng-audit siapa boleh memberi peran.
3. **`invitations.resend` sebagai action tersendiri** — `resend` bukan anggota
   `AccessAction`, dan menambahkannya berarti menyatakan bahwa mengirim ulang
   adalah otoritas yang berbeda dari menerbitkan. Ia tidak: resend mencetak
   rahasia baru dengan daya yang sama persis, jadi ia digerbangi `create`.
4. **`delete` untuk undangan** — `revoke` sudah menjawab pertanyaannya ("tautan
   ini mati sekarang") sambil mempertahankan barisnya sebagai jawaban atas
   "siapa pernah mengundang siapa, dan apa yang terjadi". Baris yang dihapus dan
   undangan yang tak pernah ada tidak bisa dibedakan.
5. **Menyimpan token mentah supaya admin bisa menyalin tautannya** — repo ini
   tidak menyimpan satu pun kredensial hidup di luar hash satu-arahnya. Admin
   yang butuh tautan baru me-resend; itu sudah merotasi, dan jejaknya tercatat.
6. **Mengembalikan alamat email di preview** — pemanggilnya tak terautentikasi.
   Preview menjawab nama tenant dan nama pengundang; pemegang tautan sudah tahu
   alamat mana yang dikirimi karena ia membacanya di mailbox itu, dan pemegang
   tautan **curian** tidak.
7. **`Idempotency-Key` pada resend** — me-replay resend berarti mengembalikan
   token yang sudah dirotasi, atau menyimpan token plaintext di
   `awcms_idempotency_keys`. Presedennya penerbitan kredensial mesin (ADR-0049),
   yang menolaknya untuk alasan kedua persis.
8. **Undangan lintas-tenant dari satu baris** — `awcms_invitations` ber-`tenant_id`
   dengan FK komposit seperti tabel otorisasi lainnya. Satu manusia diundang ke
   tiga tenant adalah tiga undangan, karena hari ini ia juga tiga identitas.
   Menyatukannya adalah Gelombang 7.

## Konsekuensi

- `awcms_invitations` membawa deskriptor `dataLifecycle` (`generic`, lantai 7
  hari) seperti `awcms_registration_requests`: baris yang sudah selesai
  di-review adalah yang dipurge, dan lantainya ada supaya audit
  `invitation_accepted` masih menunjuk sesuatu.
- `awcms_invitation_policies` masuk `BOUNDED_BY_DESIGN` — ia dibatasi induknya
  lewat `ON DELETE CASCADE`, jadi retensi induknya adalah retensinya. Ini
  pemakaian `CASCADE` **kedua** di repo ini; alasannya ada di header `sql/106`.
- `tests/access-assignment-writers.test.ts` melihat berkas baru: penerima
  undangan memanggil `grantRolePolicy(`, jadi berkas itu wajib memuat
  `is_system` — dan ia memuatnya, karena penolakan kedua memang hidup di sana.
- Tiga permission baru mendarat tanpa layar. Mereka masuk ledger
  `NOT_YET_SCREENED`; `/admin/invitations` adalah perubahan tersendiri, urutan
  yang sama dengan ADR-0056 (`media_library` mendapat permukaan API lebih dulu,
  layarnya setelahnya).
