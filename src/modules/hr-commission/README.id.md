🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:546a77fdcdacbc2cae061ab50e327ad29ec215203c3b5cc422a5c51346c47a20 -->

# `hr_commission`

**Aturan komisi berversi** (Issue #950) dan **buku besar akrual** (Issue #951),
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.id.md), fase 2
keluarga `hr_*`. Paket desainnya adalah
[`docs/awcms/hr-payroll.id.md`](../../../docs/awcms/hr-payroll.id.md) bagian 2.2 dan
6; berkas ini adalah peta kodenya.

## Apa yang ada, dan apa yang belum

Ini adalah **fondasi aturan** (#950: `awcms_hr_commission_rules`, API draft /
publish / retire, **fungsi evaluasi yang murni**) dan **buku besar akrual** (#951:
`awcms_hr_commission_accruals`, `awcms_hr_commission_transitions`, siklus approve /
release / void / pay, dan port atribusi-penjualan). **Belum ada:** reversal
akrual yang payable atau paid (akrual negatif kompensasi; `CommissionAccrualPort.void`
menolaknya sebagai `period_closed`, di bawah), event `awcms.hr.commission.*` lainnya
(hanya `voided` yang ada), dan klaim payroll atas sebuah akrual (PS-19, di bawah).
Ini **bukan komisi afiliasi** (hr-payroll.md 6.4: penerimanya di sini selalu sebuah
employment) dan **tidak membawa aturan negara atau yurisdiksi mana pun**: tenant
menyusun aturannya sendiri.

Status `active` sejak Issue #952: modul mendeklarasikan satu layar admin,
`/admin/hr/my-commission`, tempat karyawan membaca akrual MILIKNYA sendiri (hanya
baca; `GET /api/v1/hr-commission/my-accruals`, `docs/awcms/workforce-self-service.md`).
Layar aturan dan pengelolaan buku besar masih hanya lewat API.

## Aturan yang membuatnya aman

- **Aturan adalah konfigurasi.** Ia tidak merujuk employment, profil, atau orang
  mana pun; satu-satunya kolom berbentuk-orang adalah empat stempel aktor. Sebuah
  tes memastikan kolom personal, foto, biometrik, atau perangkat tidak muncul.
- **Versi published tidak dapat diubah, lewat trigger** (`sql/182`), bukan lewat
  kode handler: draft dapat diedit dan boleh menjadi `published` (atau `retired`,
  meninggalkannya); satu-satunya perubahan yang diizinkan pada baris published
  adalah pindah ke `retired`, dengan semua kolom lain identik byte demi byte; baris
  retired tidak pernah berubah. Identitas (`rule_key`, `version_no`) tidak pernah
  berubah di keadaan apa pun, dan tidak ada baris yang pernah dihapus (`awcms_app`
  tidak punya DELETE dan trigger menolaknya untuk semua orang).
- **Baris lahir sebagai draft** (trigger `BEFORE INSERT`): versi published hanya
  dapat berasal dari draft yang lolos pemeriksaan tumpang-tindih di jalannya.
  Draft boleh langsung menjadi `retired`; itu disengaja ("tinggalkan draft ini"),
  jadi baris retired tidak berarti pernah dipublikasikan (`published_at` yang
  menjawab).
- **Publish terikat pada apa yang dilihat peninjau, dan pada orang kedua.** Setiap
  aturan membawa `contentDigest` (SHA-256 atas kunci, versi, dan term yang dapat
  diedit). `PUT` dan `publish` wajib menyebut digest yang mereka dasarkan
  (`expectedContentDigest`); bila term berubah sejak itu, hasilnya `409
RULE_CHANGED` dan tidak ada yang ditulis, sehingga draft yang diedit antara
  "melihat" dan "mempublikasikan" tidak pernah terpublikasi tanpa terlihat dan dua
  editor tidak saling menimpa. Digest dari yang dipublikasikan masuk ke baris
  audit (tanpa rate atau jumlah). **Maker / checker:** siapa pun yang membuat atau
  terakhir mengedit draft tidak dapat mempublikasikannya (`403
PUBLISH_BY_AUTHOR_FORBIDDEN`) — kontrol yang diminta desain payroll untuk aturan
  payroll (hr-payroll.md PS-07), di sini untuk aturan komisi. Tenant satu-orang
  karena itu butuh login kedua untuk mempublikasikan.
- **Berlaku-efektif.** Jendela setengah-terbuka, `[effective_from, effective_to)`,
  `NULL` = tanpa akhir. Tidak ada dua versi **published** dari satu aturan yang
  tumpang-tindih; trigger mengambil advisory lock per-(tenant, aturan) sebelum
  memeriksa, sehingga dua publish serentak berurutan dan yang kedua ditolak
  (exclusion constraint butuh `btree_gist`, yang tidak diminta migrasi mana pun di
  sini). Versi retired tidak lagi dihitung. Handler mengambil lock yang sama dan
  memeriksa lebih dulu, sehingga penolakannya `409 RULE_WINDOW_OVERLAP` yang bersih
  dengan menyebut versi yang bentrok; trigger adalah penopangnya.
