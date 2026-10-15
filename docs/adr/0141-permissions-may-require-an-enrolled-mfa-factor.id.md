🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0141-permissions-may-require-an-enrolled-mfa-factor.md)

<!-- i18n-source-hash: sha256:6bba2ee1ffda09c34e89d2a6ca8105faa9a20f2f7c3fbae5f571c677238ad9e4 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0141 — Sebuah izin dapat mewajibkan faktor MFA yang sudah terdaftar untuk dijalankan

- **Status:** Diterima
- **Tanggal:** 2026-10-14
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #977 (ADR ini dan implementasinya; temuan PS-13 dari tinjauan keamanan fase 3 pada [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.id.md) §17); [ADR-0027](0027-mfa-totp-session-assurance-step-up.id.md) (MFA, assurance sesi, kebijakan MFA tenant); [ADR-0087](0087-mfa-moves-to-the-principal.id.md) (faktor milik orangnya); [ADR-0053](0053-platform-scoped-permissions.id.md) (preseden properti izin yang dideklarasikan di kode dan ditegakkan di chokepoint); [ADR-0031](0031-segregation-of-duties-conflict-enforcement.id.md) (preseden pemeriksaan chokepoint yang aditif dan hanya-menolak); [ADR-0136](0136-configurable-payroll-segregation-of-duties-mode.id.md) §3 dan [ADR-0137](0137-payout-account-encryption-at-rest-and-keyed-hashing.id.md) §4 (dua keputusan yang step-up-nya dijadikan bergigi oleh ADR ini); memblokir redaksi kriteria penerimaan #959 dan #960; refs #956

## Konteks

ADR-0136 §3 dan ADR-0137 §4 menerapkan step-up pada aksi kritis payroll secara **bersyarat**: wajib bila orang yang bertindak punya faktor terdaftar, tidak dituntut dari orang yang tidak punya. Bentuk itu benar, dengan alasan yang sudah dituliskan `password-change.ts` — `requireStepUp` menolak sesi mana pun yang tidak sedang `aal2`, dan orang tanpa faktor tidak pernah bisa mencapai `aal2`, sehingga step-up tanpa syarat mengunci permanen semua orang yang belum memakai MFA.

Akibatnya adalah temuan PS-13: **pemegang tanpa faktor terdaftar melakukan reveal, melonggarkan SoD, approve, finalise, pay, dan reverse tanpa faktor kedua sama sekali.** Kedua ADR berkata tenant "menegakkannya lewat kebijakan MFA yang ada", dan itu tidak bertahan diperiksa:

- Kebijakan tenant (`awcms_tenant_mfa_policies`, ADR-0027) berstatus `optional` secara default dan merupakan pengaturan untuk **seluruh tenant**, diputuskan oleh administratornya, bukan oleh modul yang izinnya dipertaruhkan.
- `required_for_privileged` mengklasifikasikan "berhak istimewa" sebagai memegang izin **apa pun** yang aksinya bukan `read`/`analyze`/`check`. Ia ditegakkan **saat login** (grant pendaftaran, bukan sesi penuh), sehingga meminta setiap pemegang izin non-baca di tenant untuk mendaftar — tuas yang berat untuk "enam izin yang memindahkan uang" — dan tidak berkata apa pun pada saat izin dijalankan.
- Tidak ada apa pun yang menghubungkan "izin ini" dengan "pemegangnya harus mampu memberikan faktor kedua". Tidak ada issue yang membangunnya, jadi kalimat di ADR-ADR itu menggambarkan kontrol yang tidak ada.

> **Catatan tentang kutipan.** Repositori (ADR-0136, ADR-0137, `password-change.ts`) pernah mengutip "ADR-0058 §E" untuk aturan _step-up harus bersyarat_. ADR-0058 yang tertulis membahas empat izin tanpa penegak, dan §E-nya adalah migrasi pencabutan; yang disumbangkannya adalah **kelas** jebakan — persyaratan yang tidak dapat dipenuhi siapa pun menolak semua orang, sementara tempat pemanggilnya terbaca terjaga benar. Aturannya benar; ADR ini menyatakannya dengan kata-katanya sendiri (§4) agar tidak lagi bertumpu pada bagian yang tidak mengatakannya.

