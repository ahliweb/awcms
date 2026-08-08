# ADR-0067 — Pengumpulan Core Web Vitals: keputusan, bukan cacat

- **Status:** Accepted (belum diimplementasikan)
- **Keputusan:** Opsi D (mendarat 5 Agustus 2026) + **Opsi B** (diputuskan 8 Agustus 2026, belum dibangun — §Adendum 2026-08-08)
- **Tanggal:** 2026-08-04 (keputusan RUM: 2026-08-08)
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §5 (rekomendasi #7), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (cache tepi), [ADR-0064](0064-foreign-key-columns-must-be-index-reachable.md) (gerbang performa pertama)

> **Kenapa ADR ini `Proposed` selama empat hari.** Enam rekomendasi lain dari
> asesmen 4 Agustus 2026 sudah mendarat. Yang ini **tidak**, dengan sengaja: ia
> satu-satunya yang bukan memperbaiki cacat, melainkan **menambah pengumpulan
> data tentang pengunjung nyata** — dan itu bertabrakan dengan postur yang modul
> tujuannya sudah nyatakan. Keputusannya milik pemilik produk, bukan milik orang
> yang menulis asesmennya.
>
> **Keputusan itu diambil pada 8 Agustus 2026 — lihat §Adendum 2026-08-08.**

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

### Opsi D — Pengukuran LAB, dan ia ortogonal terhadap A/B/C

> **Ditambahkan 4 Agustus 2026 (asesmen putaran kedua §9.9).** Draf pertama ADR
> ini menawarkan tiga opsi yang **semuanya RUM** — semuanya mengumpulkan data
> dari pengunjung nyata. Itu membuat seluruh keputusan bertabrakan dengan postur
> privasi `visitor_analytics`, dan karena itu menunggu. Ada jalan keempat yang
> tidak pernah ditimbang, dan ia tidak menunggu apa pun.

Jalankan Lighthouse/Playwright terhadap build sendiri di CI. **Nol** data
pengunjung: tidak ada skrip klien, tidak ada endpoint publik, tidak ada tabel,
tidak ada sentuhan pada `visitor_analytics`. Repo ini **sudah** memasang
Playwright dan punya suite E2E ber-gerbang env, jadi biayanya konfigurasi, bukan
kemampuan baru.

**Yang membuatnya bukan pengganti A/B/C:** lab dan lapangan menjawab pertanyaan
yang berbeda, dan menukar satu dengan yang lain adalah kesalahan yang jauh lebih
umum daripada tidak mengukur sama sekali.

| Pertanyaan                                           | Dijawab oleh |
| ---------------------------------------------------- | ------------ |
| "Apakah perubahan ini membuat halaman lebih lambat?" | **Lab**      |
| "Apa yang benar-benar dialami pengunjung kami?"      | RUM (B)      |

Lab mengukur satu mesin, satu jaringan, satu jalankan — ia **tidak** bisa
menjawab p75 kunjungan nyata, dan menuliskan angkanya seolah bisa akan menjadi
kelas cacat yang dokumen ini ada untuk mencegah. Yang bisa ia lakukan, dan yang
tak bisa dilakukan A: **memerahkan CI** saat sebuah perubahan meregresi LCP di
halaman yang sama pada mesin yang sama.

Batasnya yang harus ikut ditulis kalau opsi ini diambil: sebuah gerbang lab yang
melewati dirinya sendiri saat tidak ada sumber konten adalah gerbang yang
membusuk (`awcms-astro` mencatat persis itu sebagai alasan celah 8-nya tetap
terbuka di repo template). Di sini masalahnya lebih kecil — repo ini punya
tenant dan konten nyata di staging — tetapi gerbangnya tetap harus **menyatakan**
saat ia tidak berjalan.

## Rekomendasi

**Opsi D sekarang, dan Opsi B hanya bila pemilik produk memang menginginkan
angka lapangan.** Keduanya bisa hidup bersama; D tidak menunggu keputusan atas B,
dan itulah alasan utama memisahkannya.

Kalau angka lapangan tidak diinginkan, **Opsi A tetap jawaban yang sah** untuk
bagian RUM — dan dengan D diambil, "tidak mengukur sama sekali" berhenti menjadi
konsekuensinya.

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

## Adendum 2026-08-05 — Opsi D diambil dan mendarat

**Opsi D diimplementasikan**, persis sebagaimana §Rekomendasi menyatakannya
("Opsi D sekarang, tidak menunggu keputusan atas B"). Status ADR ini **tetap
`Proposed`**: yang menunggu keputusan pemilik produk adalah bagian RUM
(Opsi A/B/C), dan adendum ini tidak menyentuhnya.

Bentuknya — nol data pengunjung, nol permukaan baru:

- **Berkas:** `tests/e2e/cwv-lab.e2e.ts` — spec Playwright di harness E2E yang
  sudah ada (bukan harness kedua), mengukur **LCP** dan **CLS** halaman
  `/login` (permukaan publik yang E2E smoke sudah sentuh) via
  `PerformanceObserver` ber-`buffered: true`, dengan CLS dihitung per definisi
  session-window CWV.
- **Gerbang:** env `E2E_CWV_LAB=1`, dinyalakan job CI `e2e-smoke`
  (`.github/workflows/ci.yml`) pada langkah yang sama dengan
  `bun run test:e2e`. Ambang kelulusan = ambang "baik" CWV: LCP ≤ 2500 ms,
  CLS ≤ 0,1.
- **Script:** `bun run perf:cwv:lab` menjalankan spec-nya sendirian terhadap
  server yang disediakan pemanggil (konvensi suite E2E).

Batas yang §Opsi D wajibkan, dan cara adendum ini memenuhinya:

1. **Gerbang yang tidak berjalan menyatakannya.** Tanpa `E2E_CWV_LAB` spec
   mencetak baris `[cwv-lab] SKIP: …` eksplisit dan menandai test skipped —
   tidak pernah lolos senyap. Saat berjalan, LCP yang tidak terekam (observer
   tanpa entry, atau browser tanpa dukungan entry type) adalah **kegagalan**,
   bukan kelulusan.
2. **Angka lab tidak ditulis seolah p75 lapangan.** Konstanta ambangnya
   ber-komentar "angka LAB satu mesin — detektor regresi, bukan p75 lapangan",
   dan log per-run mencetak kalimat yang sama. **INP tidak diukur dan tidak
   diklaim** — tanpa interaksi pengguna nyata ia tidak bermakna di lab.

## Adendum 2026-08-08 — Opsi B diambil; bagian RUM berhenti menggantung

**Pemilik produk mengambil Opsi B.** Bagian RUM yang sengaja ditinggalkan pada
4 Agustus kini punya jawaban, dan ADR ini pindah dari `Proposed` ke
`Accepted (belum diimplementasikan)`.

Yang diambil persis Opsi B sebagaimana tertulis, tanpa pelonggaran:

- **Agregasi di titik masuk.** Server tidak pernah menyimpan sampel per-kunjungan;
  ia meng-`UPSERT` ke bucket per-(tenant, pola rute, hari, metrik). Tidak ada
  tabel baris mentah, tidak ada URL penuh, tidak ada identitas, tidak ada join ke
  sesi.
- **Opsi C tetap DITOLAK.** Kalau drill-down per-kunjungan suatu saat dibutuhkan,
  ia ADR-nya sendiri dengan kebutuhannya tertulis — bukan perluasan diam-diam
  atas keputusan ini.
- **Postur privasi `visitor_analytics` tidak dibalik.** Justru sebaliknya: karena
  tak ada detail pengunjung mentah yang tersimpan, `purge` tidak punya apa pun
  untuk dihapus dan janji modulnya berdiri apa adanya.

### Kenapa statusnya berkualifikasi, dan apa yang menegakkannya

`Accepted (belum diimplementasikan)`, bukan `Accepted` polos, karena tak satu
baris pun dari §"Bila Opsi B diambil, bentuknya" sudah dibangun. Kualifikasi itu
**digerbangi**: ADR ini kini punya entri di peta
`tests/adr-implementation-status.test.ts`, yang menegakkannya dua arah — selama
artefaknya belum ada, kualifikasi wajib; begitu artefaknya mendarat, kualifikasi
wajib dicabut pada PR yang sama.

Artefak yang dipetakan adalah
`visitor-analytics/domain/web-vitals-aggregate.ts` — **agregatnya**, bukan
endpoint-nya dan bukan migrasinya. Itu disengaja: inti Opsi B adalah bahwa baris
mentah tidak pernah disimpan, jadi berkas yang melakukan agregasi adalah
keputusan ini dalam bentuk yang bisa dieksekusi. Memetakannya ke endpoint akan
membiarkan implementasi baris-mentah memuaskan gerbangnya.

### Yang harus dibawa PR implementasinya, di luar §"Bila Opsi B diambil, bentuknya"

`POST /api/v1/analytics/vitals` adalah **permukaan tulis publik tanpa
autentikasi** — kelas permukaan yang paling sedikit dimiliki repo ini. Ia karena
itu wajib membawa, dan di-review sebagai, hal-hal yang permukaan publik lain di
sini sudah bawa:

1. `checkSharedRateLimit` ([ADR-0066](0066-shared-rate-limiting-and-full-auth-surface-coverage.md))
   dan batas badan permintaan, keduanya sebelum satu baris pun ditulis.
2. Normalisasi rute ke **POLA** sebelum penyimpanan, dengan daftar pola yang
   diturunkan dari rute yang benar-benar ada — sebuah `route_pattern` yang
   diterima apa adanya dari klien adalah kolom yang diisi penyerang.
3. Nilai metrik yang divalidasi rentangnya. Sampel tak terbatas dari klien tak
   tepercaya adalah cara paling langsung membuat p75 sebuah tenant tak berarti.
4. `VISITOR_ANALYTICS_ENABLED` tetap menjadi saklarnya. Instalasi baru tetap
   tidak mengumpulkan apa pun sampai operator memilihnya — Opsi B menambah apa
   yang dikumpulkan saat saklar itu menyala, bukan mengubah bawaannya.