- **Penggantian.** Versi published tidak pernah diedit untuk memberi ruang, jadi
  penggantinya membutuhkan jendela pendahulu BERAKHIR di tempat ia mulai: isi
  `effectiveTo` saat menyusun pendahulu, atau retire-kan.
- **Aturan yang berlaku** untuk sebuah event adalah versi published yang jendelanya
  memuat tanggal event itu sendiri (`selectEffectiveRule`), tidak pernah `now()`.
- **Uang itu eksak.** Kolom `numeric`, masing-masing dengan CHECK `<> 'NaN'`
  eksplisit (`numeric` menerima NaN dan NaN lolos `>= 0`); API membawa setiap rate dan jumlah sebagai
  STRING desimal (angka JSON adalah 400 — ia sudah melewati float); evaluasi adalah
  aritmetika `bigint` dan membulatkan sekali, pada mode dan skala aturan
  (`half_up`, `half_down`, `half_even`, `up`, `down`, `ceiling`, `floor`; skala 0
  sampai 6), lalu menjepit ke batas bawah dan atas opsional (yang dijamin database
  tidak memuat desimal lebih banyak dari skala).
- **Hasil terbatas.** Hasil kali dua input dalam-rentang belum tentu dalam-rentang
  (`999999999999.999999` x 1.000.000 unit adalah 10^18), sehingga
  `evaluateCommission` menolak hasil yang sudah dibulatkan sebesar 10^12 atau lebih
  (kapasitas bilangan bulat `numeric(18, 6)`) alih-alih memotongnya; diuji di
  batasnya (`999999.999999` x 1.000.000 lolos, `1000000` x 1.000.000 ditolak).
- **Evaluasi terbatas.** Aturan adalah rekaman tertutup, `percent` (persentase dari
  jumlah dasar, 0 sampai 100) atau `fixed` (jumlah per unit utuh, paling banyak
  1.000.000 unit): tidak ada ekspresi, skrip, callback, atau daftar tier yang bisa
  tak terbatas.
- **Publish dan retire berisiko tinggi**, dapat diberikan terpisah, mewajibkan
  `Idempotency-Key` (replay mengembalikan respons tersimpan; permintaan berbeda di
  bawah kunci yang sama adalah 409) dan diaudit pada `warning`. Tidak ada baris
  audit yang memuat rate, jumlah, atau nama aturan — hanya kunci, versi, dan jendela.
- **Setiap handler memberi otorisasi lewat `authorizeInTransaction`** (melalui
  `defineTenantRoute`), dan lima permission di-seed oleh `sql/183`; sebuah tes
  membuktikan tiap guard menggigit (memegang semua permission lain ditolak,
  memegang hanya itu berhasil).

## Buku besar akrual (Issue #951)

- **Satu akrual per (sumber, employment), tepat sekali.** Kunci unik `(tenant,
source_type, source_ref, source_line, employment, operation)` adalah otoritasnya
  (`sql/188`). Pengiriman ulang request kanonik yang sama mengembalikan ASLINYA
  (`replayed`), apa pun yang terjadi pada akrual atau aturan sejak itu (juga
  setelah void: akrual yang di-void tidak dihidupkan kembali); identitas yang sama
  dengan jumlah, tanggal, aturan, atau mata uang berbeda adalah `409
SOURCE_CONFLICT`. Dua pengiriman BERLOMBA menjadi satu baris (`ON CONFLICT DO
NOTHING`, yang kalah membaca ulang pemenangnya), dibuktikan dengan sepuluh paralel
  dan terbukti gagal tanpa klausa itu. Satu baris sumber boleh dibagi antar staf:
  `employment_id` ada di kunci.
- **Jumlah dihitung, tidak pernah diterima.** Versi published dari kunci aturan
  yang jendelanya memuat `occurredOn` (tanggal sipil penjualan, diturunkan
  pemanggil) dievaluasi dengan fungsi murni berbasis `bigint` dari #950 dan
  dibulatkan sekali; body tidak dapat menyatakan jumlah, versi aturan, status, atau
  stempel. Trigger insert memeriksa ulang bahwa aturan itu published, berlaku pada
  tanggal tersebut, dan sama dalam kunci, versi, tipe sumber, mata uang, kalkulasi,
  dan istilah snapshot, serta jumlah yang disimpan SAMA DENGAN evaluasi aturan atas
  input yang disimpan: database menghitung ulang (`awcms_hr_commission_expected_
amount`, `numeric` eksak, kembaran SQL dari evaluasi murni: mode pembulatan,
  skala, lantai, dan plafon) dan menolak ketidakcocokan, sehingga sesi yang
  melewati aplikasi tak dapat menulis komisi yang tidak dihasilkan aturan. Sebuah
  tes menjalankan kedua implementasi atas ketujuh mode dan batas setengah dan
  menuntut keduanya sepakat.
- **Usia event dibatasi.** `occurredAt` sebuah akrual paling lama 730 hari (dan tak
  lebih dari sehari ke depan), di port, lewat HTTP, dan di trigger: penjualan lebih
  tua dari dua tahun bukan pengiriman terlambat, dan usia tak terbatas akan
  membiarkan publish berlaku-surut menjangkau masa lalu sembarang jauh.
