🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:199d6d7be6e4fe69806b035b3eda7d1cb037090cc3ab57e613624b8c0f297f90 -->

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
(akrual negatif kompensasi untuk akrual yang payable atau paid), event
`awcms.hr.commission.*`, dan klaim payroll atas sebuah akrual (PS-19, di bawah).
Ini **bukan komisi afiliasi** (hr-payroll.md 6.4: penerimanya di sini selalu sebuah
employment) dan **tidak membawa aturan negara atau yurisdiksi mana pun**: tenant
menyusun aturannya sendiri.

Status `experimental`: flag mati, belum ada layar admin, dan modul tidak
mendeklarasikan `navigation`. Ia menjadi `active` bersama layar pertamanya.

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
- **Event masih provisional.** `awcms.hr.commission.accrued` dan `.approved`
  (hr-payroll.md bagian 10) belum dipancarkan: buku besar tidak menulis baris outbox
  dan tidak ada channel AsyncAPI, jadi tak ada yang diterbitkan sampai ada konsumen.
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
  TIDAK ada descriptor `dataLifecycle` untuk ketiga tabel (descriptor harus
  mengklaim periode dan mode purge, dan tak ada yang mem-purge): tabel buku besar
  dijawab oleh entri `BOUNDED_BY_DESIGN` di
  `scripts/data-lifecycle-table-coverage-check.ts`. Periodenya milik penasihat
  hukum pemberi kerja; arsip-lalu-purge akrual PAID dan VOIDED adalah tindak lanjut
  (hr-payroll.md bagian 15).
- **Descriptor subjek hanya stempel aktor** dan `exportable: false`: sebuah aturan
  tidak menamai subjek data.

## Keterbatasan

- Tanpa layar admin; `experimental`. Layar akrual (daftar, approve / release / void / pay) adalah tindak lanjut yang membuat modul `active`.
- Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill` untuk
  menerima permission yang di-seed (keterbatasan yang dibawa setiap seed permission).
- Draft hanya dapat diubah dengan mengganti seluruh field yang dapat diedit (`PUT`);
  tidak ada edit parsial dan tidak ada helper "salin dari versi sebelumnya".
- `btree_gist` tidak dipakai: tumpang-tindih adalah trigger, bukan exclusion constraint.
