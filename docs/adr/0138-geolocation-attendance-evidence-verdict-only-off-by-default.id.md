🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0138-geolocation-attendance-evidence-verdict-only-off-by-default.md)

<!-- i18n-source-hash: sha256:552da5482657e1b898cd47b2d59e5650feb76b34f7ea0b9e389efc3bc0b5ccc7 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0138 — Bukti absensi geolokasi: hanya putusan, mati secara bawaan, retensi singkat

- **Status:** Diterima; **diimplementasikan oleh Issue #970** (migrasi `sql/306`, modul `hr_workforce`; lihat "Status implementasi")
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

**Diimplementasikan oleh Issue #970** (migrasi `sql/306`, `src/modules/hr-workforce`, OpenAPI `hr-workforce.openapi.yaml`). Tidak ada event AsyncAPI yang ditambahkan: tidak ada yang menerbitkan domain event tentang bukti, dengan sengaja (payload event adalah salinan). Yang ada, butir demi butir terhadap ADR ini:

- **§1 hanya-putusan.** `awcms_hr_geofences` (lingkaran atau poligon 3-32 titik, melekat pada kantor, soft delete dan restore) dan evaluator murni (`domain/hr-geolocation-evaluator.ts`, versi aturan 1). Route clock menerima `positionSample` opsional (`latitude`, `longitude`, `accuracyMeters`, tidak ada yang lain) hanya pada `clock_in` / `clock_out` `self`; server mengevaluasinya di dalam request dan membuangnya. Yang tersimpan hanya putusan, pita jarak (`within`, `lt_250m`, `lt_1km`, `gte_1km`), pita akurasi (`lt_25m`, `lt_100m`, `lt_500m`, `gte_500m`), geofence, versi aturan, dan waktu database. Pembersihan log request: redaksi bersama (`_shared/redaction.ts`) kini menyamarkan kunci `latitude`, `longitude`, `coordinate`, `geolocation`, `positionsample` dan kata yang sama yang tercetak di teks bebas; hash request idempotensi hanya mencakup keberadaan sampel, tidak pernah nilainya; galat validasi menyebut field dan tidak pernah menggemakan nilai.
- **§2 tabel terpisah.** `awcms_hr_attendance_location_evidence`: RLS `FORCE`, kunci tenant komposit ke event, employment, dan geofence, satu baris per event, tanpa UPDATE / DELETE / TRUNCATE untuk `awcms_app` dan trigger UPDATE untuk semua. Tabel event tidak disentuh.
- **§3 mati bawaan, gerbang beraudit.** `awcms_hr_geolocation_settings.enabled` bawaan `false` dan tidak ada migrasi atau seed yang menulis baris. Mengaktifkan memerlukan `hr_workforce.geolocation_evidence.configure` (403), rujukan DPIA beserta tanggalnya, pemberitahuan terbit, dan geofence hidup (masing-masing 409, juga ditegakkan CHECK dan trigger). Permission itu **tidak** diberikan ke owner tenant: ia tetap `scope = 'tenant'` tetapi tercantum di `OWNER_GRANT_EXCLUDED_PERMISSION_KEYS`, yang dihormati oleh grant massal tenant baru maupun job backfill owner. Menonaktifkan tanpa prasyarat, dan pemegang `hr_workforce.settings.configure` biasa boleh mengirim `{ "enabled": false }` polos. Kedua arah diaudit pada severity `critical` dengan state sebelum / sesudah. Database menolak insert bukti saat saklar mati, sehingga menonaktifkan menghentikan penangkapan seketika.
- **§4 pemberitahuan dan pengakuan.** `awcms_hr_geolocation_notices` hanya-tambah (locale -> teks) dan `awcms_hr_geolocation_notice_acknowledgements` (employment, versi pemberitahuan, waktu; hanya ditulis oleh login employment itu sendiri). Sampel dari pegawai yang belum mengakui versi terkini dibuang dan dicatat `not_provided`, sama seperti fix yang ditolak.
- **§5 tujuan.** Putusan tidak memberi makan apa pun: tidak ada event, laporan, proyeksi, atau notifikasi yang membacanya. Ia didokumentasikan di mana-mana sebagai indikator pendukung.
- **§6 pembaca.** `hr_workforce.attendance_evidence.read` (lewat penugasan) dan `ownershipGrant` pada `?mine=true`; setiap pembacaan putusan orang lain diaudit; respons `no-store`. Kedua permission adalah baris katalog baru yang di-seed `sql/306`. `attendance_evidence.read` berlaku seluruh tenant dan khusus HR: tidak ada scope atasan dan tidak ada dasar rantai atasan (keterbatasan tercatat, M-3). Atasan tidak membaca apa pun kecuali HR sengaja menugaskan permission itu, lalu membaca putusan semua pegawai.
- **§7 retensi.** Descriptor bukti adalah `executionMode: "generic"`, `evaluated_at`, 30 / 90 / 180 hari, `hard_delete`, tanpa arsip, legal hold menimpa retensi; mesin berjalan sebagai `awcms_worker` dengan `SELECT, DELETE` pada tabel itu saja. Empat tabel baru lain bersifat retained (`delegated`) dan dihitung lewat penggantian `sql/306` atas fungsi hitung-saja milik `sql/303`. Data subjek: tabel bukti dan pengakuan dapat diekspor lewat employment (ADR-0142); karena ADR-0142 hanya mengizinkan `retain_under_obligation` untuk jalur tidak langsung dan tabel ini hanya-tambah bagi role aplikasi, permintaan penghapusan dipenuhi oleh batas retensi (paling lama 180 hari, tenant boleh memperpendek) dan legal hold, bukan penghapusan segera. **Terbuka untuk penasihat hukum:** apakah permintaan penghapusan harus menghapus putusan lebih cepat dari batas itu.
- **§8-§9.** DPIA adalah prasyarat untuk mengaktifkan, bukan untuk membangun: pekerjaan ini lembam di setiap tenant. Tidak ada di jalur ini yang memanggil provider, menyimpan foto, biometrik, pengenal perangkat atau jaringan, atau menghalangi clock.

