🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0135-day-granularity-stays-admitted-into-booking-v1.md)

<!-- i18n-source-hash: sha256:278da51047d39129fb0d0c998c930e1eaded898e421fdfcdecacb044e8ea3562 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0135 — Menginap berbasis hari (per malam) diterima ke booking v1

- **Status:** Diterima
- **Tanggal:** 2026-10-10
- **Pengambil keputusan:** ahliweb
- **Mengubah:** [ADR-0131](0131-generic-booking-module-admission.id.md) (§2 mendapat constraint deklaratif kedua di samping yang pertama, §3 mendapat interval tanggal di samping instant, dan asumsi tercatat di pack bahwa menginap per malam check-in/check-out berada di luar v1 ditarik) — amandemen, bukan pengganti; semua isi ADR-0131 yang tidak disebut di sini tetap berlaku
- **Terkait:** Issue #931; keputusan pemilik DoR hilir `ahliweb/awcms-one` O2, dijawab 10 Okt 2026 ([`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md)); [`docs/awcms/booking.md`](../awcms/booking.id.md) §2.5 (semantik waktu menginap), §3.1 (pemetaan menginap), §4 (kamus data), §8.1 aturan 7 dan §8.3 T9–T13 (double-booking dan tes wajib), §11 (O2 dan sub-pertanyaan terbuka)

## Konteks

ADR-0131 menerima `booking` sebagai klaim atas satu unit resource untuk sebuah **interval waktu**: setiap klaim adalah `tstzrange` UTC, dan pack mencatat, sebagai asumsi menunggu keputusan pemilik O2, bahwa menginap per malam (hari check-in/check-out) **di luar v1**. Pada 10 Oktober 2026 pemilik awcms-one menjawab O2: **vertikal pertama adalah hotel / vila / rental**, dan — karena itu bertentangan dengan asumsi di atas — meminta **perubahan cakupan di upstream**, bukan solusi lokal di konsumen.

Menginap bukan slot waktu yang panjang, dengan alasan yang terasa sejak pelanggan pertama:

- Satuan jualnya adalah **malam**, konsep kalender pada zona properti itu sendiri. Mengungkapkannya sebagai `tstzrange` di antara dua instant "tengah malam" membuat jumlah malam bergantung pada aturan daylight-saving zona itu (satu malam bisa 23 atau 25 jam), dan pembaruan basis data zona akan diam-diam menggeser arti "malam 5 Oktober".
- **Pergantian tamu di hari yang sama** (tamu A keluar tanggal 12, tamu B masuk tanggal 12) adalah kasus normal, bukan kasus tepi. Dengan instant ia butuh buffer palsu agar berarti "kamar kosong dari jam check-out sampai jam check-in"; dengan tanggal ia hanyalah dua interval setengah-terbuka yang bersebelahan.
- **Jam** check-in dan check-out (misalnya 14:00 dan 12:00) menyatakan kapan tamu boleh tiba dan harus keluar. Itu informasi bagi tamu dan resepsionis, bukan bagian dari apa yang tidak boleh tumpang tindih.
- Properti harus bisa mengeluarkan kamar dari penjualan untuk satu malam atau seminggu (pemeliharaan) dengan cara yang **tidak bisa di-double-book terhadap tamu**.

## Keputusan

### 1. Resource punya mode booking: `slot` atau `stay`

`resources.booking_mode` ∈ {`slot` (perilaku ADR-0131, default), `stay`}. Unit resource `stay` hanya diklaim oleh alokasi menginap dan unit resource `slot` hanya oleh alokasi slot; trigger menegakkan bahwa granularitas alokasi sama dengan mode resource-nya, sehingga kedua jenis klaim tak pernah berebut satu unit dan kedua constraint di bawah tak perlu direkonsiliasi. Mode tidak bisa berubah selama resource punya alokasi hidup. Modul sama, tabel sama, state machine sama, port sama, model izin sama — tanpa modul baru.

### 2. Menginap adalah interval tanggal lokal setengah-terbuka

Menginap adalah `[check_in_date, check_out_date)`: **tanggal kalender lokal pada zona waktu IANA resource**, check-in inklusif, check-out eksklusif. **Malam**-nya persis tanggal-tanggal dalam interval; jumlah malam = `check_out_date − check_in_date` adalah aritmetika tanggal, sehingga perubahan daylight-saving tidak dapat mengubahnya. Satuan hunian adalah **(unit, malam)**. Karena interval setengah-terbuka, menginap yang berakhir tanggal 12 dan yang mulai tanggal 12 tidak tumpang tindih (**pergantian tamu di hari yang sama diizinkan secara konstruksi**). `check_in_date < check_out_date`, dan satu menginap paling lama 366 malam (batas 366 hari yang sudah ada, dinyatakan dalam tanggal).

