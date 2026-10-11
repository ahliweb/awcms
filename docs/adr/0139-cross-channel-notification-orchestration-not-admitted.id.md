🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0139-cross-channel-notification-orchestration-not-admitted.md)

<!-- i18n-source-hash: sha256:3cac2e3ca838e01eb08890bf2cc02be8d6cb895e20a71b398e95c0f52a51e639 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0139 — Orkestrasi notifikasi lintas-kanal tidak diterima (ditolak untuk saat ini)

- **Status:** Diterima. Keputusan yang dicatatnya adalah **penolakan**: orkestrasi **tidak diterima, untuk saat ini**. (Kosakata status ADR di README ADR tidak memuat `Rejected`; ADR-nya diterima, subjeknya tidak.)
- **Tanggal:** 2026-10-12
- **Pengambil keputusan:** ahliweb (pemilik produk)
- **Menyelesaikan:** klausul "orkestrasi notifikasi TIDAK diterima, menunggu kasus nilai tertulis (O11)" pada [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.id.md) §7. ADR ini adalah kasus nilai tertulis itu, dan jawabannya tidak
- **Terkait:** Issue #966; epik hilir `ahliweb/awcms-one` #280 butir 33 dan keputusan pemilik DoR O11 (dijawab 10 Okt 2026: orkestrasi diinginkan _dengan syarat kasus nilai tertulis dan ADR upstream_); [ADR-0006](0006-offline-first-sync-outbox.id.md), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.id.md), [ADR-0074](0074-push-delivery-is-a-second-outbox.id.md), [ADR-0134](0134-descriptor-declared-domain-event-consumers.id.md), [`docs/awcms/hr-payroll.id.md`](../awcms/hr-payroll.id.md) §15 (kanal pengiriman)

**Hanya dokumen.** ADR ini tidak menambah, mengubah, atau mencadangkan modul, migrasi, path OpenAPI, atau channel AsyncAPI.

## Konteks

ADR-0133 menerima kapabilitas pengiriman khusus WhatsApp dan sengaja meninggalkan tiga hal: **preferensi kanal per pengguna**, **fallback lintas-kanal** ("WhatsApp gagal, kirim e-mail"), dan **status lintas-kanal terpadu**. Ia mengikat dua aturan untuk sementara: port pengiriman khusus kanal (`WhatsappDeliveryPort`, tidak pernah fasad `MessageDeliveryPort(channel, ...)`), dan tak ada modul yang boleh mengimplementasikan fallback otomatis antarkanal. Pemilik awcms-one lalu menjawab O11 sebagai "diinginkan, dengan syarat kasus nilai tertulis". Issue #966 meminta kasus itu dan keputusan terima atau tolak yang eksplisit.

Yang ada di repo ini hari ini, sebagai fakta:

- **Kanal hidup: dua.** `email` (outbox, dispatcher lease, port provider, daftar supresi) dan `push_delivery` (outbox kedua, ADR-0074).
- **Diterima tetapi belum dibangun: dua.** `whatsapp_delivery` (ADR-0133) dan adapter Telegram opsional yang mati secara default (jawaban pemilik O10, yang masih butuh ADR sendiri). Implementasi keduanya belum ada.
- Setiap kanal sudah punya **antrean, dispatcher, port provider, kebijakan retry, circuit breaker, dan deskriptor retensinya sendiri**. ADR-0133 §3 mengikat "satu antrean per kanal per deployment, tidak pernah satu per domain".
- `workflow_approval` punya port notifikasinya sendiri, tak terpengaruh.
- **Tidak ada konsumen bernama** dengan kebutuhan fallback lintas-kanal. Booking butuh pengingat dan konfirmasi; hr_payroll butuh notifikasi shift dan slip gaji yang, menurut ADR-0132 dan ADR-0133 §7, tidak boleh pernah fallback ke kanal lain sama sekali. Keduanya belum meminta "bila X gagal, coba Y".

## Keputusan

**Orkestrasi notifikasi lintas-kanal tidak diterima. Pemilik produk memutuskan menolaknya untuk saat ini.** Konkretnya:

1. Tidak ditambahkan modul, port, tabel, job, atau pengaturan yang dinamai atau dibentuk sebagai orkestrator notifikasi, pusat preferensi, mesin fallback, atau layanan status pengiriman terpadu.
2. Aturan ADR-0133 tetap tidak berubah: port WhatsApp tetap khusus kanal; tidak ada fasad `MessageDeliveryPort(channel, ...)`; **tak ada modul yang mengimplementasikan fallback otomatis antarkanal**; tak ada konsumen yang menambah antreannya sendiri.
3. Pilihan kanal, preferensi, dan fallback apa pun tetap **di tempatnya hari ini: per modul, eksplisit, di pemanggil.** Modul yang butuh "ingatkan lewat WhatsApp, kalau tidak e-mail" memutuskannya sendiri, melakukan enqueue lewat port e-mail atau WhatsApp (masing-masing antreannya sendiri), dan menyimpan catatan sendiri tentang apa yang dikirim. Itu biaya yang sadar dan terlihat; ia diterima.
4. Pertanyaannya **ditutup, bukan dibiarkan terbuka**: ia dibuka kembali hanya bila pemicu di §3 terpenuhi, dan lalu dengan desain terkecil di §4, bukan dengan mengulang analisis.

### 1. Mengapa sekarang waktu yang keliru: kasus nilai, secara jujur

Nilai yang akan diberikan orkestrasi itu nyata secara abstrak: orang yang tak suka WhatsApp tidak dikirimi lewat sana, e-mail yang memantul tetap sampai kepadanya, dan operator melihat satu status per pesan, bukan satu per kanal. Argumen menolaknya **hari ini** bertumpu pada empat fakta, bukan opini tentang gagasannya:

- **Batasan di ADR-0133 adalah bagian tersulit, dan orkestrasi menarik melawan setiap satunya.** Pintu masuk netral-kanal adalah persis fasad multi-kanal yang ditolak ADR-0133. Fallback lintas-kanal harus mengamati kegagalan satu kanal dan memicu enqueue kanal lain, yaitu koordinator di atas outbox-outbox. Melakukannya **di dalam** dispatcher menaruh panggilan provider kedua atau penulisan lintas-antrean ke dalam loop claim-send-finalise kanal pertama. Melakukannya **sebagai** koordinator dengan state durabelnya sendiri adalah tabel keempat berbentuk outbox. ADR-0133 §3 menghabiskan satu bagian panjang untuk menetapkan bahwa repo sudah punya satu antrean lebih banyak dari yang secara harfiah dibolehkan batasan "tanpa outbox kedua", dan bahwa aturan yang penting adalah satu antrean per kanal. Orkestrasi akan menjadi fitur pertama yang butuh antrean yang tidak dimiliki kanal mana pun.
- **Kanal hidup ada dua, bukan banyak.** Fallback di antara dua kanal berarti "e-mail atau push", dan push adalah notifikasi perangkat, bukan pengganti untuk pesan yang harus sampai ke kotak masuk atau nomor telepon seseorang. Kombinasi yang membuat orkestrasi sepadan (tiga kanal atau lebih yang dapat saling menggantikan, urutan preferensi yang stabil) belum ada, dan dua dari empat kanal bahkan belum dibangun.
- **Preferensi dan fallback per modul murah hari ini dan murah dibongkar.** Booking dan hr_payroll masing-masing punya himpunan kelas pesan kecil dan tertutup, masing-masing dengan kanal yang jelas (dan, untuk payroll, "tanpa fallback" yang jelas). Kolom atau pengaturan preferensi per modul hanya beberapa baris, terlihat dalam review modul itu sendiri, dan mudah dihapus bila mekanisme bersama kelak menggantikannya. Mekanisme bersama yang dibangun sebelum konsumen kedua dan ketiga diketahui cenderung membakukan asumsi konsumen pertama.
- **Tidak ada konsumen bernama yang memintanya.** Epik meminta kasus nilai, bukan kebutuhan. Kapabilitas lintas-modul yang dibangun tanpa konsumen tak bisa diuji terhadap lalu lintas nyata, dan kriteria penerimaan ADR-0021 mensyaratkannya.

Ringkasan jujurnya: orkestrasi bisa jadi kapabilitas yang diinginkan platform kelak, dan ia adalah hal termahal untuk dipasang ulang **secara keliru** (fasad atau outbox keempat sulit dicabut setelah konsumen memanggilnya), sekaligus tetap murah ditambahkan **dengan benar** kelak karena setiap kanal hari ini mempertahankan port yang bersih dan terpisah. Menunggu berbiaya sedikit kode per-modul yang terduplikasi; menerimanya lebih awal mempertaruhkan arsitektur yang baru saja ditetapkan ADR-0133.

### 2. Analisis opsi