## Keputusan

### 1. Izin mendeklarasikan persyaratan; chokepoint menegakkannya saat izin dijalankan

`ModulePermissionDescriptor.requiresMfaEnrolment?: boolean` (`MODULE_CONTRACT_VERSION` **4.3.0**, MINOR: penambahan murni, menghilangkannya berarti "tanpa persyaratan", yang selalu menjadi arti semua descriptor yang ada). Di `authorizeInTransaction`, **setelah** keputusan biasa mengizinkan, permintaan atas izin bertanda ditolak bila orang yang bertindak tidak punya faktor **aktif**:

`403 MFA_ENROLMENT_REQUIRED`, dengan `details.reason` berisi `not_enrolled`, `enrolment_unavailable`, atau `machine_credential`, dan pesan yang menyebut apa yang harus dilakukan (lihat §3). Ia dicatat sebagai **satu** baris decision-log (`deny`, `matched_policy = mfa_enrolment_required`), bukan allow yang disusul deny yang bertentangan.

Ia **hanya-menolak** dan hanya berjalan pada keputusan yang sudah mengizinkan: pemanggil yang tidak punya izinnya menerima `ACCESS_DENIED` biasa dan tidak mengetahui apa pun tentang aksinya atau syaratnya; dan tidak ada grant, dasar kepemilikan, maupun kebijakan yang dapat membuat pemanggil yang belum terdaftar lolos. Status pendaftaran dibaca segar pada setiap keputusan bertanda dan tidak pernah dimemoisasi di cache baca otorisasi — disable mandiri atau reset administratif harus berlaku pada permintaan berikutnya.

`evaluateFieldAccessInTransaction` menerapkan pemeriksaan yang sama, sehingga field yang dijaga kunci bertanda bukan jalan memutar dari endpoint; ia mengetahui apakah permintaan memakai kredensial mesin dari konteks terotorisasi (`authorizeInTransaction` menyetel `viaMachineCredential`), bukan dari argumen yang bisa dilupakan pemanggil. `POST /api/v1/access/evaluate` menerapkannya pada pendaftaran milik pemanggil sendiri agar pratinjau sepakat dengan endpoint. Pemanggil any-of (`defineTenantRoute`, `loadAdminScreen`) memunculkan `MFA_ENROLMENT_REQUIRED` lebih dulu daripada `ACCESS_DENIED` generik milik kandidat lain. Seam kunci-injeksi untuk test bersifat **hanya-menambah** (digabung dengan registry), sehingga tidak pernah dapat mempersempit penegakan. **Tidak ada migrasi**: tanda dideklarasikan di kode dan tidak pernah dibaca dari kolom database, dengan alasan yang diberikan ADR-0053 §3 untuk `scope` — tanda yang dapat dihapus sebuah baris adalah persyaratan yang hilang oleh satu `UPDATE` sementara semua pemeriksaan tetap hijau.

### 2. Opsi yang dipertimbangkan dan alasan memilih ini

**Di mana persyaratan dideklarasikan**

| Opsi                                                    | Keamanan                                                                | Operabilitas                                                                             | Kompatibilitas                                                                                              | Putusan                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **A. Tanda pada descriptor izin (dipilih)**             | Modul yang tahu izinnya berbahaya menyatakannya, di kode yang dirilis   | Tidak ada pengaturan tenant yang bisa terlupa; tanpa biaya untuk permintaan tak bertanda | Field descriptor aditif; template hilir menandai izinnya sendiri tanpa mengubah berkas hulu                 | **Dipilih**                                               |
| B. Registry pusat di dalam `identity_access`            | Sama                                                                    | Setiap penulis modul mengedit modul keamanan untuk melindungi kodenya sendiri            | Bentuk yang dihapus ADR-0134 untuk konsumen domain-event; template hilir harus menambal berkas hulu         | Ditolak                                                   |
| C. Tabel kebijakan per tenant (tenant memilih izinnya)  | Terlemah: persyaratan sekuat ketelitian tenant                          | Satu layar lagi dan satu hal lagi yang tidak dimiliki tenant baru                        | Butuh migrasi dan default; tenant yang tak pernah membuka layarnya adalah yang tak terlindungi — PS-13 lagi | Ditolak                                                   |
| D. Memakai `required_for_privileged` sebagai jawabannya | Kasar: memaksa setiap pemegang non-baca mendaftar, dan hanya saat login | Se-tenant, default `optional`                                                            | Tidak ada yang baru dibangun, dan tidak ada yang menutup celah saat izin dijalankan                         | Tetap sebagai tuas tenant yang terpisah; bukan jawabannya |

