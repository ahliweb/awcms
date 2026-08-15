🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0089-a-partner-is-an-ordinary-tenant.md)

<!-- i18n-source-hash: sha256:4968f5d3e43c92a59935193f2e22c90cd41501e7501b0534cbc6ed04c191ee5d -->

# ADR-0089 — Partner adalah tenant biasa: jangkauan adalah DATA, bukan permission

- **Status:** Diterima (2026-08-12).
- **Konteks:** Issue #423 Gelombang 8 PR 8.1 — PR pertama gelombang terakhir.
  Migrasi `sql/116`.
- **Membangun di atas:**
  [ADR-0053](0053-platform-scoped-permissions.md) (tidak ada superadmin global;
  kuasa lintas-tenant adalah `platform` scope, dan itu pun dijaga dua mekanisme
  independen),
  [ADR-0082](0082-an-invitation-carries-its-own-policy.md) (bentuk yang benar untuk
  "seseorang dari luar memulai sesuatu di dalam sebuah tenant": tenant pemilik
  yang menulis, token yang menyeberang — bukan pembacaan yang menyeberang),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) dan
  [ADR-0088](0088-tenant-selection-and-switching.md) (dua PR berturut-turut yang
  rencananya mengasumsikan pembacaan lintas-tenant yang FORCE RLS larang — ADR
  ini menolak menjadi yang ketiga).

## Keputusan

**`ModulePermissionScope` tetap `"tenant" | "platform"`. Tidak ada nilai
`partner`, sekarang maupun nanti.** Kemitraan dimodelkan sebagai **data**: dua
tabel, `awcms_partners` dan `awcms_partner_managed_tenants`, keduanya
tenant-scoped dan FORCE RLS seperti tabel lain di repo ini.

Kalimat yang wajib bertahan verbatim karena orang berikutnya akan mengusulkan
nilai `partner` lagi:

> **`scope` mengatur siapa yang boleh MEMEGANG sebuah permission; kemitraan
> mengatur OBJEK MANA yang disentuhnya.**

Menyatukan keduanya menghasilkan permission yang **dipegang dengan benar dan
dijalankan terhadap tenant yang salah** — dan tidak satu pun policy RLS akan
keberatan, karena aktornya memang terautentikasi secara sah di suatu tempat.
Itu bukan kegagalan yang berbunyi; itu kegagalan yang lolos setiap gerbang.

## Menjadi partner dan menjangkau tenant adalah dua pertanyaan berbeda

Pemisahan itu bukan penghalusan; ia yang membuat ADR ini bisa memakai `scope`
yang sudah ada tanpa menambah nilai ketiga:

| Pertanyaan                           | Dijawab oleh                                                            | Ditulis oleh                            |
| ------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| Siapa yang **boleh menjadi** partner | permission ber-`scope: "platform"` (ADR-0053, mekanisme yang sudah ada) | tenant platform                         |
| Tenant mana yang **dijangkau**       | baris di `awcms_partner_managed_tenants`                                | **tenant target, di tenantnya sendiri** |

Baris pertama adalah keputusan komersial operator, persis seperti katalog paket
`awcms_plans` yang hanya bisa ditulis migrasi (ADR-0084). Baris kedua adalah
keputusan pelanggan tentang tenantnya sendiri. Tidak ada satu pun aktor yang
bisa melakukan keduanya, dan itulah seluruh keamanan model ini.

### Registri partner adalah data tenant PLATFORM — dipaksa, bukan dipilih

Bentuk yang wajar dibayangkan lebih dulu adalah `awcms_partners` ber-`tenant_id`
= tenant partner itu sendiri: satu tenant, satu baris, "aku adalah partner".
**Bentuk itu tidak bisa ditulis oleh siapa pun.** Di bawah FORCE RLS, tenant
platform yang bertindak dengan `app.current_tenant_id` = dirinya sendiri tidak
dapat menyisipkan baris ber-`tenant_id` tenant lain — policy isolasinya menolak,
dan itu memang tugasnya. Satu-satunya cara menulisnya adalah tenant partner
mendaftarkan dirinya sendiri, yaitu pendaftaran-mandiri kemitraan komersial.

Jadi barisnya milik tenant **platform**, dan subjeknya (`partner_tenant_id`)
adalah tenant lain — bentuk yang sudah dipakai `awcms_tenant_status_transitions`
(`sql/092`) sejak ADR-0054. Satu baris berada di satu tenant dan **menyebut**
tenant lain; ia tidak pernah berada di dua tempat.

