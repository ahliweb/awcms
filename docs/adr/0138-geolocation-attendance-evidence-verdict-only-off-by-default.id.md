🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0138-geolocation-attendance-evidence-verdict-only-off-by-default.md)

<!-- i18n-source-hash: sha256:d6aeeab865a70a0adf66c91476b04a409f2a1e8bfddb9343d6384bdd5e1563dd -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0138 — Bukti absensi geolokasi: hanya putusan, mati secara bawaan, retensi singkat

- **Status:** Diterima (hanya sebagai catatan keputusan — **tidak ada kode bukti, tabel, setelan, permission, atau route**; lihat "Status implementasi")
- **Tanggal:** 2026-10-12
- **Pengambil keputusan:** ahliweb
- **Memperluas:** [ADR-0132](0132-hr-payroll-module-family-admission.id.md) (desain absensi `hr_workforce`; ADR ini adalah "ADR tersendiri" yang diminta §4.3-nya), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md) (subjek adalah tenant user; ekspor dan penghapusan adalah dua otoritas)
- **Terkait:** Issue #948; keputusan pemilik DoR `ahliweb/awcms-one` O6, dijawab 10 Okt 2026, dan `docs/aw-business-platform-threat-model.md` repo itu §5.2 (peran hukum), §5.4 (geolokasi absensi), §5.5 (retensi) serta kontrol C-22; [`docs/awcms/hr-payroll.id.md`](../awcms/hr-payroll.id.md) §4.2–§4.3; ADR-0037 dan `src/modules/data-lifecycle` (kerangka retensi); ADR-0063 (chokepoint otorisasi)

## Konteks

Keputusan pemilik O6 membolehkan absensi memakai **hanya geolokasi** — **tanpa foto, tanpa biometrik, dan tanpa sidik jari perangkat, selamanya** — dan mewajibkannya **mati secara bawaan per tenant**. ADR-0132 mencatat bahwa jawaban itu _mengizinkan_ sebuah desain tetapi tidak menerima fitur, dan sengaja mengosongkan §4.3. Threat model awcms-one (§5.4) mendaftar batasannya (mati bawaan, hanya check-in/out, pembatasan tujuan, minimisasi, pengecualian, retensi terbatas, pemberitahuan, akses terbatas, pemalsuan, penilaian dampak) dan secara eksplisit menyerahkan pertanyaan intinya kepada repo ini: **koordinat mentah atau putusan?**

Fakta yang membentuk pilihan:

- Lokasi seseorang saat bekerja adalah data pribadi perilaku dan, di rumah atau klinik, dapat mengungkap jauh lebih banyak daripada absensi (tempat tinggal, kesehatan, agama, aktivitas serikat). Apakah ia "data pribadi spesifik" menurut UU No. 27 Tahun 2022 (UU PDP) belum dipastikan dan menjadi urusan penasihat hukum; ADR ini memperlakukannya sebagai sensitivitas tinggi.
- Dalam hubungan kerja subjek data tidak bebas menolak, sehingga **persetujuan bukan dasar hukum tunggal yang aman**; dasar hukum adalah penetapan tenant sebagai pengendali, bersama penasihat hukum (platform adalah prosesor untuk data karyawan tenant, threat model §5.2).
- Koordinat yang dilaporkan klien mudah dipalsukan. Bukti semacam ini adalah indikator pendukung, bukan pembuktian.
- Event absensi `hr_workforce` bersifat append-only dan berantai `supersedes` (ADR-0132 §4.2); bukti tidak boleh merusaknya, dan harus bisa dipurge terpisah dari event, yang relevan untuk gaji dan disimpan lebih lama.

## Opsi yang dipertimbangkan

| Opsi                                                                                                     | Keamanan / privasi (UU PDP)                                                                                                     | Akurasi untuk tujuan                                             | Kompleksitas operasional                                                          | Putusan                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A. Simpan koordinat mentah + akurasi pada event                                                          | Terburuk: jejak pergerakan dan lokasi rumah ada di tabel, di setiap backup, ekspor, dan kebocoran                               | Tertinggi; memungkinkan analisis ulang (risiko perluasan tujuan) | Murah dibangun, mahal dipertahankan (akses, masking, retensi, hak subjek)         | Ditolak                                                                                   |
| B. Simpan koordinat dibulatkan (mis. 3 desimal, sekitar 100 m)                                           | Tetap menunjuk rumah atau klinik ke satu jalan; rasa aman semu, tetap jejak; kontrol sama dengan A                              | Baik                                                             | Seperti A                                                                         | Ditolak                                                                                   |
| **C. Evaluasi di server terhadap geofence tenant, simpan hanya putusan dan pita kasar, buang koordinat** | Terbaik: tidak ada koordinat saat disimpan, jadi tidak ada di backup, ekspor, atau kebocoran; tidak ada yang bisa melacak orang | Cukup: tujuannya "apakah check-in di lokasi kerja sah"           | Sedang: definisi geofence dan evaluator murni; koordinat harus dijauhkan dari log | **Dipilih**                                                                               |
| D. Evaluasi di klien dan kirim hanya putusan                                                             | Baik saat disimpan, tetapi server tak bisa memeriksa ulang, putusan mudah dipalsukan, asal-usulnya tak terbukti                 | Buruk                                                            | Rendah                                                                            | Ditolak                                                                                   |
| E. Koordinat mentah di tabel berumur pendek untuk jendela sengketa, lalu diringkas jadi putusan          | Lebih baik dari A, tetapi jendela mentah tetap jejak dan job purge menjadi satu-satunya pengaman                                | Tertinggi selama jendela                                         | Tertinggi (dua penyimpanan, dua retensi)                                          | Ditolak untuk v1; tinjau lagi hanya lewat ADR baru dengan DPIA yang menunjukkan kebutuhan |