- **Memposting adalah aksi berisiko tinggi tersendiri.** `accruals.accrue` (aksi
  baru; bukan `create`, yang tidak berisiko tinggi, dan klasifikasinya per aksi)
  berisiko tinggi, sehingga pemeriksaan SoD saat-aksi dapat disusun atas siapa yang
  boleh memposting, menyetujui, dan membayar. Port sendiri tidak memeriksa apa pun:
  composition root yang melakukannya.
- **Aturan berlaku-surut (diputuskan di sini; `sql/187`).** Akrual memakai aturan
  yang berlaku pada tanggal event, sehingga mempublikasikan versi yang jendelanya
  DIMULAI DI MASA LALU mengubah aturan mana yang berlaku untuk event yang sudah
  terjadi tetapi belum diakrualkan (penjualan yang dilaporkan terlambat). Akrual
  yang sudah ada tidak tersentuh (ia mengutip aturannya lewat foreign key dan versi
  published tidak dapat diubah), justru itu sebabnya perubahan itu akan senyap.
  Maka: jendela yang dimulai sebelum HARI INI (tanggal UTC transaksi publish) hanya
  dapat dipublikasikan dengan `backdatedReason` (selain itu `409
RULE_BACKDATED_REASON_REQUIRED`); DATABASE menstempel `publish_backdated` dari
  jendelanya (klien tak dapat menyatakannya ke arah mana pun) dan menolak publish
  tanpa alasan walau aplikasi dilewati; alasan tetap di baris aturan dan baris audit
  hanya membawa `backdated: true`. Versi retired tidak lagi berlaku: penjualan yang
  tanggalnya jatuh di luar jendela published mana pun adalah `no_effective_rule`,
  dan tenant mempublikasikan penggantinya.
- **Induknya divalidasi di bawah kunci.** Aturan dan employment dibaca `FOR SHARE`
  (dan lagi oleh trigger insert): retire, terminasi, atau soft delete yang
  bersamaan antre di belakang akrual atau melihat hasilnya, sehingga akrual tak
  pernah ditulis terhadap aturan atau employment yang ditarik sesaat sebelumnya.
  Employment harus aktif dan bekerja pada tanggal event (hari masuk dan hari
  terminasi inklusif). Kedua kunci dibuktikan oleh tes yang menjadi merah bila
  kuncinya dihapus.