Empat opsi dibandingkan. Opsi A dipilih.

| Kriteria                 | A. Tidak diterima; pilihan per modul (dipilih)                                                                                | B. Modul orkestrator dengan antrean sendiri ("hub notifikasi")                                                                                                                           | C. Fasad multi-kanal `MessageDeliveryPort(channel, ...)` di atas antrean yang ada                                                                     | D. Resolver kebijakan minimal + fallback berbasis event (desain di §4), dibangun sekarang                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keunggulan               | Tak ada yang dibangun atau dirawat; ADR-0133 utuh; port kanal tetap dapat berevolusi mandiri; perilaku tiap modul eksplisit   | Satu tempat untuk preferensi, fallback, dan status; konsumen menulis satu panggilan                                                                                                      | Satu pintu masuk; pemanggil tak perlu tahu kanalnya; kecil untuk ditulis                                                                              | Permukaan bersama terkecil yang tetap menghapus logika preferensi terduplikasi; tanpa antrean baru; tiap kanal mempertahankan portnya                                       |
| Kekurangan               | Logika preferensi dan fallback bisa terduplikasi per modul; tak ada tampilan status lintas-kanal; perilaku bisa tak konsisten | Tabel keempat berbentuk antrean dengan retry, retensi, dan lease sendiri; jalur kedua ke setiap kanal; hub menjadi dependensi setiap domain                                              | Ditolak ADR-0133 §7 sebagai langkah pertama orkestrasi; semantik kanal (tujuan, consent, templat, bentuk alamat) berbeda sehingga parameternya bocor  | Tetap butuh konsumen untuk merancangnya; aturan kebijakan dan fallback mudah keliru halus tanpa konsumen; satu registry lagi yang harus dijaga sinkron                      |
| Keamanan                 | Terbaik: consent, masking alamat, dan aturan tujuan tiap kanal ditegakkan di satu tempat per kanal                            | Terburuk: hub melihat setiap alamat dan kelas pesan, harus mengimplementasikan ulang consent dan aturan "tak pernah fallback untuk payroll / PII / security", dan target bernilai tinggi | Lebih lemah: satu payload generik mengundang kebocoran PII lintas-kanal (slip gaji atau OTP sampai ke kanal berjaminan lebih rendah karena kegagalan) | Dapat diterima hanya dengan aturan keras §4 (fallback digerbangi kelas, consent per kanal dicek ulang pada enqueue kedua); fallback adalah fitur paling berisiko dan opt-in |
| Performa                 | Tidak berubah                                                                                                                 | Hop dan penulisan ekstra per pesan; antrean bersama menjadi titik kontensi lintas domain                                                                                                 | Overhead dapat diabaikan                                                                                                                              | Satu pembacaan kebijakan per enqueue (dapat di-cache) dan satu konsumen event; rendah                                                                                       |
| Kemudahan perawatan      | Sederhana; duplikasi bersifat lokal dan terlihat                                                                              | Buruk: tiga atau empat sistem terikat oleh koordinator dengan mode kegagalannya sendiri                                                                                                  | Buruk: fasad menumpuk opsi khusus kanal sampai menjadi gabungan semuanya                                                                              | Baik bila dibatasi pada resolver dan konsumen; memburuk bila tumbuh menjadi state machine                                                                                   |
| Skalabilitas             | Tumbuh independen per kanal, sesuai maksud ADR-0133                                                                           | Antrean dan dispatcher hub menjadi bottleneck bersama                                                                                                                                    | Tumbuh bersama kanal                                                                                                                                  | Tumbuh bersama kanal ditambah satu aliran event                                                                                                                             |
| Kompleksitas operasional | Terendah: N dispatcher dan breaker independen                                                                                 | Tertinggi: dispatcher, lease, deskriptor retensi, penanganan dead-letter, dan runbook tambahan                                                                                           | Rendah sampai sedang                                                                                                                                  | Sedang: jalur event kegagalan dan idempotensinya perlu dipantau                                                                                                             |
| Implikasi jangka panjang | Membiarkan pintu ke D terbuka tanpa pernah membangun B atau C; biaya menunggu terbatas                                        | Sulit dicabut setelah konsumen memanggilnya; mengukuhkan antrean non-kanal yang ditolak ADR-0133 §3                                                                                      | Fasad adalah cara paling mungkin jaminan "tanpa fallback / tanpa PII lintas-kanal" terkikis diam-diam                                                 | Menjadi bentuk bawaan saat pemicu pertama terpenuhi, sebab itu ia dispesifikasikan sekarang dan tidak dibangun                                                              |

