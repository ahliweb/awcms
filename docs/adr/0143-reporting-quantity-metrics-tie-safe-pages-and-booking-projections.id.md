🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0143-reporting-quantity-metrics-tie-safe-pages-and-booking-projections.md)

<!-- i18n-source-hash: sha256:12c5cae901ca895e8306cd36a206a4d9f97bdb93b0cf9c9a0316906ee06d2fc8 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0143 — Engine reporting menjumlah kuantitas, tak pernah mengakhiri halaman di tengah satu milidetik, dan `booking` menyumbang tiga proyeksi

- **Status:** Diterima
- **Tanggal:** 2026-10-15
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #944 (ADR ini dan implementasinya); [ADR-0131](0131-generic-booking-module-admission.id.md) (modul booking, yang menyebut "dua proyeksi"); [ADR-0126](0126-generic-multi-location-stock-ledger-module-admission.id.md) dan [ADR-0128](0128-generic-procurement-supplier-receiving-transfer-module-admission.id.md) (proyeksi domain terdahulu dan aturan "hanya counter monotonik"); [`docs/awcms/booking.md`](../awcms/booking.id.md) §7.2; `src/modules/reporting/README.md`.

## Konteks

Issue #944 meminta `booking` menyediakan proyeksi occupancy, pipeline hold, lead time, pembatalan, no-show, dan utilization "terdaftar pada engine reporting yang ada, tanpa engine analitik kedua". Dua batas engine itu menghalangi, dan satu keputusan terdahulu perlu penunjuk.

1. **Engine hanya menghitung baris.** `ProjectionCursorMetricRule` menambah satu per baris sumber yang cocok. "Berapa unit-malam terpesan" adalah SUM: stay dua malam pada tiga unit adalah enam, dan kuantitas itu bukan hitungan baris apa pun.
2. **Engine bisa kehilangan baris di batas halaman.** Scan membaca `ORDER BY cursor LIMIT n` dan melanjutkan pada `cursor + 1 ms` (presisi `Date` cursor tersimpan). Sumber yang menulis beberapa baris dalam satu transaksi memberi mereka `created_at` yang sama (`DEFAULT now()` adalah awal transaksi): baris riwayat `created` dan `held` satu reservasi booking adalah pasangan semacam itu. Bila halaman berakhir di antara keduanya, baris kedua jatuh dalam milidetik yang dikecualikan dan tak pernah dihitung, baik pada keadaan tunak maupun rebuild, dan rekonsiliasi melaporkan ketidakcocokan yang tak diperbaiki rebuild mana pun. Tiga sumber pertama yang dibungkus engine punya timestamp berbeda, jadi butuh kebetulan; sumber multi-baris-per-transaksi tidak.
3. ADR-0131 menyebut modul punya "dua proyeksi". Modul kini mendaftarkan tiga, karena counter kuantitas terbelah menurut granularitas waktu dan stay (booking.md §7.2).

## Keputusan

### 1. `sumColumn`: aturan metrik boleh menjumlah kolom alih-alih menghitung baris

`ProjectionCursorMetricRule.sumColumn?: string` (`MODULE_CONTRACT_VERSION` **4.5.0**, MINOR: penambahan murni; menghilangkannya berarti "hitung baris yang cocok", arti semua aturan yang ada).

- **Hanya increment.** Aturan ber-`sumColumn` harus `effect: "increment"`. Store menjepit di nol, sehingga decrement kuantitas akan menyimpang diam-diam; `reporting:projections:registry:check` menolak kombinasinya.
- **Integer aman non-negatif, atau pass melempar error.** Kolom harus berisi integer non-negatif pada setiap baris sumber (`bigint` Postgres datang sebagai string dan di-parse). Selain itu (negatif, pecahan, `NULL`, non-numerik, melebihi `Number.MAX_SAFE_INTEGER`) melempar error, transaksi pass di-rollback dan kegagalan dicatat pada proyeksi (freshness `failed` setelah jumlah yang dikonfigurasi). Engine tak pernah membulatkan atau memaksa kuantitas menjadi angka yang salah.
- **Satu definisi delta.** `domain/projection-metric-delta.ts` (`computeRuleDelta`) dipakai worker inkremental dan rebuild; rekonsiliasi menghitung kuantitas yang sama sebagai `SUM(col)` (atau `COUNT(*)`), sehingga reconcile dan rebuild tak bisa berbeda tentang nilai yang benar.
- **Identifier seaman kolom lain:** snake_case, divalidasi di registry dan lagi saat SQL dibangun.

### 2. Batas halaman: baris pengintip, tak pernah mengakhiri halaman di tengah satu milidetik

Kedua scan (keadaan tunak dan rebuild) membaca `limit + 1` baris. Baris tambahan adalah PENGINTIP: tak pernah diproses. `trimIncompleteTail` (`reporting/domain/cursor-boundary.ts`) lalu memutuskan:

- kurang dari `limit + 1` baris: sumber habis; halaman utuh;
- pengintip berada di milidetik LEBIH LAMBAT dari baris terakhir halaman: halaman persis `limit` baris seperti biasa (perilaku untuk timestamp berbeda tak berubah);
- pengintip sebaya milidetiknya dengan baris terakhir halaman: halaman membuang baris ekornya pada milidetik itu. Baris yang dipertahankan lebih awal tegas dari yang dibuang, sehingga yang dibuang berada pada `>= cursor + 1 ms` dan pass berikutnya membaca seluruh kelompok seri.

**Kasus sisa: `limit + 1` baris dalam SATU milidetik.** Tak ada yang lebih awal untuk dijadikan akhir. Mempertahankan halaman akan melewati sisa milidetik secara diam-diam, dan membuang semuanya akan menghentikan cursor selamanya. Maka engine **gagal dengan keras**: pass melempar error, transaksi di-rollback (tak ada yang diterapkan, cursor tidak bergerak) dan proyeksi mencatat kegagalan, yang tampak sebagai freshness `failed` dan di error run rebuild. `batchLimit` deskriptor lalu dinaikkan di atas kelompok seri (batas 2 000 terhadap milidetik berisi 2 001 baris riwayat butuh satu transaksi yang menulis ribuan baris; booking menulis paling banyak segelintir). Ini perbaikan konfigurasi, bukan kehilangan data.

**Tindak lanjut (belum dibangun): cursor keyset pada `(cursorColumn, id)`.** Ia menghapus pad milidetik dan kasus sisa sepenuhnya, dengan biaya kolom cursor kedua dan migrasi `awcms_reporting_projection_cursors`. Dicatat sebagai perbaikan semestinya; ADR ini mengambil yang lebih kecil yang membuat kasus multi-baris-per-transaksi benar hari ini.

**Konsekuensi untuk proyeksi yang sudah ada:** proyeksi `cursor_table` atas sumber multi-baris-per-transaksi (`procurement.*`, `inventory.*` dan lainnya) mungkin pernah kehilangan baris di batas halaman sebelum perubahan ini. Deployment sebaiknya **me-rebuild** proyeksi itu sekali setelah upgrade (`POST /api/v1/reports/projections/{key}/rebuild`); rekonsiliasi yang melaporkan ketidakcocokan adalah sinyalnya. Proyeksi atas sumber satu-baris-per-timestamp (decision log, identities, sync nodes) tidak terpengaruh.

### 3. `booking` mendaftarkan tiga proyeksi (mengubah "dua" pada ADR-0131)

`booking.reservations` (hitungan transisi per jenis, `late_cancelled` subset `cancelled`), `booking.time` (detik layanan terpesan dan terlepas) dan `booking.nights` (unit-malam terpesan dan terlepas), semuanya `cursor_table` atas `awcms_booking_reservation_events`, dibaca dengan `booking.reports.read`, setiap metrik counter yang hanya naik (neto adalah `booked - released`, dihitung saat baca, sehingga rebuild menghasilkannya kembali). "Dua proyeksi" pada ADR-0131 digantikan hitungan ini; sisa ADR-0131 tetap berlaku.

Sumbernya tabel riwayat append-only, bukan sembilan event domain yang live: rebuild selalu re-scan tabel, sehingga keadaan tunak dan rebuild adalah scan yang sama, dan tabel ditulis dalam transaksi transisi itu sendiri, bukan setelah dispatcher outbox jalan. Kuantitas distempel pada baris saat tulis oleh trigger (`sql/244`), karena baris append-only, tidak seperti baris alokasi, tak pernah berubah. Rincian dan route laporan langsung: [`docs/awcms/booking.md`](../awcms/booking.id.md) §7.2.1.

## Konsekuensi

- Satu field kontrak opsional dan satu perubahan perilaku engine, keduanya tercakup tes unit dan tes integrasi yang gagal tanpa perbaikan batas.
- Sumber dengan milidetik patologis kini gagal dengan keras, bukan kehilangan baris diam-diam.
- Operator sebaiknya me-rebuild proyeksi multi-baris-per-transaksi yang ada sekali setelah deploy.
- Cursor keyset tetap perbaikan struktural dan menjadi tindak lanjut tercatat.

## Alternatif yang dipertimbangkan

- **Engine analitik kedua atau agregat SQL langsung untuk booking.** Ditolak oleh issue dan ADR-0126/0128: ia memecah freshness, rebuild, dan rekonsiliasi.
- **Menghitung baris per-malam alih-alih menjumlah (satu baris event per unit-malam).** Melipatgandakan tabel riwayat hingga 366 per stay dan membuat tabel yang dipertahankan, tak pernah dipurge, tumbuh menurut panjang stay.
- **Proyeksi `domain_event` untuk booking.** Butuh protokol penundaan rebuild dan bergantung pada dispatcher outbox untuk angka dashboard.
- **Selalu membuang milidetik terakhir halaman penuh tanpa pengintip.** Mengubah ukuran halaman untuk sumber yang tak pernah seri dan menunda satu baris tunggal satu pass tanpa guna.
- **Mengatasi seri dengan mempertahankan halaman utuh.** Melewati sisa milidetik diam-diam; ditolak demi kegagalan keras di atas.
