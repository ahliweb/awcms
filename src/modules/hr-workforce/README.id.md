🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:23defb7d5764a0631d3ac795ab2a774b68c0f8ae6e3da67a4c249d712dde35d7 -->

# `hr_workforce`

**Konteks ketenagakerjaan** (Issue #945,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.id.md), fase 1
keluarga `hr_*`). Paket desainnya adalah
[`docs/awcms/hr-payroll.id.md`](../../../docs/awcms/hr-payroll.id.md) bagian 2.1, 3,
dan 4.1; berkas ini adalah peta kodenya.

## Apa yang ada, dan apa yang belum

Ini adalah **fondasi** (employment, terms berlaku-efektif, settings, dan
karyawan-melihat-miliknya), **shift dan port ketersediaan staf** (Issue #946), dan
**event kehadiran serta koreksi dengan persetujuan** (Issue #947).
**Belum ada:** komisi dan payroll (issue berikutnya di bawah ADR yang sama) —
dan **tidak akan pernah** ada field foto, biometrik, atau sidik-jari perangkat
(keputusan pemilik O6). **Bukti geolokasi** (ADR-0138, Issue #970, `sql/306`) BUKAN bagian dari
kehadiran dan **mati untuk setiap tenant** sampai seseorang yang memegang
`hr_workforce.geolocation_evidence.configure` (tidak diberikan ke siapa pun secara
bawaan, termasuk owner tenant) mengaktifkannya dengan rujukan DPIA, pemberitahuan
terbit, dan geofence. Clock-in/out `self` lalu boleh membawa satu `positionSample`
(`latitude`, `longitude`, `accuracyMeters`); server mengevaluasinya di dalam request
terhadap geofence kantor dan **membuangnya**. Yang disimpan hanya putusan (`inside`,
`outside`, `not_provided`), pita jarak kasar, pita akurasi kasar, geofence, versi
aturan, dan waktu database, di `awcms_hr_attendance_location_evidence` terpisah yang
hanya-tambah (30 / 90 / 180 hari, hapus keras, tanpa arsip, legal hold menimpa)
dan dikunci pada event, sehingga tidak pernah ada kolom lokasi di
`awcms_hr_attendance_events`. Tidak ada koordinat, akurasi mentah, alamat, atau
nilai perangkat atau jaringan yang disimpan, di-log, diaudit, diantrekan, atau
diekspor. Route: `/api/v1/hr-workforce/geolocation/{settings,geofences,notices,notice,notice-acknowledgements,evidence}`.
Menolak, tidak ada fix, fix lebih buruk dari batas akurasi, dan pemberitahuan yang
belum diakui semuanya mencatat event clock seperti biasa dengan `not_provided`;
putusan adalah indikator pendukung untuk ditinjau manusia dan tidak memutuskan apa
pun sendiri. **Posisi yang dilaporkan klien dapat dipalsukan: putusan adalah
indikator pendukung, bukan bukti.** `attendance_evidence.read` berlaku seluruh
tenant dan khusus HR: belum ada scope atasan atau baca rantai atasan, sehingga
atasan tidak membaca apa pun kecuali HR menugaskan permission itu (lalu membaca
putusan semua pegawai). Geofence adalah lingkaran 50 m-5 km atau poligon sederhana
(minimal 2.500 m2, maksimal 10 km), paling banyak 10 hidup per kantor, dan yang
hidup terakhir tidak bisa dihapus selama saklar menyala. Mengaktifkan di tenant
mana pun menunggu persetujuan penasihat hukum soal penghapusan (ADR-0138). Penghapusan mengikuti retensi (ADR-0094 + ADR-0142); lihat "Status
implementasi" ADR-0138 untuk pertanyaan hukum yang masih terbuka.

Status `active` sejak Issue #952: modul mendeklarasikan empat layar admin
(`/admin/hr/my-work` dan `/admin/hr/my-metrics` untuk karyawan, `/admin/hr/team`
untuk supervisor, dan `/admin/hr/workforce` untuk HR; `docs/awcms/workforce-self-service.md`).
Layar tulis kepegawaian, layar pengaturan, dan editor roster masih hanya lewat API.

## Aturan yang membuatnya aman

- **Referensi, bukan salinan.** `awcms_hr_employments.profile_id` adalah foreign
  key komposit `(tenant_id, profile_id)` ke `awcms_profiles`. Tidak ada kolom nama,
  kontak, tanggal lahir, NIK, atau NPWP di tabel HR mana pun; tampilan membaca
  `profile_identity`. Sebuah tes memastikan kolom seperti itu tidak muncul.
- **Satu employment aktif per profil dan per login**, lewat partial unique index
  (`sql/176`), bukan kode handler. Rehire adalah employment baru setelah yang
  pertama diakhiri.
- **Terms hanya-tambah dan berlaku-efektif.** Perubahan menutup baris terbuka dan
  menyisipkan yang berikutnya; terms tidak pernah tumpang tindih; `terminated`
  bersifat terminal dan menandai header; rantai atasan tidak siklik dan paling
  dalam sepuluh sisi, dihitung termasuk bawahan di bawah seorang karyawan (satu
  fungsi SQL yang dipakai trigger dan pra-cek handler). Penulisan sisi atasan
  mengambil satu advisory lock per tenant, sehingga dua sisi bersamaan yang
  menutup siklik tidak bisa sama-sama commit. Masing-masing adalah trigger, sehingga sesi yang melewati
  aplikasi tidak bisa merusaknya.
- **Merge profil** antara dua profil yang sama-sama berstatus bekerja aktif
  ditolak oleh trigger pada `awcms_profiles` (ADR-0132 bagian 2).
- **Karyawan melihat miliknya** adalah `ownershipGrant` (ADR-0063) pada
  `tenant_user_id` yang tersimpan, dilewatkan lewat opsi `ownershipGrant` baru di
  `defineTenantRoute`. Ia hanya MELEBARKAN `employments.read`; ABAC deny, scope,
  dan SoD tetap berlaku, kredensial mesin tidak pernah membawanya, dan id yang
  tidak ada serta baris milik orang lain adalah 403 yang sama. Penautannya sendiri
  adalah `employments.assign`: berisiko tinggi, diaudit, dan terikat pada profil
  karyawannya sendiri (lihat "Postur fase 1 yang diketahui").
- **Aksi berisiko tinggi** (`create`, perubahan terms, `assign`, `delete`,
  `restore`, `configure`) mewajibkan `Idempotency-Key` dan diaudit tanpa nama,
  jabatan, nomor, atau alasan; satu-satunya pengenal yang dibawanya adalah UUID
  login pada baris `assign`.

## Shift dan port ketersediaan staf (Issue #946, `sql/184`-`sql/185`)

`awcms_hr_shift_templates` adalah **pola** (jam mulai lokal, durasi TERLEWAT, satu
istirahat opsional, zona IANA). `awcms_hr_shift_assignments` adalah interval UTC
setengah-terbuka `[starts_at, ends_at)` yang konkret per employment, `work` atau
`time_off`, `draft` -> `published` -> `cancelled`. Menaruh template pada tanggal
lokal menyelesaikan jam dinding ke UTC **sekali**, di aplikasi
(`domain/hr-shift-time.ts`), dan menyimpan instan beserta zona tempat ia
diselesaikan, sehingga mengubah template kemudian tidak pernah menggeser
penugasan. Pada celah daylight-saving dipakai offset sebelum perubahan (02:30
yang tidak ada menjadi 03:30), pada tumpang tindih kemunculan lebih awal yang
menang, dan shift yang melintasi perubahan mempertahankan panjang terlewat yang
sebenarnya (tes tabel, termasuk Europe/Berlin, America/New_York, dan zona
setengah-jam).

- **Tanpa tumpang tindih per employment**, lintas kind, di antara baris non-batal.
  Trigger mengambil advisory lock per-(tenant, employment) SEBELUM melihat, sehingga
  dua penulis serentak berserial dan yang kedua ditolak (`23P01`); handler
  mengambil lock yang sama dan memeriksa lebih dulu, menjawab `409 SHIFT_CONFLICT`
  dengan id penugasan lain di `error.details`. Tanpa constraint eksklusi
  `btree_gist`: ia butuh `CREATE EXTENSION` berhak-istimewa yang tak diminta migrasi
  mana pun di sini (`sql/171` mencatat keputusan yang sama).
- **Status hanya maju**; baris terbit atau batal tak dapat diubah (trigger), dan
  tidak ada yang pernah dihapus (DELETE ditolak + trigger). Tidak ada
  `shifts.update`: draft dibatalkan lalu dibuat ulang, shift terbit dibatalkan,
  tidak pernah disunting.
- **Tanpa alasan, catatan, atau teks bebas di mana pun.** Time off membawa
  `timeOffKind` kasar (`leave`, `holiday`, `other`); cuti sakit adalah data
  kesehatan. Sebuah tes menegaskan tidak ada kolom semacam itu.
- **Publish dan cancel berisiko tinggi** (`Idempotency-Key`, diaudit dengan id dan
  kind saja). Karyawan membaca jadwal TERBIT miliknya lewat `ownershipGrant` pada
  `GET /shift-assignments?mine=true`; draft butuh `shifts.read`.
- **`StaffAvailabilityPort`** (`_shared/ports/staff-availability-port.ts`, tidak
  mengimpor apa pun; adapter `application/staff-availability-adapter.ts`; kontrak
  `docs/awcms/cross-domain-contracts.id.md` bagian 4). Ia mengembalikan, per
  referensi staf opak (id employment), `resolved` atau `unknown` plus interval
  kerja: kerja terbit, dikurangi istirahat tiap penugasan, dikurangi time off,
  dipotong ke jendela, interval bersebelahan digabung
  (`domain/availability-intervals.ts`, murni). Tiga field per orang; tanpa nama,
  kantor, kode, kind, atau grade. Ia pembacaan dalam transaksi tenant pemanggil
  (FORCE RLS berlaku, dan tenant juga ada di setiap predikat), tidak
  mengotorisasi, tidak mengaudit, dan tidak menulis; composition root KONSUMEN
  mengotorisasi permission miliknya lebih dulu. `unknown` = tak ditemukan, tenant
  lain, soft-delete, atau tak ada term `active` yang menyentuh jendela, sengaja
  tak dapat dibedakan. Shift kerja dihitung hanya bila term `active` pada
  tanggal mulai LOKAL-nya. Tes teks-sumber gagal bila adapter pernah menyebut
  tabel kompensasi, payroll, komisi, atau payout. Tidak ada kode Booking yang
  diimpor di mana pun; Booking (issue berikutnya) akan memakai tipe port.

## Kehadiran dan koreksi (Issue #947, `sql/198`-`sql/199`)

`awcms_hr_attendance_events` adalah satu fakta per baris: sebuah employment
clock-in, clock-out, memulai atau mengakhiri istirahat, pada instan yang
**diklaim** (`occurred_at`), **dicatat** oleh database pada instannya sendiri
(`recorded_at`), dari sebuah `source` (`self`, `supervisor`, `kiosk`, `import`,
atau `correction`). `awcms_hr_attendance_corrections` adalah **perubahan yang
diusulkan** (`add` event yang hilang, atau `replace` satu event) dengan alasan wajib
dan satu instance `workflow_approval`. Catatan efektifnya adalah "event yang belum
digantikan".

- **Hanya-tambah, di database.** `awcms_app` hanya memegang `SELECT` dan `INSERT`
  pada event (terdaftar di `RETIRED_TENANT_TABLE_PRIVILEGES`), dan trigger menolak
  `UPDATE` dan `DELETE` untuk peran lain juga. Baris koreksi hanya mengubah
  **status**-nya; usulan, alasan, pemohon, dan instance-nya tidak dapat diubah.
- **Jam server.** Trigger menimpa `recorded_at` dengan `clock_timestamp()`; klien
  tidak dapat memasoknya (juga bukan `late`: keduanya kunci tak dikenal dan
  ditolak). Waktu yang diklaim dibatasi `clock_skew_seconds` tenant
  (`awcms_hr_workforce_settings`, bawaan 300): **di masa depan** melebihinya ditolak
  untuk setiap sumber (`422 ATTENDANCE_TIME_IN_FUTURE`).
- **Mundur-waktu, didamaikan.** Paket desain berkata event offline diterima dan
  ditandai `late`; issue berkata event mundur-waktu melebihi skew ditolak. Keduanya
  berlaku, menurut sumber: event **`self`/`supervisor`** mengklaim "sekarang", jadi
  waktu klaim yang lebih tua dari skew ditolak (`ATTENDANCE_BACKDATED`: ajukan
  koreksi); event **`kiosk`/`import`** adalah antrean offline yang diputar ulang,
  jadi waktu usang diterima hingga **7 hari** (lebih tua: `ATTENDANCE_TOO_OLD`) dan
  ditandai `late` lewat 15 menit. 7 hari dan 15 menit adalah konstanta di guard;
  menjadikannya setelan tenant adalah tindak lanjut tercatat.
- **Putar ulang.** `(tenant_id, employment_id, client_event_key)` unik. Putar ulang
  mengembalikan **aslinya** (`200`, bukan `201`); event berbeda di bawah kunci yang
  sudah dipakai adalah `409 CLIENT_EVENT_KEY_CONFLICT`. Post serentak satu kunci
  tercatat sekali (`ON CONFLICT DO NOTHING` plus pembacaan pemenang).
- **Siapa mencatat untuk siapa.** `source: self` butuh `hr_workforce.clock.create`
  DAN employment yang tertaut ke login pemanggil (selain itu `403`, ada atau tidak:
  S3). Ia permission dan bukan `ownershipGrant` karena grant hanya boleh melebarkan
  pembacaan. `supervisor`/`kiosk`/`import` butuh `hr_workforce.attendance.create`
  dan tidak pernah boleh memakai `self`. `attendance.create` adalah kuasa
  **tepercaya** (`import` dapat mengklaim waktu hingga 7 hari lalu, ditandai `late`,
  tanpa persetujuan): tidak diberikan ke peran mana pun secara bawaan, dan
  pembatasan per kantor menunggu adapter scope.
- **Koreksi tidak pernah menyunting aslinya.** Persetujuan menambahkan event BARU
  (`source = correction`, `supersedes_event_id`, `correction_id`); database menolak
  event bersumber-koreksi kecuali koreksinya `approved` dan event cocok persis pada
  kind, instan, employment, dan target, sekali saja. Sebuah event digantikan paling
  banyak sekali (indeks unik), dan hanya oleh koreksi; satu koreksi **pending** per
  event target (indeks unik).
- **Persetujuan wajib dan fail-closed.** Dengan modul `workflow` mati atau tanpa
  definisi terbit di bawah `correction_workflow_key` (bawaan
  `hr.attendance_correction`): `409 APPROVAL_WORKFLOW_NOT_CONFIGURED` dan tidak ada
  yang dibuat (tanpa baris, tanpa instance). Instance dimulai **tanpa fakta**,
  sehingga alasan maupun waktu usulan tidak masuk ke penyimpanan workflow.
  **Instan usulan yang tak pernah dapat diterapkan ditolak di muka.** Persetujuan
  menambahkan sebuah event, dan guard event menolak waktu klaim yang melampaui skew
  tenant ke masa depan, sehingga koreksi dengan usulan seperti itu akan disetujui
  lalu tertahan `pending` selamanya (`409 CORRECTION_NOT_APPLICABLE` saat settle).
  Karena itu pembuatan koreksi menerapkan batas yang sama pada `proposedOccurredAt`:
  lebih jauh dari `clock_skew_seconds` ke depan adalah `422 ATTENDANCE_TIME_IN_FUTURE`
  (kode jalur event) dan tidak ada yang dibuat. Tanggal masuk dan terminasi employment
  tidak diperiksa: guard event tidak memeriksa tanggal mulai maupun, untuk event
  bersumber-`correction`, terminasi (employment yang sudah terminasi tetap dapat
  dikoreksi), jadi di sini pun tidak. `CORRECTION_NOT_APPLICABLE` tetap ada untuk yang
  bisa berubah antara permintaan dan persetujuan: employment di-soft-delete di
  antaranya, atau tenant menurunkan skew di bawah usulan. Penyetuju
  adalah assignee definisi; keputusannya sendiri adalah keputusan workflow
  (`POST /workflows/tasks/{id}/decisions`).
- **Penyelesaian berjalan otomatis; `settle` adalah jalur manual cadangan (#998).**
  Putusan diterapkan oleh `settleCorrection`: approved -> status pindah ke `approved`
  **dan** event pengganti ditambahkan dalam satu savepoint; rejected -> `rejected`;
  dibatalkan -> `withdrawn`. Sebuah consumer domain-event,
  `hr_workforce.attendance_correction_settler` (ADR-0134, dideklarasikan di
  `module.ts`), memanggilnya begitu `workflow_approval` menerbitkan
  `awcms.workflow.instance.approved` / `.rejected` / `.cancelled` (satu event per
  instance yang selesai, di setiap jalur: keputusan, force-decision, pembatalan
  administrator, timeout eskalasi), sehingga tak ada yang perlu mengingat dan tak
  perlu `corrections.approve` agar hal itu terjadi. Ia berjalan di dispatcher
  (`bun run domain-events:dispatch`) sebagai `awcms_worker` dengan grant sempit
  `sql/280`, jadi **tenant harus menjalankan dispatcher** agar penyelesaian
  mengikuti keputusan (tanpanya koreksi menunggu, persis seperti sebelumnya).
  Consumer **tidak punya pengguna yang bertindak**: baris audit tanpa aktor dan
  membawa `trigger = workflow_event`; `decided_by` adalah manusia yang menyetujui
  atau menolak (NULL untuk penolakan/pembatalan yang tak diputuskan siapa pun: ia menyebut siapa yang memutuskan, bukan yang menyelesaikan, `sql/281`; penyelesai ada di baris audit); event pengganti tanpa `recorded_by`. **Penolakan bukan error dan
  tidak diulang**: persetujuan tanpa penyetuju manusia, yang diikuti pemohon atau
  pegawai, target yang sudah diganti, atau event yang ditolak guard membiarkan koreksi
  `pending`, menulis satu baris audit `warning`
  (`hr_workforce.attendance_correction.auto_settle_skipped`, hanya hasilnya, tak
  pernah alasan) dan menunggu seseorang. Instance yang bukan milik koreksi, event yang agregatnya bukan instance workflow, atau instance yang masih pending tidak cocok dengan apa pun dan diabaikan diam-diam;
  role worker tidak membaca `reason` koreksi maupun `reason` / `override_reason` keputusan workflow (SELECT per kolom, `sql/280`), dan hanya boleh menyisipkan event bersumber `correction` (setiap anggota `awcms_worker` dibatasi demikian); instance yang selesai sebelum consumer
  ini dirilis tidak punya delivery dan diselesaikan manual sekali.
  Route manual `POST .../attendance-corrections/{id}/settle` (`corrections.approve`,
  berisiko tinggi) membaca instance: pending -> `409 CORRECTION_STILL_PENDING`,
  lalu penerapan yang sama.
  **Pemohon diberi tahu (#1044).** Setelah consumer menyelesaikan koreksi, ia
  mengantrekan satu e-mail ke pemohon lewat capability opsional
  `workflow_notification` (adapter `email`, `enqueueAnnouncement`): INSERT outbox
  dalam transaksi consumer sendiri, dikirim kemudian oleh `bun run email:dispatch`,
  tak pernah panggilan provider di jalur penyelesaian, dan dibungkus savepoint
  sehingga kegagalan dicatat (hanya kelas dan kode) dan tak pernah membatalkan
  penyelesaian. Tiga template EN/ID, satu per hasil
  (`hr.attendance_correction_applied` / `_rejected` / `_cancelled`), memuat nama
  tampilan pegawai dan tanggal (UTC) dan **tak pernah alasan** (daftar variabel
  template tak punya slot untuknya, dan worker tak dapat membaca kolomnya). Satu
  pemberitahuan per (koreksi, hasil): hanya transisi `pending` -> selesai yang
  memberi tahu, ledger efek menyerap delivery yang diulang, dan baris outbox
  membawa correlation id `hr_workforce.attendance_correction:<id>:<hasil>`. Tenant
  memilih ikut dengan mengaktifkan template itu (`bun run
email:templates:seed-defaults`); tanpanya port tidak melakukan apa-apa secara
  diam-diam. INSERT worker pada `awcms_email_messages` dibatasi per kolom
  (`sql/302`). Koreksi yang diselesaikan manual lewat route tidak memberi tahu
  siapa pun (pemanggil sudah melihat hasilnya). Telegram dan WhatsApp belum
  dihubungkan: belum ada template Telegram terdaftar-modul yang sampai ke proses
  dispatcher dan jenis variabelnya tak dapat membawa nama, serta tak ada resolver
  nomor telepon staf untuk WhatsApp.
- **Pemisahan tugas, empat lapis.** (1) guard milik engine workflow mencegah
  pemohon memutuskan; (2) guard self-approval chokepoint menolak pemohon
  **menyelesaikan koreksi yang approved (atau masih pending)** (`403`); ia dilewati
  untuk putusan `rejected` / `cancelled` yang tidak menerapkan apa pun, sehingga
  pemohon dapat menutup permintaannya sendiri yang ditolak (#998; izin
  `corrections.approve` tetap dibutuhkan); (3) handler menolak instance approved yang tidak punya
  keputusan setuju manusia (`409 CORRECTION_NO_APPROVER`: graf tanpa node persetujuan
  akan menjadikan pemohon penyetuju dirinya) atau yang diikuti pemohon **atau pegawai yang
  dikoreksi** **langsung atau sebagai pemberi delegasi yang kedudukannya dipakai
  delegat**, atau yang diselesaikan pegawai itu (`409 CORRECTION_SELF_APPROVED`:
  guard engine hanya membandingkan pengguna yang bertindak, sehingga delegat yang
  menyetujui atas nama seseorang lolos, dan rekan yang mengajukan koreksi untuk
  seorang pegawai akan membiarkan pegawai itu menyetujuinya). Subjek adalah login
  yang tertaut ke employment saat koreksi diminta (dipotret di
  `subject_tenant_user_id`, dicap trigger) DAN yang tertaut sekarang, sehingga
  penautan ulang di antaranya tidak melepas pengecualian; tidak ada pengecualian
  transitif rantai atasan; (4) database: `CHECK` bahwa `decided_by` bukan pemohon
  maupun subjek, dan trigger yang membaca ulang baris keputusan workflow sendiri
  (diputuskan oleh dan atas nama). Status koreksi hanya dapat
  mengikuti putusan instance (`approved`/`rejected`/`cancelled`), dan baris
  `approved` tanpa event-nya tidak dapat commit (constraint trigger tertunda).
- **Siapa melihat apa.** `?mine=true` (setiap employment pemanggil yang hidup, yang
  sudah terminasi termasuk: orang yang dipekerjakan kembali membaca event dan koreksi
  employment lamanya sekaligus yang sekarang, tak pernah milik orang lain) dan `?reports=true` (**rantai atasan saat ini** di bawah employment
  pemanggil yang hidup dan belum terminasi) adalah `ownershipGrant` pada route BACA
  saja; daftar tanpa batas butuh `attendance.read` / `corrections.read` ("HR melihat
  semua"). `employmentId` di luar dasar yang dipilih adalah `403`.
  `awcms_hr_report_ids` menelusuri paling banyak sepuluh tingkat dan **tidak
  mengembalikan maupun menelusuri employment yang di-soft-delete**: postur atasan
  terhapus di bawah bersifat fail-closed (atasan satu tingkat di atas kehilangan
  pandangan atas orang di bawah atasan tengah yang terhapus sampai HR menulis ulang
  terms mereka). Request cacat ditahan sampai otorisasi memutuskan, sehingga
  pemanggil yang tidak berwenang diberi `403` sebelum `400`.
- **Alasan bersifat sensitif.** Ia dipilih hanya pada `GET .../{id}` dan hanya untuk
  pemohon, assignee workflow HIDUP dari instance (kursi yang dialihkan atau dilewati tidak melihat apa pun), atau pemanggil yang perannya memberi
  `corrections.read`; atasan yang membaca koreksi bawahannya lewat rantai saja
  melihat semuanya kecuali alasan. Tidak ada respons tulis yang membawanya (jadi
  penyimpanan idempotensi tidak menyimpannya), daftar tidak pernah, dan tidak ada
  baris audit, domain event, log, atau fakta workflow yang membawanya (tes teks-sumber
  dan runtime memindai sentinel).
- **Guard mengambil baris induk `FOR SHARE`** (employment, instance workflow,
  koreksi), sehingga delete atau terminasi serentak berserialisasi dengan insert
  alih-alih berlomba (sebuah tes menahan soft-delete yang belum commit dan
  membuktikan insert menunggu lalu ditolak). Tabel event sendiri tidak dapat dikunci
  `FOR SHARE` oleh `awcms_app` (tanpa hak `UPDATE`), karenanya target pergantian
  dibaca biasa: tabelnya tak dapat diubah.
- **Audit dan idempotensi.** Request, withdraw, dan settle diaudit hanya dengan id
  dan status (`info`; settle `warning` bila approved). Mencatat event diaudit
  **bila dicatat untuk orang lain** (#998): setiap event `supervisor` (`info`) dan
  event `kiosk` / `import` yang ditandai `late` (`warning`), sebagai
  `hr_workforce.attendance_event.recorded_for_other` berisi employment, jenis,
  sumber dan `late` (instan yang diklaim ada pada event yang disebut baris itu), dengan pencatat sebagai aktor; event
  `self` dan ketukan kiosk/import yang tepat waktu tidak (volume tinggi: event
  adalah catatannya), dan replay tidak menambah baris kedua. `attendance.create`
  berlaku seluruh tenant dan tidak di-seed ke peran mana pun secara default;
  jendela putar ulang kiosk/import tujuh hari **melewati persetujuan koreksi**
  secara sengaja (untuk antrean offline), itulah sebabnya yang basi diaudit.
  Setiap tulis butuh `Idempotency-Key`.
- **Belum ada domain event.** `awcms.hr.attendance.recorded` tetap provisional
  sampai ada consumer (seperti shift).

## Metrik tenaga kerja (Issue #953, `sql/308`)

FAKTA bisnis yang transparan tentang kehadiran, jam kerja, cakupan shift, dan
produktivitas; kontrak lengkapnya di
[`docs/awcms/workforce-metrics.id.md`](../../../docs/awcms/workforce-metrics.id.md).
Dua route di `/api/v1/hr-workforce/workforce-metrics/`:

- `employees` — fakta per karyawan. `?mine=true` (karyawan, tanpa izin) dan
  `?reports=true` (supervisor, hanya bawahan **langsung**, tanpa izin) adalah
  ownership grant; selain itu butuh `workforce_metrics.read` (HR). `employmentId`
  di luar basis adalah 403, sama dengan yang tidak ada.
- `groups` — agregat per office untuk `workforce_metrics.analyze` (atau `.read`),
  tanpa baris individu. Grup dengan kurang dari lima karyawan berkontribusi adalah
  `suppressed: true` tanpa angka sama sekali, dan tidak ada total seluruh-tenant
  untuk dikurangkan. Ambangnya konstanta kode.

Tidak ada skor komposit, peringkat, atau penanda di mana pun; tidak ada nilai
foto, biometrik, perangkat, atau lokasi yang dibaca (tabel sumber tidak
memilikinya); tidak ada tabel payroll yang dibaca. Setiap respons menyatakan bahwa
sebuah angka bukan penilaian dan butuh tinjauan tata kelola §7 kontrak sebelum
dipakai untuk keputusan berdampak.

Modul mendaftarkan satu projection reporting, `hr_workforce.attendance_events`
(volume event per jenis, khusus HR), karena penghitung seluruh-tenant milik engine
tidak bisa menyatakan "hanya milik sendiri" atau supresi grup kecil; angka perilaku
dihitung langsung (`domain/hr-workforce-reporting.ts` menjelaskan pemisahannya).

## Keputusan hak subjek data (cakupan ADR-0094)

| Tabel                             | `subjectData`                                                                            | Alasan                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_hr_employments`            | tercakup: `profile_id`, `tenant_user_id`, `last_tenant_user_id`; diekspor                | Catatan kepegawaian milik subjek sendiri. Stempel aktor (`created_by`, `updated_by`, `deleted_by`, `restored_by`) BUKAN kolom subjek sejak Issue #1018: ia menamai pengguna HR yang memasukkan header, dan mencocokkannya memasukkan header orang lain ke ekspor pengguna itu. Dipertahankan di bawah kewajiban ketenagakerjaan/pajak/jaminan sosial pemberi kerja (`retain_under_obligation`); tautannya tetap dan mengarah ke profil yang sudah dianonimkan. |
| `awcms_hr_employment_terms`       | tercakup: lewat employment (`subjectVia`); **diekspor**; dipertahankan                   | Seluruh riwayat karyawan itu sendiri, dicapai lewat `employment_id` -> `awcms_hr_employments` (`profile_id` / `tenant_user_id`), jalur tak langsung ADR-0142. `created_by` pencatat sengaja BUKAN kolom subjek, sehingga ekspor pengguna HR tak pernah memuat riwayat orang lain. Penghapusan tidak mengikuti join; hanya-tambah dan dipertahankan.                                                                                                            |
| `awcms_hr_shift_assignments`      | tercakup: lewat employment (`subjectVia`); **diekspor**; dipertahankan                   | Kapan seseorang dijadwalkan dan kapan berhalangan (kategori kasar, tak pernah alasan), termasuk draf, dicapai lewat employment (ADR-0142). Stempel penjadwal bukan kolom subjek. Tak pernah dihapus, baris terbit tak dapat diubah; penghapusan tidak mengikuti join.                                                                                                                                                                                          |
| `awcms_hr_attendance_events`      | tercakup: lewat employment (`subjectVia`); **diekspor**; dipertahankan                   | Kapan seseorang clock-in dan clock-out (data perilaku), dijangkau lewat `employment_id` -> `awcms_hr_employments` (ADR-0142, Issue #1018). `recorded_by` pencatat sengaja BUKAN kolom subjek. Append-only; penghapusan tidak mengikuti join. Tidak memuat teks bebas, lokasi, foto, perangkat, atau nilai jaringan, sehingga semua kolom diekspor.                                                                                                             |
| `awcms_hr_attendance_corrections` | tercakup: lewat employment (`subjectVia`); **diekspor, `reason` ditahan**; dipertahankan | Permintaan mengubah kapan seseorang tercatat bekerja, dijangkau lewat employment (ADR-0142, Issue #1018). Pemohon dan pemutus bukan kolom subjek. `reason` teks bebas adalah kolom yang disamarkan (lihat Butir terbuka); subjek tetap membacanya lewat GET ber-ownership-grant.                                                                                                                                                                               |
| `awcms_hr_shift_templates`        | `NO_SUBJECT_DATA` (alasan tercatat)                                                      | Pola tanpa orang; hanya stempel aktor.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `awcms_hr_workforce_settings`     | `NO_SUBJECT_DATA` (alasan tercatat)                                                      | Baris konfigurasi tenant; hanya stempel `updated_by`.                                                                                                                                                                                                                                                                                                                                                                                                          |

Ketujuh tabel didaftarkan ke `data_lifecycle` sebagai `delegated`, tanpa purge:
riwayat HR dipertahankan selama masa hukum pemberi kerja (menurut penasihat
hukum, tidak ditegaskan di sini); archive-then-purge untuk baris HR adalah tindak
lanjut tercatat.

## Tata letak

| Path                                        | Isinya                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `module.ts`                                 | Deskriptor: 23 permission, `dataLifecycle` + `subjectData`                                    |
| `domain/hr-shift-types.ts`                  | Kind, status, dan batas shift — murni                                                         |
| `domain/hr-shift-time.ts`                   | Penyelesaian jam dinding ke UTC, aturan celah/tumpang tindih DST — murni                      |
| `domain/availability-intervals.ts`          | Aljabar interval dan aturan waktu kerja — murni                                               |
| `domain/hr-shift-validation.ts`             | Validator template dan penugasan yang ketat (tanpa teks bebas) — murni                        |
| `application/hr-shift-directory.ts`         | SQL template dan penugasan: draft, publish, cancel, daftar                                    |
| `application/staff-availability-adapter.ts` | Adapter `StaffAvailabilityPort` (hanya-baca)                                                  |
| `domain/hr-workforce-types.ts`              | Tipe dan status employment — murni                                                            |
| `domain/hr-workforce-validation.ts`         | Validator request ketat (tanpa field personal, tanpa tanggal akhir turunan) — murni           |
| `domain/hr-workforce-permissions.ts`        | Objek guard literal yang diteruskan ke `authorizeInTransaction`                               |
| `application/hr-workforce-directory.ts`     | Seluruh SQL: list/get, buat, ubah terms, assign, delete/restore, settings                     |
| `application/hr-workforce-route-support.ts` | Idempotensi, validasi body, dan dasar kepemilikan yang dipakai bersama oleh route             |
| `domain/hr-attendance-types.ts`             | Kind, sumber, status koreksi, dan batas kehadiran — murni                                     |
| `domain/hr-attendance-validation.ts`        | Validator event dan koreksi yang ketat (tanpa lokasi, tanpa teks bebas selain alasan) — murni |
| `application/hr-attendance-directory.ts`    | Event, koreksi, dasar baca (sendiri, bawahan), settle dan withdraw                            |
| `src/pages/api/v1/hr-workforce/**`          | 16 berkas route tipis, masing-masing otorisasi lewat `defineTenantRoute`                      |

## Butir terbuka dan postur fase 1 yang tercatat

Terbuka (dilacak, tidak disembunyikan):

- **Event kehadiran dan koreksi diekspor lewat employment** (Issue #1018,
  ADR-0142): event dan koreksi milik karyawan itu sendiri, tanpa milik rekan kerja
  atau supervisor yang mencatatnya. **`reason` teks bebas pada koreksi ditahan**
  (kolom yang disamarkan, dan respons menyatakannya): ia diketik pemohon, dapat
  menggambarkan kondisi kesehatan atau keluarga (termasuk pihak ketiga) dan sensitif
  di tempat lain pada modul ini. Karyawan tetap membacanya lewat GET ber-ownership-grant.
  Apakah ekspor boleh merilisnya adalah pertanyaan produk/hukum yang terbuka
  (adendum ADR-0142); perubahannya menghapus satu entri `redactedColumns`.
- **Kehadiran, ditunda dan tercatat:** belum ada `void` (koreksi yang menghapus
  event tanpa pengganti): clock-in hantu diganti dengan event yang benar; tanpa
  validasi urutan (`clock_out` tanpa `clock_in` dicatat sebagaimana diklaim; catatan
  efektif dibaca, tidak ditegakkan); jendela putar ulang 7 hari dan ambang `late` 15
  menit adalah konstanta, bukan setelan tenant; **penyelesaian berjalan otomatis**
  (consumer domain-event, #998) dengan `settle` sebagai jalur manual cadangan, dan
  pemohon tidak diberi tahu hasilnya; rantai atasan hanya memberi akses
  baca, sehingga atasan tetap tidak bisa mencatat untuk bawahan tanpa
  `attendance.create`; **tanpa scope per kantor** pada `attendance.read`/`create`
  (adapter scope adalah issue berikutnya, seperti employments); tanpa domain event;
  tanpa layar admin; penyetuju workflow koreksi adalah assignee tetap definisi,
  bukan "atasan pemohon" (engine tidak punya tipe assignee seperti itu).
- **Tidak ada purge `data_lifecycle` untuk kehadiran** (dinyatakan `delegated`,
  kelas `financial_tax`, periodenya milik penasihat hukum pemberi kerja); daftar
  event dipaginasi keyset 100 per halaman sementara itu.
- **Tidak ada purge `data_lifecycle` untuk baris shift** (dinyatakan `delegated`,
  kelas retensi `financial_tax` seperti baris HR lain; periodenya milik penasihat
  hukum pemberi kerja). **Tidak ada domain event** (`awcms.hr.shift.assigned` tetap
  provisional sampai Booking memakainya), **tidak ada layar admin**, **tidak ada
  restore template** (template yang dihapus membebaskan kodenya; buat ulang), dan
  **penugasan pada atau setelah terminasi tidak ditolak** (port cukup mengabaikan
  terms yang bukan `active`).
- **Terms dan shift diekspor lewat employment** (issue 985, ADR-0142): ekspor
  akses-subjek memuat riwayat terms dan penugasan shift milik karyawan itu sendiri,
  dan tak ada milik rekan kerja atau pengguna HR yang mencatatnya. Penghapusan tidak
  mengikuti join; barisnya dipertahankan. Join hanya mencocokkan `profile_id`
  employment (Issue #1018): login yang salah tertaut ke employment orang lain lalu
  dikoreksi tidak membawa baris employment itu ke ekspornya. HEADER employment masih
  mencocokkan kolom login (tindak lanjut).
- **Belum ada purge.** Deskriptor `data_lifecycle` menyatakan siklus yang
  dimaksud (soft delete, lalu purge setelah masa retensi pemberi kerja) tetapi
  belum ada yang mem-purge; archive-then-purge untuk baris HR adalah tindak lanjut.

Postur fase 1 yang diketahui:

- **Penautan `assign` terikat pada karyawannya (temuan PS-14, Issue #979).**
  Ownership grant adalah kunci "karyawan melihat miliknya" dan, di fase 3, slip
  gaji, sehingga penautan tidak lagi sekadar sebuah permission. (1) Pemanggil
  tidak dapat menautkan login MILIKNYA ke employment orang lain
  (`403 SELF_LINK_FORBIDDEN`). (2) Identity milik tenant user yang ditautkan harus
  membawa `profile_id` employment (`422 PROFILE_MISMATCH`); kecocokannya persis
  dan fail-closed, sehingga profil yang sudah di-merge pada salah satu sisi harus
  diarahkan ulang lebih dulu. Karena karyawan dan login orang yang sama berbagi
  profil, menautkan login sendiri ke employment sendiri tetap berfungsi.
  (3) Penautan ulang (mengganti atau menghapus tautan yang ada) diaudit pada
  `critical` (penautan pertama tetap `warning`) dengan UUID login sebelum dan
  sesudah tanpa teks bebas, dan, bila employment sudah punya event kehadiran,
  memerlukan step-up KONDISIONAL ADR-0141 bagian 4: pemanggil tanpa faktor
  terdaftar tidak terkunci (baris audit mencatat `stepUp: "not_enrolled"`),
  pemanggil terdaftar dengan sesi basi mendapat `403 STEP_UP_REQUIRED`. Penolakan
  tidak disimpan di bawah Idempotency-Key, sehingga key yang sama berhasil setelah
  step-up. Pengerasan lanjutan: ketiga penolakan menulis baris audit
  `account_link_refused` (kode alasan dan UUID saja; penolakan adalah `Response`
  yang dikembalikan, sehingga transaksi commit dan barisnya bertahan); permintaan
  "tautkan login yang sama" memvalidasi ulang login alih-alih menggemakan tautan
  pra-perbaikan sebagai `200`; identity login harus `active`; employment yang
  PERNAH ditautkan (`last_tenant_user_id`, `sql/228`) tetap penautan ulang
  setelah unlink; trigger `awcms_hr_employments_link_guard` menolak login yang
  tidak cocok di database; dan peringatan `security:readiness` "Employment account
  links belong to the employment's person" mendaftar tautan yang dibuat sebelum
  perbaikan. Masih terbuka untuk #961: "slip gaji yang sudah dirilis" bergabung ke
  uji riwayat, dan pemilik lama dicabut dari slip gaji di sana.
- **`employments.read` berlaku se-tenant.** Tidak ada business scope `office`
  yang membatasinya di fase 1; pembacaan per kantor dan per atasan (skenario S4
  dan S6 paket desain) butuh adapter scope dan alasan kepemilikan `manager_of`,
  keduanya issue berikutnya.
- **Atasan yang di-soft-delete meninggalkan referensi menggantung.** Menghapus
  lunak employment yang menjadi atasan seseorang tidak menulis ulang terms
  bawahannya, sehingga `managerEmploymentId` menunjuk baris yang sudah dihapus
  (masih ada, `deletedAt` terisi). Apa pun yang menelusuri rantai harus menangani
  atasan yang terhapus; aturan kedalaman dan siklus tetap menghitungnya.
- Resolver kepemilikan membaca satu boolean tentang sebuah baris sebelum guard
  memutuskan (di dalam transaksi tenant, di bawah RLS); id yang tidak ada dan baris
  milik orang lain sama-sama dijawab 403, jadi bukan oracle keberadaan, tetapi
  pembacaan terjadi sebelum keputusan.

## Keterbatasan

- Layar tulis kepegawaian, pengaturan, dan roster belum ada (layar baca swalayan, supervisor, dan HR sudah, Issue #952). Tenant yang sudah ada juga perlu backfill untuk permission `shifts.*`, `templates.*`, `clock.*`, `attendance.*`, dan `corrections.*`, dan operator harus **menerbitkan workflow** di bawah `hr.attendance_correction` (atau kunci tenant) sebelum koreksi dapat diajukan.
- Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill`
  untuk menerima permission yang di-seed (keterbatasan setiap seed permission).
- Nomor karyawan dan tanggal masuk tidak bisa disunting langsung (hapus lalu buat
  ulang selama itu kesalahan); endpoint sunting header adalah issue berikutnya.
- Tabel terms belum di-join ke ekspor subjek (lihat di atas).
- `btree_gist` tidak dipakai: tumpang tindih terms adalah trigger, bukan
  exclusion constraint.