Opsi A menang pada setiap kriteria yang paling dibobot repo (keamanan, kesederhanaan operasional, menjaga ADR-0133), dan hanya kalah pada kenyamanan, yang murah dibayar selama ada dua kanal hidup dan tak ada konsumen bernama. B dan C ditolak atas dasar ADR-0133 sendiri. D adalah jawaban yang tepat **bila premisnya ada**, dan dicatat di §4 agar hari itu tidak dimulai dari halaman kosong.

### 3. Pemicu pembukaan kembali (semua harus terpenuhi)

ADR ini digantikan ADR yang menerima hanya bila **setiap** kondisi terpenuhi:

1. **Sekurang-kurangnya tiga kanal hidup** (dibangun, di-deploy, dan dipakai di produksi oleh sekurang-kurangnya satu tenant), bukan sekadar diterima. Hari ini: dua hidup, dua diterima. Telegram sebagai yang ketiga tidak cukup bila hanya membawa lalu lintas operator atau yang tak menghadap pengguna.
2. **Modul atau produk konsumen bernama menyatakan kebutuhan lintas-kanal yang konkret**, secara tertulis, dengan kelas pesan dan kegagalan yang harus dilewatinya: kebutuhan nyata "bila kanal X gagal atau tak dipilih, kirim lewat kanal Y", bukan hipotetis. Isu konsumen itu ditautkan dari ADR yang menerima.
3. **Kebutuhan itu tidak dapat dipenuhi per modul** tanpa menduplikasi logika non-trivial ke sekurang-kurangnya dua modul (duplikasinya ditunjukkan, bukan diklaim).
4. **Aturan consent dan kelas pesan sudah tuntas untuk setiap kanal yang terlibat**, termasuk aturan ADR-0133 §7 bahwa pesan payroll, data pribadi, dan kelas `security` tidak pernah fallback.
5. Review keamanan dijadwalkan, karena fallback adalah keputusan aliran data lintas-kanal (aturan modul sensitif di `AGENTS.md`).

Terpenuhinya pemicu **membuka kembali pertanyaan**; ia sendiri tidak menerima apa pun. ADR yang menerima wajib memakai §4 sebagai titik awal dan membenarkan setiap penyimpangan.

### 4. Desain terkecil yang dapat diterima bila dibuka kembali

Dicatat agar pembaca berikutnya tidak mengulang analisis. Ini **spesifikasi batasan**, bukan rencana membangun; semua nama bersifat sementara.

- **Tanpa fasad dan tanpa outbox baru.** Tiap kanal mempertahankan port dan satu antreannya sendiri (ADR-0133 §3). Tak ada dalam desain ini yang menambah antrean atau dispatcher.
- **Resolver kebijakan, hanya-baca, sebagai capability port (ADR-0011).** `resolveChannels(tenantId, recipient, messageClass) -> daftar berurutan {channel}`: ia **mengembalikan keputusan dan tidak mengirim apa pun**. Masukan: preferensi kanal per kelas dan opt-out penerima (tabel kecil per principal/profil dengan RLS, default-deny, dimasking di log), kanal yang diaktifkan tenant, dan kelas pesan. Pemanggil lalu melakukan enqueue lewat port kanal terpilih sendiri. Konsumen yang tidak memanggil resolver berperilaku persis seperti hari ini.
- **Fallback hanya sebagai konsumen domain-event, tidak pernah di dalam dispatcher atau transaksi.** Kanal sudah memancarkan event terminal `*.delivery.failed`. Konsumen fallback, dideklarasikan di descriptor modul pemiliknya (ADR-0134), bereaksi pada kegagalan terminal kanal N dan melakukan enqueue **satu** pesan ke kanal N+1 lewat port kanal itu, dengan kunci idempotensi `{originalKey}:{channelN+1}` agar event yang diputar ulang tak bisa mengirim dua kali. **Paling banyak satu lompatan fallback, tanpa loop**, tanpa retry kanal asal.
- **Fallback opt-in per templat/kelas pesan dan ditolak menurut kelas.** Kelas pesan mendeklarasikan daftar kanal fallback yang diizinkan atau tidak ada; bawaannya tidak ada. **Pesan payroll, data pribadi, OTP, dan kelas `security` tidak pernah boleh mendeklarasikannya** (ADR-0133 §7), ditegakkan oleh pemeriksaan registry di CI, bukan konvensi. Consent dan tujuan dicek ulang terhadap kanal fallback pada enqueue kedua, tidak pernah diwarisi dari yang pertama.
- **Status terpadu sebagai read-model, bukan sumber kebenaran.** Proyeksi berkunci `correlationId` pemanggil menggabungkan state terminal per kanal untuk tampilan (proyeksi bergaya reporting). Baris antrean tiap kanal tetap otoritatif; proyeksi dapat dibangun ulang dan tidak menyimpan alamat penerima polos.
- **Mati secara default**, di balik flag, dengan aturan PII yang ada: event membawa siapa dan apa, tidak pernah nomor telepon atau alamat; setiap perubahan preferensi dan keputusan fallback dicatat audit dengan redaksi.
- **Tes yang diwajibkan sejak awal:** fallback tak pernah menyala untuk kelas yang ditolak; event kegagalan yang diputar ulang melakukan enqueue sekali; consent fallback dicek mandiri; tak ada tabel antrean kedua (pemeriksaan registry); resolver adalah pembacaan murni dan tidak mengirim apa pun.

