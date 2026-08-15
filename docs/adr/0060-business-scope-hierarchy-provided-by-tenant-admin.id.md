🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0060-business-scope-hierarchy-provided-by-tenant-admin.md)

<!-- i18n-source-hash: sha256:4597672924e0fc541b5e7cc081b0b5274fb79cef3a8aedb8e22dfc4704d005be -->

# ADR-0060 — Hierarki business scope disediakan `tenant_admin` (office), bukan aplikasi turunan

- **Status:** Accepted
- **Tanggal:** 2026-08-03
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md) (capability port), [ADR-0016](0016-organization-structure-module-admission.md) (`organization_structure` — di-`Accepted` tanpa pernah ada kodenya), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (jalur aplikasi turunan DIHAPUS), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (merchant Jualanku = business scope), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (kemampuan dibangun di sini)

## Konteks

### 1. Sebuah endpoint ter-guard, ter-audit, ber-RLS yang jalur SUKSESNYA tak bisa dicapai

`POST /api/v1/identity/business-scope/assignments` (#180) menulis ke
`awcms_business_scope_assignments` (`sql/027`, FORCE RLS), digerbangi permission,
dievaluasi SoD (#181), ter-audit, ber-`Idempotency-Key`. Sebelum ADR ini,
**tidak ada satu pun input yang bisa membuatnya berhasil**, di deployment mana
pun.

Rantainya, diverifikasi ke kode:

1. `createBusinessScopeAssignment` memverifikasi `(scopeType, scopeId)` lewat
   `BusinessScopeHierarchyPort` sebelum menulis; `resolved: false` → `scope_unresolved`.
2. Satu-satunya composition root yang ada, `src/pages/api/v1/identity/business-scope/assignments/index.ts`,
   menyuntikkan `defaultBusinessScopeHierarchyPortAdapter` — adapter NO-OP yang
   mengembalikan `resolved: false` untuk **setiap** scope type.
3. Scope type cadangan `tenant` bukan jalan keluar: `validateCreateBusinessScopeAssignmentInput`
   menolaknya sebagai **tak-bisa-di-assign** (#180 review F2) — ia sentinel
   cakupan, bukan resource.

Jadi setiap request berakhir di salah satu dari dua penolakan. Sisa
subsistemnya ikut mati bersamanya: `resolveBusinessScopeFacts` tak pernah punya
baris untuk dibaca, `businessScopeFacts` pada `evaluateAccess` tak pernah terisi,
job `business-scope:expiry` tak pernah punya yang kedaluwarsa, dan SoD
`same_scope_only` tak pernah punya scope untuk dicocokkan.

### 2. Yang menunggu itu TIDAK akan datang — ADR-0034 sudah menghapusnya

NO-OP itu **benar saat ditulis**. ADR-0011/0014 mendesain base sebagai fondasi
yang di-vendor aplikasi turunan; turunan itulah yang akan membawa tabel
legal-entity/organization-unit-nya sendiri dan menyuntikkan resolver di
composition root-nya. `identity_access` bahkan menuliskan penyedia kanoniknya:
`providedBy: "organization_structure"`.

Dua hal kemudian terjadi dan tak seorang pun menutup lingkarannya:

- **`organization_structure` tak pernah ada di sini.** ADR-0016 men-`Accepted`
  modulnya; nol baris kode pernah ditulis (temuan audit yang sama sudah tercatat
  di `PROJECT_STATE.md` §4 untuk lima ADR sekaligus).
- **[ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  menghapus jalur turunannya**, dan [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
  mengunci pengembangan ke repo ini. Tidak akan ada aplikasi turunan yang
  menyuntikkan resolver, karena jalur itu sudah tidak ada.

Sejak saat itu NO-OP berhenti menjadi "default aman sementara menunggu penyedia"
dan menjadi **penolakan permanen** — kelas cacat yang sama dengan page yang tak
pernah bisa terbit ([ADR-0057](0057-blog-page-lifecycle.md)) dan tombol Restore
yang dirender persis pada baris yang pasti 404 (#351): permukaan yang melapor
sukses sambil tidak bekerja.

### 3. Base SUDAH punya hierarki nyata, dan sudah dikeraskan

`awcms_offices` (`sql/002`) milik `tenant_admin`: `parent_office_id`, `status`
(`active`/`inactive`), soft delete, `FORCE ROW LEVEL SECURITY` sejak `sql/017`,
dan — yang paling relevan — **FK komposit tenant-scoped** sejak `sql/020`,
sehingga sebuah office tidak bisa menunjuk parent milik tenant lain. CRUD,
soft-delete/restore, dan layar `/admin/offices` semuanya sudah ada.

Yang hilang bukan hierarkinya. Yang hilang adalah seorang penyedia.

## Keputusan

### A. `tenant_admin` menyediakan `business_scope_hierarchy`; scope type-nya `office`

`tenant-admin/application/office-scope-hierarchy-port-adapter.ts` me-resolve
`("office", <uuid>)` terhadap `awcms_offices`. Descriptor `tenant_admin`
mendeklarasikan `capabilities.provides: ["business_scope_hierarchy"]`,
`identity_access` mengubah `providedBy` dari `organization_structure` (hantu) ke
`tenant_admin`, dan `CAPABILITY_CONTRACT_VERSIONS` memuat capability itu untuk
pertama kalinya (`1.0.0`).

`optional: true` **tetap**. Tenant tanpa office sama sekali harus tetap jalan,
dan degradasinya sama fail-closed-nya seperti sebelumnya. Relasinya tetap
tingkat-SUMBER: adapter tiba sebagai parameter suntikan di composition root,
tidak pernah sebagai import dari `identity_access` — jadi tak ada edge
Core-bergantung-pada-Optional yang lahir.

Scope type lain tetap `resolved: false`. Itu kontrak port, bukan kelalaian:
scope type yang tak dimiliki siapa pun tak boleh menjadi cakupan otorisasi.

### B. Hanya baris HIDUP yang me-resolve, dan itu keputusan otorisasi

Soft-deleted → tidak resolve. `status = 'inactive'` → tidak resolve.
Milik tenant lain → tidak resolve. Cakupan yang hidup lebih lama daripada
resource yang dinamainya persis kasus "stale hierarchy" yang kontrak port
suruh tolak; dan tenant yang menonaktifkan sebuah cabang telah menyatakan
"ini tidak beroperasi" — membiarkan assignment-nya tetap berlaku membuat
deaktivasi jadi tindakan kosmetik.

Baris mati dilewati **di mana pun dalam rantai**: office hidup di bawah parent
yang dinonaktifkan mendapat rantai ancestor yang lebih pendek, bukan pinjaman
cakupan lewat resource yang sudah dimatikan tenant-nya.

### C. Setiap batas MENOLAK, tidak pernah memotong

Siklus, rantai melewati batas kedalaman, dan hasil melewati batas jumlah:
ketiganya `resolved: false`. Memotong lebih buruk daripada menolak di sini,
karena daftar yang terpotong **tetap** mengklaim `resolved: true` — pemanggil
menerima jawaban cakupan yang dihitung dari sebagian graf tanpa satu pun sinyal
bahwa sisanya ada. Kedua penelusuran adalah satu recursive CTE yang membawa
array `path`-nya sendiri; `updateOffice` tidak bisa me-reparent office, jadi
siklus hanya bisa tiba lewat tulisan langsung ke database — justru kasus di
mana menebak paling berbahaya.

### D. Sentinel tenant-wide hanya dipercaya bila menamai TENANT INI

`resolveBusinessScopeFacts` mencetak fakta "mencakup segalanya" untuk
`scope_type = 'tenant'` tanpa melihat `scope_id`. Tak ada jalur yang didukung
bisa menulis baris seperti itu (validator menolak scope type cadangan) — dan
justru itulah alasan pemeriksaannya ditambahkan di sini: baris yang membawanya
tidak datang lewat service, jadi ia belum melewati validasi apa pun. Kini fakta
itu hanya lahir bila `scope_id` = id tenant itu sendiri; selain itu
`resolved: false` (fail-closed).

### E. Adapter NO-OP dihapus, bukan disimpan "untuk berjaga-jaga"

Setelah composition root menyuntikkan adapter office, NO-OP tak punya pemanggil
di `src/`. Repo ini sudah dua kali mencatat pelajaran fungsi nol-pemanggil
(ADR-0056 §A). Perilakunya tidak hilang: adapter office mengembalikan
`resolved: false` untuk setiap scope type yang bukan `office`, jadi
"default fail-closed" tetap ada — sekarang sebagai cabang di satu-satunya
adapter, bukan sebagai berkas yang harus dipilih seseorang.

### F. Nol migrasi, nol permission baru

Tabel, kolom, index, FK, RLS, katalog permission, dan rutenya sudah ada
sejak `sql/002`/`sql/017`/`sql/020`/`sql/027`. Yang berubah hanya siapa yang
menjawab pertanyaan resolusi.

## Konsekuensi

- `POST /api/v1/identity/business-scope/assignments` punya jalur sukses untuk
  pertama kalinya. Assignment ber-scope office kini bisa dibuat, kedaluwarsa,
  dicabut, dan **memengaruhi otorisasi** lewat `businessScopeFacts`.
- Ini melebarkan permukaan yang sebelumnya inert: sebuah assignment kini bisa
  memberi cakupan. Penjagaannya tak berubah dan tetap berlapis — permission
  gate, penolakan self-grant, evaluasi SoD assignment-time, audit, effective
  dating + expiry, dan `resolved: false` yang tetap men-deny aksi high-risk.
- Rute yang ingin otorisasi ber-scope masih harus **memilihnya secara sadar**
  (`resourceAttributes.requiredScopeType`/`.requiredScopeId` + meneruskan
  `hierarchyPort`). Tidak ada rute yang melakukannya hari ini, jadi perilaku
  setiap endpoint yang ada tidak berubah oleh ADR ini.
- `merchant` Jualanku ([ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md))
  akhirnya punya fondasi yang bisa dipijak: ia dimodelkan sebagai business
  scope, dan resolver base tak lagi menolak segalanya. Bentuk scope merchant
  sendiri tetap butuh ADR admission-nya sendiri.
- Hierarki yang lebih kaya (legal entity, cost center) nanti memperluas adapter
  ini atau mengganti binding-nya di composition root — bukan menghidupkan lagi
  jalur turunan yang ADR-0034 hapus.

## Alternatif yang ditolak

1. **Biarkan NO-OP, tulis `organization_structure` dulu.** Modul baru dengan
   tabel hierarki barunya sendiri, sementara `awcms_offices` sudah ada, sudah
   ber-RLS FORCE, sudah punya FK komposit anti-lintas-tenant, dan sudah punya
   layar admin. Itu membangun hierarki KEDUA untuk membenarkan sebuah baris
   `providedBy`.
2. **Cabut seluruh subsistem business scope.** Simetris dengan pencabutan
   ADR-0058 §C/§D — dan salah di sini: mesinnya lengkap (assignment, effective
   dating, expiry job, SoD scope-aware, decision log), yang hilang cuma
   penyedia; dan ADR-0045 sudah bergantung padanya.
3. **Resolve office TANPA memeriksa `status`/`deleted_at`.** Lebih sederhana,
   dan membuat soft-delete serta deaktivasi office tak berpengaruh pada
   otorisasi — cakupan yang hidup lebih lama dari resource-nya.
4. **Memotong hasil di batas alih-alih menolak.** Jawaban yang diam-diam salah
   sebagian, dengan `resolved: true` yang menutupinya (§C).
5. **Menjadikan `business_scope_hierarchy` konsumsi WAJIB.** Akan memaksa
   setiap deployment punya penyedia dan mengubah kegagalan resolusi dari
   deny-yang-terdefinisi menjadi kegagalan komposisi.