- **Mesinnya milik database.** Tepat lima sisi: `pending -> approved -> payable ->
paid`, dan `voided` dari `pending` atau `approved`. Tiap sisi menstempel aktor dan
  waktunya sendiri dan tak menyentuh stempel lain; fakta moneter dibandingkan byte
  demi byte oleh trigger; tak ada baris yang dihapus. Akrual yang di-void tak pernah
  dapat dibayar. `canTransition` yang murni dan trigger diuji satu terhadap yang
  lain pada setiap pasang status. **Pemisahan tugas**, di handler dan di trigger
  (`sodViolation` yang murni adalah kembarannya): penerima (login milik employment
  itu sendiri) tak dapat approve, release, atau pay akrualnya sendiri; pembuat
  akrual tak dapat menyetujuinya; penyetuju tak dapat membayarnya (`403
SEGREGATION_OF_DUTIES`, atau `APPROVE_OWN_ACCRUAL_FORBIDDEN` untuk penerima yang
  menyetujui). **Penerima adalah login yang di-snapshot saat akrual dibuat
  (`beneficiary_tenant_user_id`, distempel trigger, `sql/236`) DAN login employment
  saat ini** (Issue #1019): melepas lalu menautkan kembali login di sekitar
  persetujuan diri sendiri tidak memberi apa-apa. Bila tak ada login tertaut maupun
  snapshot, approve, release, dan pay ditolak (fail closed, `409
BENEFICIARY_LOGIN_UNRESOLVED`; `sql/237`). Void tidak dipisahkan. Sebuah tes menghapus guard trigger dan
  menunjukkan bypass-nya berhasil.
- **Log tak dapat menyimpang dari status.** `awcms_hr_commission_transitions`
  ditulis hanya oleh trigger milik akrual (insert langsung ditolak oleh
  `pg_trigger_depth()`), sekali saat lahir dan sekali per perubahan status, sehingga
  status akrual selalu transisi terakhirnya. `reconcileAccruals` membuktikannya
  (status terhadap transisi terakhir, kontinuitas rantai, dan saldo per-mata-uang-
  dan-status yang diturunkan dua arah) dan melaporkan akrual mana yang tak cocok
  bila baris diubah di luar peran aplikasi; sebuah tes mengubahnya sebagai superuser
  dan melihatnya gagal.
- **Audit dan masking.** Approve, release, void, dan pay berisiko tinggi (`pay`
  adalah aksi akses baru), dapat diberikan terpisah, berkunci-idempotensi, dan
  diaudit pada `warning`; akrual BARU diaudit pada `info`, replay tidak mengaudit
  apa pun. **Tidak ada baris audit yang membawa jumlah, basis, tarif, referensi
  sumber, atau referensi pembayaran** (penghasilan adalah data finansial tentang
  seseorang; baris buku besar menyimpan jumlahnya dan correlation id
  menghubungkannya ke baris audit). Alasan void adalah kode pendek dan referensi
  pembayaran adalah token buram: keduanya bukan teks bebas.
- **Tanpa data personal.** Akrual merujuk sebuah employment (id buram) dan empat
  stempel aktor; tabelnya tidak memuat kolom nama, identifier, kontak, rekening,
  foto, biometrik, atau perangkat (sebuah tes memindainya).
- **Port.** `_shared/ports/commission-accrual-port.ts` menetapkan bentuk tempat
  adapter melaporkan penjualan; modul ini tidak mengimpor apa pun dari commerce atau
  booking. Adapter, bukan buku besar, yang memverifikasi penjualan nyata, lunas, dan
  milik karyawan itu, dan menentukan apa yang layak dikomisikan. Otorisasi dan audit
  tetap pada composition root pemanggil (`POST /api/v1/hr-commission/accruals`
  adalah salah satunya).
- **Membalik akrual: `CommissionAccrualPort.void` (Issue #1109, kontrak port
  `commission_accrual` 1.1.0).** `void(tx, tenantId, actorTenantUserId, { source,
employmentId, reason, correlationId? })` berkunci identitas sumber YANG SAMA
  dengan `accrue`, jadi konsumen (yang pertama adalah adapter atribusi-penjualan
  commerce di repositori turunan) tidak pernah menyimpan id modul ini. Ia mencari
  akrual lewat unique key buku besar, menguncinya `FOR UPDATE`, lalu menjawab:
  - `voided` - akrual `pending` atau `approved` di-void. Lewat satu inti transisi
    yang dipakai route HTTP void, sehingga baris audit
    (`hr_commission.accrual.voided`, tanpa jumlah dan tanpa referensi sumber), event
    domain `awcms.hr.commission.voided`, dan baris log transisi append-only semuanya
    ditulis dalam transaksi PEMANGGIL dan ikut rollback bersamanya.
  - `already_voided` - replay; tidak ada yang ditulis, diaudit, atau diterbitkan,
    apa pun `reason` replay itu. Void yang berlomba diserialkan pada barisnya: satu
    `voided`.
  - `not_found` - tidak ada yang diakrualkan untuk sumber dan employment itu (juga
    tampilan akrual tenant lain: RLS).
  - `period_closed` - akrual `payable` atau `paid`; ditolak, tidak ada yang ditulis.
  - `actor_required` (aktor `null`: setiap edge mencap seseorang) dan
    `input_invalid` (sumber cacat, id employment bukan UUID, `reason` bukan kode).

  **Entri kompensasi.** Akrual tidak pernah diubah atau dihapus: fakta monetarinya
  tak dapat diubah oleh trigger dan tetap seperti saat diposting. Pembalikannya
  adalah edge status ke `voided` ditambah baris log transisi yang ditambahkan
  database (penambahan buku besar untuk reversal selama belum ada uang berpindah),
  sehingga `reconcileAccruals` menunjukkan jumlahnya keluar dari bucket aktif dan
  berada di `voided`, dan akrual yang di-void tak pernah dapat dibayar. Tidak
  diperlukan migrasi: baris NEGATIF (`operation = reversal`) baru diperlukan setelah
  uang dikomit, yaitu butir berikutnya.

  **Kebijakan periode tertutup (diputuskan di #1109): tolak, `period_closed`.** Modul
  ini tidak punya periode komisi sendiri; batasnya adalah status akrual. `payable`
  berarti dirilis ke payroll, yang run-nya memilih akrual payable (`FOR UPDATE SKIP
LOCKED`, PS-19), dan `paid` berarti pembayaran tercatat. Belum ada mekanisme
  reversal-ke-periode-berjalan (baris negatif hr-payroll.md 6.3), dan mem-void uang
  yang mungkin sudah dipegang payroll akan melanggar "akrual dibayar tepat oleh satu
  run". Maka port menolak dan tidak menulis apa pun; hasilnya membawa `accrualId` dan
  `status`, dan konsumen mengarahkannya ke manusia (penarikan kembali / netting run
  berikutnya), bukan ke retry buta. Ketika baris reversal hadir, `period_closed`
  adalah kasus yang digantikannya dengan reversal yang diposting; `voided`,
  `already_voided`, dan `not_found` tetap bermakna sama.

- **Celah yang diketahui: void mengonsumsi kunci sumber secara permanen.** Akrual
  yang di-void mempertahankan identitas `(sumber, employment)`-nya, sehingga
  pengiriman ulang sumber yang sama mengembalikan aslinya yang void (tak pernah
  akrual baru) dan komisi tak dapat diperoleh ulang untuk sumber itu. Sampai
  reversal dan jalur akrual-ulang ada (#962 dan fase reversal), mengoreksi akrual
  yang keliru di-void berarti referensi sumber baru yang dipilih adapter. Ini
  disengaja (void tak boleh dibatalkan diam-diam oleh pengiriman ulang) dan dicatat
  sebagai celah, bukan fitur.
- **PS-19 (sebuah akrual dibayar oleh tepat satu run payroll, termasuk setelah
  reversal) dirancang, belum dibangun.** `payable -> paid` terjadi sekali dan `paid`
  final; indeks parsial melayani pemilihan `FOR UPDATE SKIP LOCKED` atas akrual
  payable oleh run; dan reversal, saat mendarat, adalah baris BARU yang tak pernah
  membuka kembali aslinya, sehingga tak ada status yang memungkinkan satu akrual
  diklaim dua kali. Catatan klaimnya sendiri (id run; dilepas saat run dibatalkan)
  milik #962 karena pelepasan klaim bergantung pada keputusan pemulihan yang belum
  dibuat PS-02.

## Peta

| Berkas                                              | Isi                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `module.ts`                                         | Descriptor, permission, `dataLifecycle`, dan `subjectData`                     |
| `domain/hr-commission-accrual-state.ts`             | Mesin akrual murni, jendela berlaku-surut, dan aturan tanggal employment       |
| `domain/hr-commission-accrual-validation.ts`        | Validator request akrual, digest request kanonik                               |
| `application/hr-commission-accrual-ledger.ts`       | Accrue, list, get, transisi, rekonsiliasi (outcome, audit)                     |
| `application/hr-commission-accrual-port-adapter.ts` | `CommissionAccrualPort` yang konkret                                           |
| `src/pages/api/v1/hr-commission/accruals/**`        | 6 berkas route tipis (`/accruals`, `/{id}`, `.../approve\|release\|void\|pay`) |
| `domain/hr-commission-intake.ts`                    | Antrean intake, murni: mesin status, jadwal ulang, digest, penyelesaian        |
| `application/hr-commission-intake-store.ts`         | INSERT konsumen (`submit*Intent`), sakelar, daftar pengecualian                |
| `application/hr-commission-intake-poster.ts`        | Poster `awcms_app`: klaim, posting, selesaikan, ulang, racun, purge            |
| `application/hr-commission-intake-port-adapter.ts`  | `CommissionIntakePort` yang konkret                                            |
| `application/hr-commission-intake-job.ts`           | Isi job (tiap tenant aktif); `scripts/hr-commission-intents-post.ts`           |
| `src/pages/api/v1/hr-commission/intake/**`          | 2 berkas route tipis (`/intake/settings`, `/intake/exceptions`)                |
| `domain/hr-commission-decimal.ts`                   | Parsing, pembulatan, dan format desimal `bigint` yang eksak                    |
| `domain/hr-commission-evaluation.ts`                | `evaluateCommission` dan `selectEffectiveRule` yang MURNI                      |
| `domain/hr-commission-validation.ts`                | Validator request yang ketat (uang sebagai string)                             |
| `domain/hr-commission-permissions.ts`               | Guard, sebagai objek literal                                                   |
| `application/hr-commission-rule-directory.ts`       | List, get, create, edit draft, publish, retire (outcome, audit)                |
| `application/hr-commission-route-support.ts`        | Idempotency, parsing body, dan helper id yang dipakai bersama route            |
| `src/pages/api/v1/hr-commission/rules/**`           | 4 berkas route tipis (`/rules`, `/rules/{id}`, `.../publish`, `.../retire`)    |

## Item terbuka dan postur tercatat

- **Evaluasi tidak punya endpoint HTTP sendiri.** Endpoint akrual adalah
  pemakainya; endpoint dry-run tidak dibuka.
- **Helper desimal adalah salinan kecil** dari gagasan di `tax/domain/decimal.ts`,
  karena modul ini tidak mendeklarasikan dependensi ke `tax`. Mengangkat keduanya
  ke `_shared` adalah tindak lanjut.
- **`occurredOn` adalah tanggal.** Jendela adalah tanggal, bukan instan; pemanggil
  menurunkan tanggal event (dalam waktu sipil apa pun yang dipakai tenant-nya)
  sebelum memilih aturan. Tidak ada zona waktu yang diasumsikan di sini.
- **Disimpan tanpa batas waktu, tanpa periode yang diklaim.** Sengaja tidak ada
  descriptor `dataLifecycle` (ia harus mengklaim periode retensi): tabel dijawab
  oleh entri `BOUNDED_BY_DESIGN` di
  `scripts/data-lifecycle-table-coverage-check.ts`. Periode untuk syarat komersial
  yang dikutip akrual nanti adalah milik penasihat hukum tenant dan tidak ada
  pemiliknya di sini; arsip-lalu-purge untuk baris HR adalah tindak lanjut
  (hr-payroll.md bagian 15).
- **Reversal adalah langkah berikutnya buku besar.** Reversal akrual yang payable
  atau paid adalah baris negatif BARU (`operation = reversal`,
  `reverses_accrual_id`) di bawah identitas sumbernya sendiri, sekali per akrual,
  tak dapat di-reversal, tak pernah membuka kembali aslinya. Kunci unik, kolom
  `operation`, dan log transisi sudah punya ruangnya; sebuah `sql/NNN` yang
  melebarkan CHECK `operation` dan status serta mesinnya akan menambahkannya.
- **Event: hanya `voided` yang ada.** `awcms.hr.commission.voided` (Issue #1109;
  registry, channel AsyncAPI, dan `events.publishes`) diterbitkan dalam transaksi
  setiap void, HTTP maupun port, dengan id, TIPE sumber, kunci dan versi aturan,
  `fromStatus`, dan kode alasan (tidak pernah jumlah atau referensi sumber).
  `awcms.hr.commission.accrued` dan `.approved` (hr-payroll.md bagian 10) belum
  dipancarkan: tak ada yang diterbitkan sampai ada konsumen.
- **Belum ada baca-akrual-sendiri dan scope office.** `accruals.read` adalah
  permission biasa: jalur "karyawan melihat akrualnya sendiri" (ownership grant pada
  login employment) dan business scope `office` adalah tindak lanjut bersama
  permukaan swalayan.
- **Riwayat akrual seseorang diekspor kepada orang itu** (Issue #1018,
  ADR-0142): `hr_commission.accruals` menjangkau penerima lewat `employment_id`
  (`subjectVia`) dan `exportable: true`; stempel aktor bukan kolom subjek. Karena
  penghasilan berada di batas penggajian, rute ekspor subjek **tidak** menyerahkannya
  hanya dengan `data_lifecycle.subject_request.export`: pemanggil juga harus memegang
  `hr_commission.accruals.read`, jika tidak tabelnya ditahan dan disebut di
  `withheld` pada respons (default-deny, juga untuk replay ekspor tersimpan). Setiap
  pembacaan yang terjadi dicatat sebagai sensitive read (id dan jumlah, tak pernah
  nominal). `hr_commission.transitions` tetap `exportable: false`: ia butuh lompatan
  kedua dan tidak menambah apa pun tentang penerima yang belum dibawa akrual. Apakah
  penghasilan boleh diekspor kepada subjek adalah keputusan produk/hukum yang tercatat
  di adendum ADR-0142.
  Join memakai `profile_id` SAJA (login yang salah tertaut ke employment orang lain
  lalu dikoreksi akan memasukkan akrual employment itu ke ekspor login tersebut).
  Catatan `Idempotency-Key` yang tersimpan hanya menyimpan id baris ini dan replay
  membacanya ulang di bawah pemeriksaan `accruals.read` yang baru. Snapshot
  `beneficiary_tenant_user_id` (`sql/236`) adalah kolom yang disamarkan pada ekspor
  dan tidak ada di respons API mana pun: komentar header `sql/236` yang menyatakan
  "tidak diekspos API apa pun" benar hanya karena penyamaran itu, dan migrasi yang
  sudah diterapkan tidak dapat disunting untuk menyatakannya.
- **Retensi: disimpan selama hidup tenant, tanpa periode yang diklaim.** Sengaja
  TIDAK ada descriptor `dataLifecycle` untuk aturan, akrual, dan transisi (descriptor harus
  mengklaim periode dan mode purge, dan tak ada yang mem-purge): tabel buku besar
  dijawab oleh entri `BOUNDED_BY_DESIGN` di
  `scripts/data-lifecycle-table-coverage-check.ts`. Periodenya milik penasihat
  hukum pemberi kerja; arsip-lalu-purge akrual PAID dan VOIDED adalah tindak lanjut
  (hr-payroll.md bagian 15).
- **Descriptor subjek hanya stempel aktor** dan `exportable: false`: sebuah aturan
  tidak menamai subjek data.

## Konsumen tanpa orang yang sedang masuk: antrean intake (ADR-0147, Issue #1189)

Consumer domain-event (misalnya attributor `order.paid` commerce di awcms-one)
berjalan di `domain-events:dispatch` sebagai `awcms_worker`, dan batas payroll
melarang role itu memegang hak apa pun atas `awcms_hr_commission_accruals` dan
`awcms_hr_commission_transitions`. Jadi ia tidak dapat memanggil
`CommissionAccrualPort`.
[ADR-0147](../../../docs/adr/0147-event-driven-commission-accrual-enters-through-an-intake-queue-posted-by-an-app-role-job.id.md)
memutuskan jalur yang disahkan dan Issue #1189 membangunnya: **konsumen tidak
memposting, ia menyerahkan; job yang berjalan sebagai `awcms_app` yang memposting.**

```text
konsumen (awcms_worker)                       hr-commission:intents:post (awcms_app)
  port.submitAccrual / submitVoid               klaim  (FOR UPDATE SKIP LOCKED + lease)
  satu INSERT ... ON CONFLICT DO NOTHING   ->   posting (accrueCommission / voidCommissionBySource,
  ke awcms_hr_commission_intents                         aktor tersimpan, satu tx tenant per baris)
  queued | duplicate | input_invalid |          selesaikan (posted | refused | coba lagi -> failed)
  actor_required | disabled                      purge  (baris selesai lewat 30 hari)
```

- **Tabelnya** `awcms_hr_commission_intents` (`sql/316`) menyimpan satu baris per
  permintaan yang diserahkan, tercakup tenant dengan RLS `FORCE`. Sengaja **bukan**
  nama keluarga payroll (ia ada di `PAYROLL_OWNED_NON_PAYROLL_TABLES`, yang bukan
  pengecualian katalog: `PAYROLL_CATALOG_EXEMPTIONS`, `PAYROLL_ALLOWED_GRANTEES`, dan
  `PAYROLL_WORKER_EXECUTE_ALLOWLIST` yang kosong tidak berubah).
- **Yang dapat dilakukan worker:** `INSERT` pada tabel itu dan tidak ada yang lain
  (tanpa `SELECT`, `UPDATE`, atau `DELETE`, sehingga ia tidak dapat membaca balik
  apa yang diserahkannya), dan tidak ada hak atas objek keluarga payroll mana pun.
  Ia juga membaca sakelar satu-boolean `awcms_hr_commission_intake_settings`. Insert
  adalah `ON CONFLICT DO NOTHING` polos tanpa arbiter dan tanpa `RETURNING`, sebab
  itu `INSERT` saja cukup. `WORKER_ROLE_GRANTS` di `scripts/security-readiness.ts`
  mendaftarkan persis itu.
- **Tepat sekali.** Kunci uniknya `(tenant_id, kind, source_type, source_ref,
source_line, employment_id, request_digest)`, digest-nya adalah digest buku besar
  sendiri untuk akrual: pengiriman ulang permintaan yang **sama** adalah
  `duplicate`; identitas yang sama dengan permintaan **berbeda** adalah baris kedua
  dan muncul saat posting sebagai `source_conflict` milik buku besar di daftar
  pengecualian. Selebihnya, kunci unik buku besar membuat percobaan ulang setelah
  crash menjadi `replayed`, yaitu `posted`. Tulisan buku besar dan penyelesaian baris
  intake di-commit dalam **satu** transaksi.
- **Otorisasi adalah registrasi ditambah sakelar, bukan sesi.** Konsumen adalah
  kode yang ditinjau dan dideklarasikan di descriptor modul (`capabilities.consumes:
["commission_intake"]`), dan tenant harus menyalakan intake:
  `PUT /api/v1/hr-commission/intake/settings` dengan `hr_commission.intake.configure`
  (berisiko tinggi, dapat diberikan terpisah, ber-Idempotency-Key, diaudit pada
  `warning`). Bawaannya **mati**: port menjawab `disabled`, trigger basis data menolak
  insert mentah, dan poster tidak mengklaim apa pun. `void` memerlukan orang
  (`actor_required`); `accrue` boleh tanpa.
- **Poster** (`application/hr-commission-intake-poster.ts`, job
  `hr-commission:intents:post`, tiap menit) adalah **satu-satunya job terjadwal yang
  memegang `DATABASE_URL`** (`ops/run-job.sh` menurunkannya dari closure impornya,
  Issue #1132). Penolakan bisnis (`no_effective_rule`, `source_conflict`,
  `period_closed`, ...) bersifat final dan tidak diulang; error sementara diulang
  dengan back-off (30 dtk berlipat hingga sejam) dan berakhir `failed` setelah 8
  percobaan; baris yang setiap klaimnya mati di tengah jalan juga di-fail-kan. Void
  yang tiba sebelum akrual yang dibalikkannya menunggu akrual itu. `period_closed`
  diarahkan ke manusia, tidak pernah di-void diam-diam.
- **Audit, event, dan log.** Akrual baru diaudit oleh `auditAccrued` yang sama
  dengan yang dipanggil route HTTP dan void menumpang inti transisi buku besar,
  sehingga baris audit, event `awcms.hr.commission.voided`, dan log transisi adalah
  milik jalur sinkron. Penolakan menulis `hr_commission.intake.refused` dan kegagalan
  `hr_commission.intake.failed`, keduanya pada `warning`, hanya berisi id dan kode.
  Tidak ada nominal, referensi sumber, atau pesan driver yang masuk baris audit atau
  log (error dicatat sebagai kelas dan SQLSTATE-nya).
- **Keterlihatan tanpa jalur baca untuk worker.** `GET /api/v1/hr-commission/intake/
exceptions` (`hr_commission.intake.read`, yang tidak membuka akrual apa pun)
  mendaftar permintaan yang ditolak dan gagal dengan kode hasil dan id yang
  **disamarkan**, ditambah diagnostik poster (hitungan per status, umur baris hidup
  tertua). Belum ada layar admin (permission-nya ada di `NOT_YET_SCREENED`).
- **Retensi.** Baris selesai di-purge poster setelah 30 hari secara bawaan (batas
  bawah 7, atas 90, bentuk `delegated` data-lifecycle dengan `updated_at` sebagai
  kursor; menunggu konfirmasi pemilik). Baris `pending` dan `posting` adalah
  pekerjaan dan basis data menolak menghapusnya. Snapshot dry-run mesin lifecycle
  membaca antrean lewat `awcms_hr_commission_lifecycle_eligible_count` (fungsi
  `SECURITY DEFINER` hanya-hitung, pola `sql/303`), karena worker tidak boleh
  membaca tabelnya.
- **Klaim worker tentang siapa yang bertindak tidak dipercaya** (audit keamanan
  Issue #1189). Worker menyerahkan `claimed_by_tenant_user_id`, tetapi poster
  mencap buku besar (`created_by`, `voided_by`) dan setiap baris audit dengan
  **aktor sistem intake** tenant (`intake_actor_tenant_user_id` di baris
  settings, pengguna tenant aktif yang dinamai saat sakelar dinyalakan, wajib
  selama menyala dan ditegakkan CHECK). Klaim itu hanya bertahan sebagai
  `claimedBy` di atribut audit. **Void hanya diposting untuk akrual yang dibuat
  intake ini** (baris `accrue` intake yang selesai `accrued`; yang hanya
  `replayed` atas akrual manual bukan asal), sehingga worker yang dikompromikan
  tidak dapat mem-void akrual buatan manual dengan menyebut sumbernya: tanpa asal,
  void menunggu lalu ditolak sebagai `no_intake_origin`. Akrual intake berstatus
  `pending` atau `approved` dapat di-void persis seperti dipetakan port dan
  ADR-0147 bagian 3; yang `payable` atau `paid` adalah `period_closed`. Setelah
  baris `accrued` asalnya di-purge retensi, void yang terlambat ditolak
  (`no_intake_origin`).
- **Berapa lama void dapat tiba (batas eksplisit).** Asal sebuah void adalah baris
  `accrue` intake yang selesai `accrued`, sehingga baris itu disimpan hingga batas
  atas 90 hari (seperti baris `refused` dan `failed`); baris posted lain (void,
  replay) disimpan 30 hari. Void yang tiba **lebih dari 90 hari** setelah akrual
  diposting ditolak sebagai `no_intake_origin`, muncul di daftar pengecualian, dan
  perlu manusia. Selama accrue yang cocok masih hidup di antrean (`pending` atau
  `posting`, misalnya macet karena poster mati), void terus menunggu melewati
  toleransi 24 jam, sehingga accrue yang macet tidak dapat kemudian memposting
  komisi untuk penjualan yang sudah di-void. Penanda "dibuat lewat intake" di sisi
  buku besar pada akrual adalah tindak lanjut bila jendela lebih panjang
  diperlukan.
- **Aktor sistem divalidasi ulang tiap tick.** Bila aktor sistem intake tenant
  berhenti menjadi pengguna aktif, poster tidak mengklaim apa pun untuk tenant itu
  (peringatan dicatat), `GET /intake/settings` melaporkan `intakeActorStatus:
actor_inactive`, dan antrean mengalir lagi setelah aktor aktif atau diganti.
- **Pengiriman tak berurutan.** Void yang akrualnya belum diposting ditunda tiap 15
  menit selama 24 jam tanpa menghabiskan jatah percobaannya (trigger penjaga
  membolehkan penundaan mengembalikan klaimnya), lalu ditolak.
- **Audit dan retensi.** Setiap permintaan yang diposting atau ditolak menulis
  baris `hr_commission.intake.posted` / `.refused` berisi jenis, kode hasil,
  `claimedBy`, dan **sidik jari** 12-heks dari referensi sumber (bukan
  referensinya). Baris `posted` di-purge setelah 30 hari, baris `refused` dan
  `failed` setelah 90, dan kedua jendela dijepit ke batas bawah 7 dan atas 90 yang
  dideklarasikan saat berjalan. Worker membaca tabel settings hanya per **kolom**
  (`tenant_id`, `commission_intake_enabled`).
- **Ditunda (issue tindak lanjut):** batas baris hidup per tenant, klaim yang adil,
  dan melewati tenant yang menganggur (banjir intake oleh worker yang
  dikompromikan hanya dibatasi sakelar, persetujuan manusia atas setiap akrual,
  dan daftar pengecualian).
- **Konsistensi akhirnya.** Akrual muncul setelah tick poster berikutnya; penolakan
  bisnis ditemukan di daftar pengecualian, bukan oleh konsumen.
- **Rollback** hanya maju: matikan `commission_intake_enabled` (port menjawab
  `disabled`), hentikan job, biarkan tabel tidak aktif.

Adapter hilir (`ahliweb/awcms-one#391`) bukan bagian repositori ini: ia memanggil
`commission_intake` setelah ini di-merge dan subtree disinkronkan.

## Keterbatasan

- Hanya layar komisi milik karyawan yang ada (Issue #952); layar aturan dan layar akrual (daftar, approve / release / void / pay) adalah tindak lanjut.
- Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill` untuk
  menerima permission yang di-seed (keterbatasan yang dibawa setiap seed permission).
- Draft hanya dapat diubah dengan mengganti seluruh field yang dapat diedit (`PUT`);
  tidak ada edit parsial dan tidak ada helper "salin dari versi sebelumnya".
- `btree_gist` tidak dipakai: tumpang-tindih adalah trigger, bukan exclusion constraint.