### 5. Catatan keamanan, performa, dan operasional untuk keputusan ini

- **Keamanan:** penolakan menghapus risiko baru terbesar (aliran data lintas-kanal otomatis). Sampai dibuka kembali, pesan payroll atau data pribadi tak bisa sampai ke kanal lain karena kegagalan, sebab tak ada yang mampu merutekannya.
- **Performa dan skalabilitas:** tidak berubah.
- **Operasi:** tak ada yang perlu di-deploy, dipantau, atau runbook yang perlu ditulis.
- **Kemudahan perawatan:** biayanya duplikasi terbatas dan terlihat di konsumen; mitigasinya adalah pilihan kanal tiap konsumen direview di modulnya sendiri, tempat kelas pesan dan fakta consent berada.

## Konsekuensi

- Issue #966 ditutup oleh ADR ini; epik awcms-one #280 butir 33 ditutup sebagai **ditolak untuk saat ini**, dengan pemicu §3 sebagai syarat pembukaan kembali.
- O11 pemilik dijawab: orkestrasi tetap diinginkan secara prinsip, kasus nilai tertulis menyimpulkan ia prematur, dan pemilik produk menerima kesimpulan itu. Tak ada di awcms-one yang sebaiknya menjadwalkan pekerjaan yang mengandaikan orkestrator notifikasi.
- ADR-0133 §7 dan `docs/awcms/hr-payroll.md` §15 diperbarui untuk menunjuk ke sini. Port WhatsApp tetap khusus kanal dan aturan tanpa-fallback-otomatis berlaku.
- **Biaya keputusan ini:** modul yang menginginkan kanal pilihan atau fallback mengimplementasikannya sendiri dan tidak boleh menyebutnya "orkestrasi"; perilaku antarmodul bisa berbeda. Diterima sampai pemicu menyala.
- Tak ada yang dibangun dan tak ada yang dicadangkan: tanpa migrasi, permission, path OpenAPI, atau channel AsyncAPI.

## Alternatif yang ditolak

- **Modul hub notifikasi dengan antrean sendiri (Opsi B).** Tabel keempat berbentuk outbox, jalur kedua ke setiap kanal, dan dependensi setiap domain. Ditolak atas dasar ADR-0133 §3.
- **Fasad `MessageDeliveryPort(channel, ...)` (Opsi C).** Ditolak ADR-0133 §7; ia mengikis aturan consent, tujuan, dan masking per kanal.
- **Membangun desain minimal sekarang (Opsi D).** Bentuknya benar tetapi prematur: ada dua kanal hidup dan tak ada konsumen bernama, sehingga aturan fallback dan preferensinya akan dirancang terhadap lalu lintas bayangan. Dispesifikasikan di §4 sebagai gantinya.
- **Menerima preferensi saja (tabel preferensi tanpa fallback).** Menggoda sebagai "separuh yang aman", tetapi penyimpan preferensi tanpa konsumen yang memanggilnya adalah data mati dengan biaya retensi dan hak subjek data (ADR-0094); ia bagian dari pembukaan kembali yang sama, bukan sebelumnya.
- **Menunda keputusan lagi tanpa hasil tertulis.** Membiarkan #966 terbuka dan pembaca berikutnya mengulang analisis ini, yaitu kegagalan yang justru hendak dicegah ADR ini.