## Keputusan

### 1. Bukti hanya-putusan (opsi C)

Saat fitur aktif untuk sebuah tenant dan karyawan mencatat `clock_in` atau `clock_out` (tidak ada jenis event lain, tidak ada penangkapan terus-menerus atau latar belakang), klien boleh mengirim satu sampel posisi beserta akurasi yang dilaporkannya. **Server mengevaluasinya dalam request terhadap geofence kantor event itu dan membuang koordinatnya.** Yang disimpan hanya:

- `verdict` ∈ {`inside`, `outside`, `not_provided`}: `not_provided` mencakup karyawan yang menolak, perangkat tanpa fix, atau sampel yang akurasinya lebih buruk dari batas yang dikonfigurasi tenant (tidak pernah dihitung `inside`);
- **pita jarak kasar** ke geofence terdekat (mis. `within`, `lt_250m`, `lt_1km`, `gte_1km`) dan **pita akurasi** kasar;
- rujukan geofence, versi aturan evaluator, dan waktu evaluasi server.

**Tidak ada koordinat, akurasi mentah, ketinggian, kecepatan, arah, alamat, pengenal perangkat atau jaringan, foto atau gambar, maupun biometrik** yang disimpan di tabel, antrean, baris outbox, payload event, baris audit, baris log, ekspor, atau cache mana pun. Pembersihan parameter posisi dari log request adalah bagian implementasi dan diuji. Koordinat mentah hanya ada di memori request.

**Geofence** adalah definisi lokasi kerja sah milik tenant (lingkaran atau poligon kecil yang melekat pada kantor), dikonfigurasi administrator. Ia menggambarkan tempat usaha, bukan orang, dan bukan data pribadi.

### 2. Tabel append-only terpisah, terhubung ke event, tidak pernah kolom pada event

Bukti tinggal di tabelnya sendiri (nama rencana `awcms_hr_attendance_location_evidence`), paling banyak satu baris per event absensi, `tenant_id`, RLS `FORCE`, append-only untuk `awcms_app`, FK komposit ber-tenant ke event. Baris event absensi sendiri tidak berubah dan **tidak** membawa kolom lokasi. Akibatnya: bukti bisa dipurge oleh retensi tanpa menyentuh event yang relevan untuk gaji (ADR-0132 §4.2), dan tenant yang tidak pernah mengaktifkan fitur ini tidak punya baris bukti dalam radius dampaknya. Koreksi yang men-supersede event tidak menyalin atau menulis ulang bukti.

### 3. Mati bawaan, diaktifkan lewat tindakan ber-gerbang dan beraudit

Saklar per tenant adalah `false` untuk setiap tenant dan tidak bisa diaktifkan oleh migrasi, seed, atau variabel lingkungan. Mengaktifkannya menuntut **semua**:

1. permission khusus `hr_workforce.geolocation_evidence.configure` (high-risk, `Idempotency-Key`, audit berseverity `critical` dengan keadaan sebelum/sesudah dan aktor, tidak pernah berisi lokasi). Permission ini **tidak** diberikan ke peran tenant bawaan lewat seed: owner tenant atau administrator HR menerimanya hanya lewat penugasan eksplisit;
2. rujukan tercatat ke **penilaian dampak pelindungan data (DPIA)** tenant (rujukan dokumen dan tanggal, bukan isinya);
3. **versi pemberitahuan yang diterbitkan** (butir 4) dan minimal satu geofence untuk kantor terkait.

Mematikan selalu boleh (tanpa prasyarat) dan diaudit sama. Menonaktifkan menghentikan penangkapan seketika; bukti yang ada menua di bawah retensi berikut (tenant juga dapat meminta penghapusan, §7). Pengaktifan modul bersifat ortogonal: menonaktifkan `hr_workforce` menolak semuanya seperti biasa.