**Di mana ditegakkan**

| Opsi                                                                        | Keamanan                                                                                                                                                                                                                                          | Operabilitas                                                                                                                                                                                                                                                                                                                | Putusan     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Saat izin dijalankan, di chokepoint (dipilih)**                           | Satu tempat yang dilalui setiap jalur grant: role, grup, penugasan business-scope, akses terdelegasi, grant menyeluruh milik owner, backup yang dipulihkan                                                                                        | Orangnya diberi tahu apa yang harus dilakukan pada saat yang penting dan dapat memperbaikinya sendiri; tidak ada yang terhalang diberi role sebelum mendengar persyaratannya                                                                                                                                                | **Dipilih** |
| Saat grant (menolak menugaskan izin bertanda ke orang yang belum terdaftar) | Tidak cukup sendirian: izin sampai ke orang lewat sedikitnya lima jalur, salah satunya transitif (beri role ke grup dan semua anggotanya memegangnya); dan faktor yang dicabut _setelah_ grant meninggalkan pemegang dengan izin tanpa penghalang | Memusuhi: administrator tidak bisa menugaskan role payroll lebih dulu ke orang yang belum diminta mendaftar; owner tenant baru diberi **seluruh katalog** saat pembuatan, sebelum faktor mana pun bisa ada, sehingga penolakan saat grant memblokir pembuatan tenant atau butuh pengecualian yang justru menjadi bypass-nya | Ditolak     |
| Keduanya                                                                    | Tidak menambah apa pun yang belum dijamin gerbang saat izin dijalankan                                                                                                                                                                            | Dua jalur kode yang harus dijaga sepakat di lima permukaan grant dalam modul sensitif                                                                                                                                                                                                                                       | Ditolak     |

Peringatan dini yang akan diberikan penolakan saat grant disediakan sebagai gantinya oleh **laporan kesiapan** (§5), yang dapat mendaftar setiap pemegang — dari setiap sumber grant, lewat fragmen `activeRoleGrants` yang sama dengan chokepoint — tanpa menjadi titik penegakan kedua.

### 3. Apa kata ketiga penolakan, dan mengapa berbeda

- **`not_enrolled`** — orangnya bisa memperbaikinya sekarang: pesan menyebut `/admin/account`, yang butuh sesi dan tanpa izin.
- **`enrolment_unavailable`** — `AUTH_MFA_ENABLED` mati, sehingga tak seorang pun di deployment dapat mendaftar. Pesan menyebut administrator, bukan layar yang tidak bisa menolong. Ini **fail-closed**, sengaja berbeda dari ADR-0027 §9 (di sana _kebijakan login_ yang tak dapat ditegakkan dibiarkan inert): tanda inert di sini diam-diam akan membuka lagi celah yang justru hendak ditutupnya pada deployment yang paling kecil kemungkinannya menyadari. Laporan kesiapan menjadikan konfigurasi itu temuan go-live (§5).
- **`machine_credential`** — kredensial tidak pernah dapat memegang faktor, dan akun yang diikatnya mungkin orang yang punya, sehingga "terdaftar" akan benar untuk permintaan yang tak seorang pun menyajikan apa pun. Ditolak langsung; pesan menyatakan tidak ada jalan perbaikan untuknya.

### 4. Step-up tetap bersyarat; ini bukan step-up tanpa syarat