**Penyimpangan dari §7, menunggu penasihat hukum (H-1).** §7 menyatakan penghapusan menghapus baris bukti pegawai. Implementasi tidak melakukannya lewat executor permintaan subjek, dan ini dicatat sebagai penyimpangan, bukan desain yang sudah final:

- Gerbang registri ADR-0142 hanya mengizinkan `erasure: "retain_under_obligation"` untuk tabel yang dijangkau lewat jalur subjek tidak langsung (tabel bukti tidak punya kolom orang sendiri, dengan sengaja: ia memuat putusan dan rujukan employment). Kolom subjek langsung diperlukan untuk menyatakan `hard_delete`, dan executor menjalankan `DELETE` sebagai role request (`awcms_app`) yang tidak punya DELETE pada tabel hanya-tambah ini. Memberinya hak itu menghilangkan jaminan hanya-tambah yang dituntut ADR (§2). Jadi kerangka kerja melarang penghapusan-lewat-executor untuk tabel ini tanpa mengubah ADR-0142 atau §2 ADR-0138.
- Yang ada sebagai gantinya: putusan keluar lewat retensi paling lama 180 hari setelah pemeriksaan (tenant hanya boleh memperpendek bawaan), legal hold menimpa retensi, dan `awcms_hr_erase_location_evidence(tenant, employment)` yang dijalankan operator (`sql/306`, EXECUTE hanya untuk `awcms_worker`, pemilik NOLOGIN dengan DELETE dan SELECT dua kolom, diaudit pada `critical` oleh `eraseLocationEvidenceForEmployment`) menghapus putusan satu employment seketika. Ia TIDAK terhubung ke executor permintaan subjek. **Penasihat hukum memutuskan apakah permintaan penghapusan mendapat penghapusan seketika (jalankan fungsi itu) atau menunggu batas retensi; sampai penasihat hukum menyetujui, mengaktifkan fitur di tenant mana pun diblokir** (ia juga digerbangi DPIA tenant, §3 dan §8).
- Nilai `retain_under_obligation` pada descriptor subject-data adalah label registri. Ia tidak boleh dibaca sebagai "hukum mewajibkan pemberi kerja menyimpan baris ini": baris hanya disimpan untuk tujuan pengumpulannya (memeriksa absen masuk dalam jendela koreksi dan sengketa) dan selama retensi terbatas.