### 3. Jam check-in dan check-out adalah konfigurasi, bukan hunian

Setiap resource menginap membawa jam check-in lokal dan jam check-out lokal pada zona yang sama (default tenant di pengaturan). Keduanya dipakai untuk menurunkan **instant** kedatangan dan kepergian (`starts_at`, `ends_at`), yang melayani tampilan, jendela kedatangan, lead time, batas pembatalan terlambat, grace no-show, dan payload event. Keduanya **bukan** bagian dari uji tumpang-tindih apa pun. Penurunannya memakai aturan gap dan fold RFC 5545 §3.3.5 yang sudah dipakai pack §2.2, dan — seperti setiap reservasi — zona, jam lokal, dan instant turunan **disnapshot ke item** saat dibuat dan menjadi fakta sesudahnya (perubahan konfigurasi atau tzdata kemudian tidak pernah menggeser menginap yang sudah terkonfirmasi).

### 4. Double-booking: constraint eksklusi deklaratif kedua, pada tanggal

`awcms_booking_resource_allocations` mendapat bentuk menginap dan constraint parsial kedua di samping yang didefinisikan ADR-0131 §2:

```
EXCLUDE USING gist (resource_unit_id WITH =, daterange(stay_from, stay_to, '[)') WITH &&)
  WHERE (released_at IS NULL AND granularity = 'stay')
```

Ia memakai ekstensi `btree_gist` dan biaya yang sudah diterima ADR-0131 §2, alokator yang sama (unit bebas pertama dalam urutan deterministik, `INSERT … ON CONFLICT DO NOTHING RETURNING`, semua-atau-tidak-sama-sekali untuk beberapa unit), urutan kunci yang sama, reklamasi malas hold kedaluwarsa yang sama, dan penanganan `23P01` yang sama. Satu menginap tetap pada **satu unit** untuk semua malamnya di v1.

**Malam terblokir** (pemeliharaan, dipakai pemilik) disimpan sebagai **baris alokasi tanpa reservasi**, dimiliki satu baris `resource_blocks`, sehingga berbagi constraint yang sama. Blok karenanya tidak bisa tumpang tindih dengan menginap hidup (ditolak dengan `BLOCK_CONFLICT`, yang tidak membatalkan apa pun), dan menginap tidak bisa ditaruh pada malam terblokir; pemenang balapan antara blok dan booking ditentukan database, bukan oleh pengecekan. Blok adalah eksklusi keras dan, tidak seperti penutupan jadwal, tidak pernah bisa di-override.

**Mengapa constraint rentang dan bukan buku besar unit-malam** (satu baris per `(unit, malam)` di bawah indeks unik biasa — alternatif utama):

| Kriteria                  | `EXCLUDE` daterange (dipilih)                                                                                                      | Buku besar unit-malam                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keamanan / RLS            | Deklaratif, berlaku bagi setiap penulis kini dan nanti; pemeriksaan constraint tidak tunduk pada RLS, sehingga isolasi tak melemah | Jaminan sama dari indeks unik, tetapi klaim N baris harus semua-atau-tidak-sama-sekali lintas N probe unik dan trigger harus menjaga baris sama dengan tanggal item — invariant kedua |
| Performa                  | Satu baris dan satu probe GiST per klaim; indeks yang sama menjawab "apakah rentang ini bebas" untuk ketersediaan                  | N baris per menginap (hingga 366) untuk disisipkan, dilepas, dan dijadwal ulang, dan N probe btree; penghitungan per malam lebih murah dibaca                                         |
| Kesederhanaan / perawatan | Satu mekanisme, sama dengan slot (ADR-0131 §2); satu bentuk tes; reschedule adalah lepas-satu-sisip-satu                           | Mekanisme berbeda dari slot; reschedule menyentuh 2N baris; tetapi SQL biasa, dan pelaporan per malam adalah `GROUP BY`                                                               |
| Biaya                     | Tidak ada di luar ADR-0131                                                                                                         | Tanpa ekstensi, tetapi lebih banyak baris dan amplifikasi tulis                                                                                                                       |

Bentuk rentang menang pada konsistensi dengan mekanisme yang sudah diterima dan pada biaya tulis. Satu-satunya keunggulan nyata buku besar — agregat per malam — dipenuhi dengan membaca rentang alokasi (`generate_series` atas menginap) atau counter proyeksi di pack §7.2, tak satu pun membutuhkan sumber kebenaran kedua.