Gerbang menanyakan apakah faktor **ada**. Ia tidak pernah menuntut bukti baru, tidak pernah memanggil `requireStepUp`, dan sebuah test mengunci hal itu. Aturan dari ADR-0136/0137 tidak berubah dan kini bergigi:

| Orang                 | Sebelum                                | Sesudah                                                                                             |
| --------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tanpa faktor          | diizinkan, tanpa faktor kedua, diaudit | **ditolak beserta jalan untuk mendaftar** (tidak terkunci: semua izin tak bertanda tetap berfungsi) |
| Terdaftar, sesi basi  | step-up wajib                          | step-up wajib                                                                                       |
| Terdaftar, sesi segar | diizinkan                              | diizinkan                                                                                           |

Modul pemilik tetap memanggil `getMfaStatus` + `requireStepUp` persis seperti `password-change.ts`; dengan tanda terpasang, syarat ("punya faktor") tidak lagi bisa dihindari orang hanya dengan tidak mendaftar.

### 5. Bootstrap dan laporan kesiapan

**Tenant tanpa pemegang terdaftar tidak terkunci.** Pendaftaran (`POST /api/v1/auth/mfa/totp/enroll/{start,verify}`) butuh sesi dan tanpa izin, dan berada di luar chokepoint (dikunci oleh test), sehingga jalan untuk membatalkan penolakan atas diri sendiri tidak dapat ditolak. Bootstrap-nya: owner (atau pemegang mana pun) mendaftar di `/admin/account`; permintaan berikutnya langsung dilayani — tanpa restart, tanpa tindakan admin, tanpa perubahan kebijakan. Semua yang tak bertanda tetap berfungsi sepanjang waktu, itulah yang membuat orangnya bisa mencapai layar pendaftaran.

`bun run security:readiness` mendapat dua pemeriksaan:

- **Pendaftaran MFA tersedia saat sebuah izin mewajibkan faktor terdaftar** — `critical`. Bila modul mana pun menandai sebuah izin dan `AUTH_MFA_ENABLED` bukan `true`, tak seorang pun dapat memenuhinya dan setiap aksi bertanda ditolak untuk semua orang.
- **Pemegang izin yang mewajibkan faktor MFA terdaftar sudah terdaftar** — `warning`, tidak pernah `critical`. Mendaftar tenant yang punya pemegang tanpa faktor aktif (hanya id dan jumlah, tanpa nama), dibatasi pada tenant tempat modulnya benar-benar dapat dipakai (pemegang modul yang dinonaktifkan tidak dapat menjalankan apa pun, dan mendaftar owner setiap tenant untuk modul yang tak terjangkau di sana hanyalah kebisingan). Pemegang dalam keadaan itu bukan kerentanan — chokepoint sudah menolaknya — melainkan orang yang akan diminta mendaftar, dan gerbang yang memblokir go-live karenanya menjadikan pendaftaran prasyarat deploy, yaitu kunci yang dihindari ADR ini.

Keduanya lulus dengan lantang, beserta alasannya, selama tidak ada modul yang menandai apa pun (keadaan base ini saat dirilis).

### 6. Yang harus dilakukan `hr_payroll` saat mendarat

Setel `requiresMfaEnrolment: true` tepat pada izin berikut di descriptor-nya (penulisan mengikuti katalog §9 paket itu pada saat itu — matriks menulis aksinya `finalise`):

`payout_accounts.reveal`, `runs.approve`, `runs.finalise`, `runs.pay`, `runs.reverse`, `compensation.approve`, `sod_policy.configure`, `rules.publish`.

Sengaja tidak ditandai: `calculate`, `lock`, `release`, dan keluarga `read`/`create` — menandai izin rutin adalah penguncian yang tidak dipilih tenant. Issue implementasi harus (a) menyetel tanda, (b) tetap memanggil step-up bersyarat, dan (c) membawa test untuk setiap izin bertanda bahwa pemegang yang belum terdaftar menerima `403 MFA_ENROLMENT_REQUIRED` dan pemegang terdaftar dengan sesi basi menerima `403 STEP_UP_REQUIRED`. Redaksi kriteria penerimaan #959 dan #960 diperbarui sesuai (lihat `hr-payroll.md` §17, PS-13).