Basis data tidak tahu tenant mana yang memegang otoritas platform — jawabannya
resolusi env (`lib/tenant/platform-tenant.ts`), bukan kolom — jadi tidak ada
CHECK yang bisa memasangnya. Yang menegakkannya adalah dua mekanisme independen
ADR-0053 di jalur tulis, dan PR ini mengirim **nol penulis**.

## Sisi mana yang memiliki baris pemetaan — dan mengapa rencananya tidak menjawabnya

Rencana Gelombang 8 menetapkan bahwa **baris grant** akses terdelegasi ber-RLS
pada tenant **TARGET**, dengan alasan "pandangan pelanggan yang otoritatif". Ia
tidak menetapkan hal yang sama untuk pemetaan partner→tenant, dan pemetaan itu
punya masalah yang **persis sama**: ia adalah relasi antara dua tenant,
sementara di bawah FORCE RLS sebuah baris hanya punya **satu** `tenant_id` yang
policy-nya kenali.

Tiga bentuk yang mungkin, dan hanya satu yang selamat:

1. **RLS pada tenant partner.** Partner bisa mendaftar seluruh bukunya; pelanggan
   **buta terhadap siapa yang menjangkau tenantnya sendiri** dan karena itu tidak
   bisa memutuskannya. Ditolak: itu membalik satu-satunya asimetri yang boleh ada.
2. **Dua baris, satu di tiap sisi.** Setiap pencabutan harus menemukan keduanya,
   dan kegagalannya senyap serta permanen — kelas yang sama dengan proyeksi
   keanggotaan global yang ditolak ADR-0088 dan direktori lintas-tenant yang
   ditolak ADR-0087. Ditolak.
3. **RLS pada tenant TARGET.** Dipilih.

Pelanggan **wajib** bisa melihat dan mencabut setiap jangkauan ke dalam tenantnya
tanpa meminta izin siapa pun, dan itu hanya benar bila barisnya berada di
tenantnya. Pandangan partner atas bukunya sendiri adalah kenyamanan, bukan
kontrol keamanan, dan dilayani lewat fungsi `SECURITY DEFINER` sempit
(preseden `sql/048`) **saat PR 8.4 memberinya pemanggil** — bukan di PR ini.
Fungsi `SECURITY DEFINER` tanpa pemanggil adalah permukaan serang tanpa
manfaat.

Satu catatan yang harus dibaca siapa pun yang menulis fungsi itu nanti:
`sql/048` mendokumentasikan bahwa di bawah postur repo ini (pemilik fungsi
NON-superuser, `NOBYPASSRLS`, sql/019–022) **`SECURITY DEFINER` TIDAK mem-bypass
RLS.** Ia bekerja hanya karena empat bagian sekaligus — role pemilik NOLOGIN
tersendiri, policy baca eksplisit ber-scope untuk role itu, daftar kolom tetap,
dan `EXECUTE` yang dikunci. "Cukup satu fungsi definer" adalah salah baca yang
akan menghasilkan fungsi yang mengembalikan nol baris selamanya.

## Pelanggan yang memulai. Selalu

Karena barisnya hidup di tenant target dan ditulis di konteks tenant target,
**tidak ada satu pun penulisan lintas-tenant di model ini.** Partner tidak bisa
memasukkan baris ke tenant yang belum dikelolanya — yang, kalau bisa, adalah
partner memberi dirinya sendiri jangkauan.

Arah sebaliknya (partner menawarkan diri) sengaja **tidak** dibangun sebagai
penulisan. Bila kelak dibutuhkan, bentuknya sudah ada dan bukan bentuk baru:
ADR-0082 — pihak yang memiliki keanggotaan menulis tawarannya di tenantnya
sendiri, dan yang menyeberangi batas adalah **token**, bukan pembacaan maupun
penulisan. Menyebutkan ini sekarang supaya ketiadaannya terbaca sebagai
keputusan, bukan kelalaian.

## FK menegakkan apa yang `SELECT` tidak boleh melihat

`awcms_partner_managed_tenants.partner_tenant_id` mereferensi
`awcms_partners (partner_tenant_id)` — kolom SUBJEK registri, bukan kolom
pemiliknya. Pemeriksaan foreign key **melewati RLS**, sehingga
pelanggan dapat menamai partner yang barisnya tidak akan pernah bisa ia baca:
basis data menolak baris yang menamai tenant yang bukan partner terdaftar, tanpa
pernah memberi siapa pun kemampuan mengenumerasi daftar partner.