### 5. Pemetaan ke state machine reservasi dan event: field, bukan state atau event baru

State machine ADR-0131 §5 tidak berubah: `held → confirmed → checked_in → completed`, `held → expired`, `held | confirmed → cancelled`, `confirmed → rescheduled`, `confirmed → no_show`. Untuk menginap, `checked_in` adalah kedatangan tamu dan `completed` adalah check-out; tidak ada state `checked_out` yang ditambahkan. Sembilan event provisional tidak berubah dan **tidak ada event ditambahkan**; payload-nya mendapat field tambahan aditif (`stays[]` berisi `checkInDate`, `checkOutDate`, `nights`, `timezone`) dan selebihnya seperti sebelumnya. Rinciannya, termasuk hold, reschedule, no-show, dan check-out lebih awal, ada di pack §3.1.

### 6. Yang ditunda

Tarif per malam dan rate plan, minimum menginap yang bergantung tanggal dan pembatasan hari kedatangan, pindah kamar di dalam satu menginap (satu menginap adalah satu unit), perpanjangan atau pemendekan di tempat atas menginap yang sudah check-in, entitas `property` yang mengelompokkan tipe kamar, dan event channel-manager untuk blok **tidak** diterima di sini; semuanya dicatat sebagai sub-pertanyaan terbuka di pack §11.

## Konsekuensi

- Vertikal pertama (hotel / vila / rental) dapat dilayani tanpa mesin booking lokal di konsumen, dan jaminan double-booking adalah jaminan deklaratif yang sama untuk kedua jenis klaim.
- **Biaya:** satu tabel (`resource_blocks`), beberapa kolom pada `resources`, `service_offerings`, `reservation_items`, `resource_allocations`, dan `settings`, satu constraint eksklusi parsial lagi, tiga izin (`blocks.read`, `blocks.create`, `blocks.release`), beberapa kode penolakan baru, dan lima tes regresi wajib lagi (T9–T13). Tanpa ekstensi baru, tanpa modul baru, tanpa job baru, tanpa event baru.
- **Belum dibangun.** Tak ada di ADR ini yang membuat migrasi, path OpenAPI, atau channel AsyncAPI. Event provisional di `asyncapi/provisional/` dan `docs/awcms/cross-domain-contracts.md` belum mendaftar field menginap yang aditif; PR fase 1 modul menambahkannya saat event menjadi hidup.
- Daftar "tidak diterima di v1" ADR-0131 tidak berubah, dengan amandemen ini: menginap berbasis hari diterima; kapasitas terhitung tanpa baris unit, best-fit packing, dan turnaround bersama tetap di luar.
- **Sub-pertanyaan terbuka** yang belum dijawab pemilik didaftar di pack §11, bukan diputuskan di sini.

## Alternatif yang ditolak

- **Menjaga menginap di luar v1 dan membiarkan konsumen membangunnya lokal.** Pemilik memilih vertikal ini lebih dulu dan meminta perubahan cakupan di upstream; mesin lokal di konsumen adalah duplikasi per-vertikal yang ditolak ADR-0131, dengan properti kebenaran tersulit ditulis dua kali.
- **Memodelkan menginap sebagai `tstzrange` di antara dua instant tengah malam (atau di antara instant check-in dan check-out).** Jumlah malam dan kebersebelahan lalu bergantung pada DST dan jam yang dikonfigurasi, pergantian tamu di hari yang sama butuh buffer palsu, dan pembaruan tzdata mengubah arti. Tanggal adalah tipe domain yang benar.
- **Buku besar unit-malam.** Lihat §4: sah, tetapi mekanisme kedua, hingga 366 baris per menginap, dan invariant kedua yang harus dijaga sama dengan tanggal item.
- **Modul `lodging` terpisah atau modul khusus hotel.** Menginap adalah satu granularitas lagi dari klaim, alokator, state machine, dan port yang sama; modul kedua menduplikasi keempatnya dan memaksa setiap konsumen memilih.
- **Interval tanggal tertutup atau inklusif (`[check_in, check_out]`).** Pergantian tamu di hari yang sama lalu tampak seperti tumpang tindih dan setiap aturan kebersebelahan butuh kasus khusus; setengah-terbuka sudah menjadi konvensi pack untuk setiap interval.
- **Menjadikan jam check-in dan check-out bagian dari uji tumpang-tindih.** Ia membuat ketersediaan bergantung pada konfigurasi yang berubah, dan pada aturan DST zona, yang justru cacat yang dihapus bentuk tanggal.
