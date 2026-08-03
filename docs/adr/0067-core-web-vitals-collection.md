# ADR-0067 — Pengumpulan Core Web Vitals: keputusan, bukan cacat

- **Status:** Proposed — **menunggu keputusan pemilik produk**
- **Tanggal:** 2026-08-04
- **Pengambil keputusan:** @ahliweb (belum diambil)
- **Terkait:** [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §5 (rekomendasi #7), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (cache tepi), [ADR-0064](0064-foreign-key-columns-must-be-index-reachable.md) (gerbang performa pertama)

> **Kenapa ADR ini `Proposed` dan bukan `Accepted`.** Enam rekomendasi lain dari
> asesmen 4 Agustus 2026 sudah mendarat. Yang ini **tidak**, dengan sengaja: ia
> satu-satunya yang bukan memperbaiki cacat, melainkan **menambah pengumpulan
> data tentang pengunjung nyata** — dan itu bertabrakan dengan postur yang modul
> tujuannya sudah nyatakan. Keputusannya milik pemilik produk, bukan milik orang
> yang menulis asesmennya.

## Konteks

### 1. Yang benar-benar hilang

Repo ini melayani HTML nyata: `/news/**` (ADR-0059), `/blog/{tenantCode}/**`
(ADR-0009), dan 31 layar admin. **LCP / INP / CLS tidak pernah diukur di mana
pun**, dan tidak ada anggaran ukuran aset.

Akibatnya spesifik dan bisa dinyatakan: seluruh investasi cache tepi
([ADR-0042](0042-varnish-edge-cache-auto-activation.md),
[ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md), 11 surface)
**dibuktikan ke beban origin, tidak pernah ke pengalaman pengguna**. Kita tahu
query database berkurang. Kita tidak tahu apakah halamannya terasa lebih cepat.

Standar yang relevan: **Core Web Vitals** (Google) sebagai metrik lapangan, dan
**ISO/IEC 25010 — Performance efficiency (time behaviour)** sebagai payungnya.

### 2. Kenapa ini BUKAN sekadar "tambah tabel di `visitor_analytics`"

Modul itu mendeklarasikan dirinya **privacy-first**, dan bukan sebagai slogan:
`purgeVisitorAnalyticsData` melakukan DELETE/UPDATE-to-null **tanpa langkah
arsip**, dengan alasan tertulis bahwa detail pengunjung mentah/nyaris-mentah
**sengaja tidak disimpan lebih lama dari perlu**, sehingga mengarsipkannya justru
melawan postur modulnya sendiri.

Sampel Core Web Vitals adalah **telemetri per-kunjungan**: URL, timing, dan —
kalau ingin berguna — petunjuk perangkat/koneksi. Itu persis kelas data yang
modul itu putuskan untuk diminimalkan. Menambahkannya diam-diam akan menjadi
pembalikan keputusan desain yang tak seorang pun minta.

## Pilihan, dan trade-off yang sebenarnya

### Opsi A — Tidak mengumpulkan (status quo)

Tidak ada data lapangan. Performa tetap dinilai lewat proxy: jumlah query
(rekomendasi #6, sudah mendarat), hit-rate cache tepi, latensi origin.

**Untuk siapa ini cukup:** deployment yang halamannya sederhana dan yang
pertanyaannya "apakah origin sanggup", bukan "apakah pengunjung menunggu".

### Opsi B — Agregat saja, tanpa baris per-kunjungan

Skrip klien mengirim satu sampel; server **langsung meng-agregasi** ke bucket
per-(tenant, rute-ter-normalisasi, hari) — menyimpan hitungan + persentil
p75, **tidak pernah baris mentahnya**. Tak ada URL penuh, tak ada identitas, tak
ada join ke sesi.

**Yang didapat:** p75 LCP/INP/CLS per rute — persis angka yang Core Web Vitals
definisikan sebagai ambangnya, dan cukup untuk menjawab "apakah cache tepi
memperbaiki pengalaman".

**Yang dibayar:** tak bisa men-drill ke satu kunjungan lambat. Diterima menurut
pembacaan ini: mendiagnosa SATU kunjungan lambat adalah pekerjaan APM, bukan
pekerjaan CMS, dan justru drill-down itulah yang menuntut menyimpan data mentah.

**Konsisten dengan postur modul?** Ya — agregasi di titik masuk berarti tak ada
detail pengunjung mentah yang pernah tersimpan, jadi `purge` tidak punya apa-apa
untuk dihapus dan janji privasi modulnya tidak berubah.

### Opsi C — Baris mentah + retensi

Simpan sampel per-kunjungan, purge lewat `dataLifecycle`.

**DITOLAK dalam draf ini.** Ia membalik keputusan eksplisit modul demi kemampuan
(drill-down) yang tak ada satu pun kebutuhan tercatat menuntutnya. Kalau suatu
saat dibutuhkan, ia layak ADR-nya sendiri dengan kebutuhan itu tertulis.

## Rekomendasi

**Opsi B**, bila dan hanya bila pemilik produk memang menginginkan angka
lapangan. Kalau tidak, **Opsi A adalah jawaban yang sah** dan asesmen sebaiknya
mencatatnya sebagai keputusan, bukan sebagai celah terbuka.

Yang TIDAK direkomendasikan dalam keadaan apa pun: menambahkannya sebagai
"cuma tabel lagi" tanpa keputusan eksplisit, karena postur privasi modul
tujuannya sudah tertulis dan pembalikannya harus terlihat.

## Bila Opsi B diambil, bentuknya

1. Skrip klien kecil (tanpa dependensi) di halaman publik, memakai
   `PerformanceObserver`; melapor sekali saat `visibilitychange`.
2. `POST /api/v1/analytics/vitals` — publik, tak terautentikasi, **ber-rate-limit
   lewat `checkSharedRateLimit`** ([ADR-0066](0066-shared-rate-limiting-and-full-auth-surface-coverage.md)),
   badan dibatasi, rute dinormalisasi ke POLA (`/news/[slug]`) sebelum apa pun
   ditulis.
3. Satu tabel agregat ber-`tenant_id`, FORCE RLS, unik pada
   `(tenant_id, route_pattern, day, metric)`; `UPSERT` yang meng-update hitungan
   - sketsa persentil. **Tidak ada tabel baris mentah.**
4. Ditampilkan di `/admin/analytics` bersama statistik yang sudah ada.
5. Kolom FK-nya wajib lulus `db:fk-index:check` (ADR-0064) sejak migrasi
   pertamanya.

Estimasi: satu migrasi, satu endpoint, satu skrip klien, satu bagian layar —
sebanding dengan modul kecil, bukan dengan tambalan.