## Konsekuensi

- **Positif:** kontrol sejenis yang ditunjuk ADR-0136/0137 kini ada (lihat butir negatif pertama tentang seberapa banyak yang dibuktikannya); satu titik penegakan mencakup setiap jalur grant; modul baru melindungi izinnya sendiri tanpa menyentuh `identity_access`; tanpa migrasi, tanpa tabel baru, tanpa pengaturan tenant yang bisa terlupa; biaya nol untuk permintaan tak bertanda (pencarian `Set`); penolakan adalah jalan maju, bukan penguncian.
- **Negatif / trade-off yang diterima:**
  - **Gerbang membuktikan faktor ADA pada akun, bukan bahwa pemilik akun yang memegangnya.** Pendaftaran hanya butuh sesi, sehingga pihak yang memegang kata sandi pemegang yang belum terdaftar dapat masuk, mendaftarkan authenticator miliknya sendiri, lalu lolos gerbang (dan step-up bersyarat) sebagai pemegang itu. Persyaratan ini menutup lubang "tanpa faktor kedua sama sekali" pada PS-13; ia tidak melindungi dari pencurian kata sandi sebelum pemegang yang sah mendaftar. Mitigasinya operasional dan harus dilakukan sebelum izin payroll pertama dapat dipakai: jalankan laporan kesiapan pemegang (§5) **sebelum mengaktifkan `hr_payroll` untuk sebuah tenant** dan minta pemegang yang sah mendaftar lebih dulu, agar faktor pertama pada akun setiap pemegang adalah milik mereka. Perbaikan struktural — memverifikasi ulang kata sandi atau `aal2` untuk memulai pendaftaran bagi pemegang izin bertanda, dan memberi tahu orangnya saat faktor pertama didaftarkan — dilacak di ahliweb/awcms#1004 dan bukan bagian ADR ini.
  - Izin bertanda masih dapat **diberikan** kepada orang yang belum terdaftar. Mereka mengetahuinya saat pemakaian pertama, dan laporan kesiapan menemukannya lebih awal. Itu harga penolakan §2 atas penolakan saat grant.
  - Permintaan bertanda berbiaya dua pembacaan berkunci (identity → principal → faktor aktif). Hanya permintaan bertanda yang membayar.
  - Dengan `AUTH_MFA_ENABLED` mati, izin bertanda ditolak untuk semua orang. Ini disengaja dan dimunculkan sebagai temuan kesiapan `critical`; deployment yang menginginkan payroll harus mengaktifkan pendaftaran.
  - Orang yang mematikan faktornya sendiri (atau yang faktornya direset administrator) kehilangan izin bertanda pada permintaan berikutnya. Memang itu tujuannya, tetapi juga alasan bagi pemegang terdaftar untuk menyimpan kode pemulihannya.
  - Layar role belum menandai izin mana yang mewajibkan pendaftaran. Tindak lanjut.
- **Netral:** `MODULE_CONTRACT_VERSION` 4.2.0 → 4.3.0 dan manifes keluarga mengikutinya. Tidak ada modul base yang menyetel tanda, sehingga radius dampak dalam repo nol secara konstruksi; pemakai pertamanya `hr_payroll` (#957, terblokir DPIA-nya).

## Alternatif yang dipertimbangkan

- **Menjadikan step-up payroll tanpa syarat** — ditolak (§4): ia mengunci permanen semua orang tanpa faktor, termasuk owner tenant.
- **Menyuruh tenant menyetel `required_for_privileged`** — ditolak sebagai jawaban (§2 D): itulah status quo yang ditunjuk ADR-0136/0137, dan itulah yang membiarkan PS-13 terbuka.
- **Menegakkan pada _role_ dari izin itu (role bertanda "butuh MFA")** — ditolak: izinlah unit yang berbahaya, sedangkan role dapat diubah bebas oleh tenant; persyaratan pada role lenyap ketika seseorang memberikan izin itu lewat role lain.