Pengerasan setelah audit keamanan: geofence minimal lingkaran 50 m atau poligon sederhana minimal 2.500 meter persegi dengan rentang paling banyak 10 km (tanpa titik berulang, tanpa sisi bersilangan), satu kantor paling banyak 10 geofence hidup, tenant yang saklarnya menyala tidak bisa menghapus geofence hidup terakhirnya (trigger database dan 409), setiap pembuatan/penggantian geofence diaudit dengan revisi dan sidik geometri (bukan koordinat), guard bukti menolak putusan yang menyebut geofence terhapus atau milik kantor lain dari kantor absen, worker hanya boleh membaca `id`, `tenant_id`, dan `evaluated_at` sebuah putusan (ditambah DELETE), dan trigger pada `awcms_role_permissions` menolak menempelkan permission configure ke role `owner` sistem. **§6 lebih sempit dari yang tertulis:** `attendance_evidence.read` berlaku seluruh tenant dan khusus HR. Tidak ada scope atasan dan tidak ada dasar rantai atasan; atasan tidak membaca apa pun kecuali HR sengaja menugaskan permission itu, yang lalu membaca putusan semua pegawai. Posisi yang dilaporkan klien dapat dipalsukan: putusan adalah indikator pendukung untuk ditinjau manusia, bukan bukti.

**Pertanyaan terbuka yang dicatat audit (didokumentasikan, tidak diimplementasikan):** dua butir terbuka dan tidak diputuskan di sini.

- **L-2, prasyarat pengaktifan hanya dinyatakan sendiri.** Rujukan DPIA lolos CHECK dengan teks tak-kosong apa pun (bahkan `x`) dan tanggal apa pun, dan permission configure hanya ditegakkan di kode aplikasi, sehingga pelaku dengan SQL langsung dapat mengaktifkan. Terbuka: mewajibkan bentuk rujukan yang lebih ketat dan tanggal tidak lebih dari hari ini, dan/atau persetujuan kedua (maker/checker, ADR-0094) agar orang yang menugaskan `configure` kepada dirinya sendiri tidak dapat mengaktifkan sendirian.
- **L-5, pengakuan pemberitahuan disimpan tanpa batas.** Descriptor-nya `retained`, personal, kelas `financial_tax`, dan tidak pernah dihapus. Trigger database memeriksa bahwa `acknowledged_by` sama dengan login yang tertaut pada employment tetapi tidak dapat memverifikasi aktor sesi (hanya route yang melakukannya). Terbuka: keputusan retensi untuk pengakuan (misalnya pemberitahuan digantikan ditambah N tahun) dan kelas retensi yang tepat.

Untuk penasihat hukum: apakah lokasi adalah data pribadi spesifik menurut UU PDP; dasar hukum untuk data pegawai; apakah pengakuan pemberitahuan memadai sebagai bukti pemberitahuan; batas retensi yang dapat dipertanggungjawabkan (30 / 90 / 180 hari); apakah permintaan penghapusan mengalahkan batas itu; transfer lintas negara untuk provider di luar Indonesia.

Penyimpangan lain yang perlu diketahui pembaca: kelas retensi adalah `system_event` (registri tidak punya kelas data pribadi); pemberitahuan berupa peta teks per locale, bukan tabel template terpisah; dan tidak ada layar admin (issue tidak memintanya), sehingga kedua permission ada di ledger `NOT_YET_SCREENED` yang hanya boleh menyusut.

## Uji wajib implementasi (akseptansi dibawa ke issue)

1. Tenant baru punya saklar mati; event clock dengan sampel posisi **tidak** mencatat baris bukti; mengaktifkan tanpa permission `403`, tanpa rujukan DPIA atau pemberitahuan atau geofence `409`.
2. Tidak ada kolom, baris antrean, payload event, baris audit, baris log, atau respons yang memuat koordinat (pindai source ditambah asersi runtime dengan nilai sampel khas).
3. Sampel lebih buruk dari batas akurasi menghasilkan `not_provided`, tidak pernah `inside`; sampel yang ditolak tetap mencatat event clock secara normal.
4. Hanya `source = self` yang boleh membawa sampel; event kiosk atau import dengan posisi ditolak.
5. Daftar pembaca: karyawan hanya membaca barisnya sendiri; HR/supervisor dalam cakupan; penjadwal, kasir, pemasar, operator payroll menerima `403`; pembacaan bukti orang lain diaudit.
6. Descriptor valid, job purge menghapus baris melewati batas lewat jalur sadar-legal-hold, dan legal hold memblokirnya; descriptor subject-data memenuhi gerbang cakupan dan ekspor/penghapusan menyertakan barisnya.
7. Menonaktifkan saklar menghentikan penangkapan seketika; menonaktifkan modul menolak semuanya.