Bahwa FK melewati RLS biasanya adalah **bahaya** di repo ini — ia yang menuntut
FK komposit ber-`tenant_id` pada tabel office (#149). Di sini justru itu
persisnya yang diinginkan, dan perbedaannya dinyatakan supaya tidak "diperbaiki"
oleh orang yang mengenali polanya tetapi bukan alasannya: referensi lintas-tenant
di sini **disengaja dan satu-satunya arah yang masuk akal**.

Nama partner tidak perlu didenormalisasi ke dalam baris pemetaan.
`awcms_tenants` adalah tabel GLOBAL tanpa RLS (terdaftar di
`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`), jadi pelanggan sudah bisa membaca nama
tenant partner yang menjangkaunya. Denormalisasi akan menciptakan salinan yang
bisa basi tanpa ada yang tahu.

## Yang mendarat inert, dan kalimat yang dipinjam dari ADR-0082

Kedua tabel mendarat **tanpa satu pun pembaca di gerbang otorisasi**.

`activeRoleGrants` (ADR-0079) tidak membacanya dan **tidak boleh pernah
diajari**: subjek yang memegang peran karena sebuah baris di suatu tempat
menyebutnya partner adalah persis jalur grant kedua yang ADR-0079 hapuskan.
Karena itu keduanya juga **tidak** ditambahkan ke `GRANT_TABLES` di
`scripts/access-grant-readers-check.ts` — berkas yang menamainya bukan sedang
membaca otorisasi.

Ketika PR 8.4 membacanya, ia hanya boleh **MENYEMPITKAN**: permukaan
`/api/v1/partner/**` diotorisasi oleh pemetaan **DAN** grant aktif, tidak pernah
oleh salah satunya, dan pemetaan itu sendiri tidak pernah menghasilkan
`allowed: true` (aturan lintas-gelombang 3). Sebuah baris pemetaan adalah
prasyarat, bukan pemberian.

## Konsekuensi

- Sebuah permission tetap berarti hal yang sama di mana pun ia dipegang. Tidak
  ada pembaca `scope` di mana pun yang perlu berubah, sekarang atau nanti.
- Mencabut kemitraan adalah `DELETE` satu baris di tenant pelanggan, dan
  sesudahnya tidak ada jangkauan yang tersisa untuk dilupakan. Sengaja **hard
  delete**: pemetaan yang di-soft-delete adalah baris yang bisa dihidupkan
  kembali oleh satu bug, dan riwayatnya sudah dijawab `awcms_audit_events` yang
  punya retensinya sendiri.
- Kedua tabel masuk `BOUNDED_BY_DESIGN`, bukan karena menulis deskriptor
  merepotkan, melainkan karena tidak ada satu pun jalur trafik yang bisa
  menambah baris: satu ditulis tenant platform, satu ditulis administrator
  pelanggan, dan keduanya ber-unique index yang membatasi satu baris per pasangan.
- Penambahan nilai ketiga pada `ModulePermissionScope` memerahkan
  `tests/platform-scoped-permissions.test.ts`, yang berjalan di rantai `check`.
  Klaimnya diuji di level **source** karena union itu adalah TIPE — ia tidak ada
  saat runtime, jadi tidak ada nilai yang bisa diperiksa test perilaku mana pun —
  dan dipasangkan dengan asersi keberadaan supaya rename tidak membuatnya lolos
  secara hampa (aturan lintas-gelombang 4). Ia sengaja **tidak** menjadi gerbang
  ke-42 di rantai: berkas test itu sudah tempat orang yang menyentuh `scope`
  membaca, dan gerbang baru untuk satu union adalah upacara, bukan kontrol.

## Ditolak

- **Nilai `partner` pada `ModulePermissionScope`** — alasannya di atas, dan
  penolakannya kini digerbangi, bukan sekadar dicatat.
- **Tabel partner GLOBAL tanpa RLS.** Ia akan menjadi direktori setiap
  kemitraan komersial di instalasi ini, terbaca oleh setiap tenant — kelas
  artefak yang sama dengan direktori keanggotaan lintas-tenant yang ditolak
  ADR-0087, dan tabel global kelima.
- **Pemetaan yang ditulis dua kali, satu baris di tiap sisi.**
- **Penulisan yang dimulai partner** ke dalam tenant yang belum dikelolanya.
- **Denormalisasi nama partner** ke baris pemetaan.
- **Fungsi `SECURITY DEFINER` untuk pandangan partner di PR ini**, sebelum ada
  yang memanggilnya.
- **Atribut ABAC `subject.partnerId`.** Program #423 mengunci tepat dua atribut
  baru (`subject.principalKind`, `resource.scopeType`) dan yang ketiga tidak
  dibuka di sini.