### 4. Pemberitahuan dan pengakuan, bukan persetujuan sebagai dasar

Sebelum sampel pertama diterima untuk seorang karyawan, ia harus **mengakui** versi pemberitahuan terkini: apa yang ditangkap (satu posisi saat check-in/out), kapan, untuk apa (memverifikasi kehadiran di lokasi kerja sah untuk catatan absensi — tidak untuk yang lain), siapa yang dapat melihat, berapa lama disimpan, dan bahwa menolak tidak menghentikan mereka melakukan clock. Pengakuan adalah catatan (employment, versi pemberitahuan, waktu) di tabel kecilnya sendiri dan diminta ulang saat versi berubah. Teks pemberitahuan milik tenant, dalam locale tenant; platform menyediakan templat. Platform mencatat pengakuan sebagai **bukti pemberitahuan**; ia tidak menyatakan persetujuan sebagai dasar hukum. **Menolak adalah jalur kelas satu**: event clock dicatat dengan `not_provided` dan tidak ada sanksi otomatis.

### 5. Pembatasan tujuan, dan apa yang tidak boleh dilakukan putusan

Tujuan: memverifikasi kehadiran di lokasi kerja sah untuk catatan absensi. Bukti **tidak boleh** dipakai untuk pelacakan pergerakan, penilaian produktivitas atau kinerja, peringatan keluar geofence, rekonstruksi rute, atau keputusan merugikan otomatis. Putusan `outside` atau `not_provided` hanya menaikkan **bendera untuk tinjauan manusia** oleh pembaca berwenang dan tidak mengubah gaji, status, atau persetujuan dengan sendirinya. Karena posisi klien dapat dipalsukan, putusan didokumentasikan di mana pun sebagai indikator pendukung, bukan bukti. Penggunaan untuk tujuan lain memerlukan ADR baru.

### 6. Siapa yang boleh membaca

Pembacaan diotorisasi lewat chokepoint (ADR-0063), default-deny. Permission rencana di `hr_workforce`:

| Permission                                    | Pemegang (lewat penugasan, bukan seed bawaan) | Catatan                                                                                                             |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `hr_workforce.attendance_evidence.read`       | HR dan, dalam cakupannya, supervisor          | `ownershipGrant` memperlebarnya hanya ke baris **milik sendiri** (pola S1); tiap pembacaan bukti orang lain diaudit |
| `hr_workforce.geolocation_evidence.configure` | administrator HR tenant / owner               | saklar, batas akurasi, versi pemberitahuan, geofence; high-risk                                                     |

Penjadwal, kasir, pemasar, dan operator payroll **tidak** punya jalur ke bukti (uji gaya S11). Bukti **bukan** field `profile_identity` dan tidak muncul di endpoint daftar modul lain. Respons `no-store`.

### 7. Retensi, ditegakkan `data_lifecycle`, dan hak subjek

Tabel bukti didaftarkan pada array `dataLifecycle` descriptor modul pemiliknya (bentuk sama dengan yang dipakai `logging` untuk `awcms_audit_events`) **dalam perubahan yang sama yang membuat tabelnya** (tidak ada tabel tanpa descriptor), divalidasi `validateLifecycleDescriptorShape` dan dijalankan job archive/purge `data_lifecycle` bersama. Nilai rencana, untuk dikonfirmasi implementasi bersama penasihat hukum: `cursorColumn: "evaluated_at"`, **`retentionMinDays: 30`, `defaultRetentionDays: 90`, `retentionMaxDays: 180`** — periode terpendek yang melayani jendela koreksi atau sengketa (bukti juga tidak diperlukan lagi setelah periode gaji terkait ditutup dan jendela koreksinya lewat), `deletion.mode: "hard_delete"` (baris putusan tak bernilai sisa setelah menua), `archive.archivable: false` dengan alasan tertulis (mengarsipkan akan menyimpan data pribadi melewati tujuannya), dan `legalHold.applicable: true` dengan `precedence: "overrides_retention"`. Tenant hanya boleh memperpendek bawaan dalam batas; tidak boleh melebihi maksimum. Tabel ini juga butuh `SubjectDataDescriptor` agar gerbang `subject-data:coverage:check` terpenuhi: ekspor (otoritas terpisah dan beraudit, ADR-0094 Keputusan 3) memuat baris bukti milik karyawan itu, dan penghapusan menghapusnya (maker/checker seperti ADR-0094); keduanya per tenant, subjeknya adalah tenant user. Baris bukti harus dapat dihapus job purge meski append-only bagi peran aplikasi, mengikuti pola tabel lifecycle yang sudah ada (purge berjalan di bawah peran lifecycle, bukan `awcms_app`).

### 8. DPIA adalah prasyarat mengaktifkan, bukan membangun

Keputusan di sini adalah desainnya. **Mengaktifkan fitur di tenant mana pun** (§3 butir 2) menuntut DPIA tenant itu tercatat. ADR ini sendiri bukan penilaian tersebut: ia menetapkan desain yang harus diperiksa penilaian (hanya putusan, bawaan 90 hari, daftar pembaca) dan pertanyaan yang hanya bisa dijawab penasihat hukum — apakah lokasi "data pribadi spesifik" menurut UU PDP, dasar hukum data karyawan, retensi yang benar-benar dapat dipertahankan, dan transfer lintas negara bila deployment memakai penyedia di luar Indonesia (daftar bagian 6 threat model). Platform tidak mengirim kesimpulan hukum apa pun.

### 9. Dikecualikan secara eksplisit

- **Foto, wajah, templat biometrik, sidik jari perangkat, pengenal perangkat atau iklan, pengenal jaringan/IP atau Wi-Fi/sel sebagai bukti** — tidak pernah (O6). Log request biasa dan data turunan IP tidak boleh dialihgunakan sebagai bukti absensi.
- Koordinat mentah atau dibulatkan saat disimpan, riwayat lokasi, pelacakan terus-menerus atau latar belakang, lokasi pada saat selain `clock_in`/`clock_out`, peringatan masuk/keluar geofence, analitik rute atau waktu di lokasi.
- Keputusan merugikan otomatis atas dasar lokasi saja; penggunaan untuk penilaian produktivitas atau tujuan non-absensi.
- Panggilan provider apa pun (peta, reverse geocoding) di jalur ini: evaluator adalah geometri murni terhadap geofence tersimpan, sehingga tidak ada koordinat yang meninggalkan server.
- Sumber kiosk atau `import` yang mengklaim posisi; hanya `source = self` yang boleh membawa sampel (kiosk adalah tempat, bukan orang).
- Kewajiban keras tingkat tenant bahwa setiap karyawan membagikan lokasi; fitur ini tidak pernah memblokir clock.

## Konsekuensi

- Tidak ada koordinat yang pernah tersimpan, sehingga tidak ada di backup, ekspor, kebocoran, atau himpunan legal-hold; permukaan privasi dan dampak kebocoran fitur ini sekecil mungkin yang masih melayani tujuan.
- Biayanya daya analitik lebih rendah (tidak bisa evaluasi ulang bila geofence keliru digambar) serta evaluator murni dan administrasi geofence yang harus dibangun; diterima.
- Penyerang sungguhan masih bisa memalsukan fix; desain menyatakannya dan melarang keputusan otomatis atasnya.
- Karena DPIA menggerbangi **pengaktifan**, pekerjaan dapat dibangun dan diuji sambil tetap inert di mana pun.

## Status implementasi

**ADR ini tidak membuat apa pun.** Tidak ada tabel bukti, setelan, tabel geofence, tabel pemberitahuan, permission, route, path OpenAPI, atau event AsyncAPI, dan tidak ada migrasi. Implementasi adalah issue tindak-lanjut yang dibuat dari ADR ini (perubahan normal: migrasi dengan RLS `FORCE`, permission di-seed migrasi, OpenAPI, uji termasuk mati-bawaan, tanpa-koordinat-tersimpan, pembersihan log, daftar pembaca, dan descriptor retensi, tinjauan keamanan seperti `hr_workforce`). Ia bergantung pada implementasi absensi `hr_workforce` (#947) mendarat lebih dulu.

## Uji wajib implementasi (akseptansi dibawa ke issue)

1. Tenant baru punya saklar mati; event clock dengan sampel posisi **tidak** mencatat baris bukti; mengaktifkan tanpa permission `403`, tanpa rujukan DPIA atau pemberitahuan atau geofence `409`.
2. Tidak ada kolom, baris antrean, payload event, baris audit, baris log, atau respons yang memuat koordinat (pindai source ditambah asersi runtime dengan nilai sampel khas).
3. Sampel lebih buruk dari batas akurasi menghasilkan `not_provided`, tidak pernah `inside`; sampel yang ditolak tetap mencatat event clock secara normal.
4. Hanya `source = self` yang boleh membawa sampel; event kiosk atau import dengan posisi ditolak.
5. Daftar pembaca: karyawan hanya membaca barisnya sendiri; HR/supervisor dalam cakupan; penjadwal, kasir, pemasar, operator payroll menerima `403`; pembacaan bukti orang lain diaudit.
6. Descriptor valid, job purge menghapus baris melewati batas lewat jalur sadar-legal-hold, dan legal hold memblokirnya; descriptor subject-data memenuhi gerbang cakupan dan ekspor/penghapusan menyertakan barisnya.
7. Menonaktifkan saklar menghentikan penangkapan seketika; menonaktifkan modul menolak semuanya.
