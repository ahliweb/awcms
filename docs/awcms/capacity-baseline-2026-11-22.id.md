🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](capacity-baseline-2026-11-22.md)

<!-- i18n-source-hash: sha256:1a340f8b2ff269550462db50b8910e822c34cedc08585582812ce103b737b9cd -->

# Baseline kapasitas, 22 November 2026 (LOKAL; bukan bukti NFR)

> **Ini baseline LOKAL, bukan bukti NFR ADR-0161 mana pun.** Diukur di
> workstation developer yang dipakai bersama, dengan app, database, dan
> generator beban di mesin yang sama, tanpa CDN, tanpa edge cache, dan
> PostgreSQL di tmpfs dengan `fsync=off`. Ia menunjukkan bahwa harness bekerja
> dan di mana batas pertama origin tanpa cache berada. Baseline mirip-produksi
> menunggu keputusan environment di #1281 dan merupakan run tersendiri (issue
> #1283 tetap terbuka).

Metode dan perkakas: [`load-testing.id.md`](load-testing.id.md). Target:
[ADR-0161](../adr/0161-capacity-targets-are-measured-nfrs-and-the-scale-path-is-staged.id.md).

## Environment

| Butir           | Nilai                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host            | Satu workstation kelas laptop: Intel Core i7-13650HX generasi ke-13, 20 CPU logis, RAM 31 GB, Linux 6.8. **Dipakai bersama**: build, tes, dan container lain berjalan, load average 8 sampai 16 selama run (puncak CPU host 85% sampai 95%). |
| App             | Image `Dockerfile.production`, `APP_ENV=production`, role `awcms_app` dan `awcms_setup` (RLS berlaku), `EDGE_CACHE_MODE=off`, container dibatasi **2 CPU** (`docker update --cpus 2`) agar dapat dibandingkan dengan "per node 2 vCPU".      |
| Database        | PostgreSQL 18 dalam container di tmpfs, `fsync=off`, tanpa batas CPU. Tenant sintetis, 50 post terbit.                                                                                                                                       |
| Generator       | 3 proses k6 (`grafana/k6:1.1.0`, `--k6-docker`) di host yang sama, laju agregat dibagi rata. k6 tidak terpasang di host; image Docker dipakai. Tidak ada mesin kedua, jadi generator tidak berada di host terpisah.                          |
| Profil          | `baseline`: ramp 60 detik, **tahan 60 detik**, turun 15 detik (lebih pendek dari bawaan 5 menit). `spike`: 30 iterasi/detik selama 2 menit, 10x dalam 60 detik, tahan 60 detik, kembali.                                                     |
| Run             | Run id `lt-local1122`, satu environment sementara untuk semua run di bawah, dihancurkan sesudahnya.                                                                                                                                          |
| Beban generator | CPU k6 sendiri antara 1,1% dan 4,9% dari seluruh host; tidak ada run yang menjatuhkan lebih dari 0,01% iterasi. Generator tidak pernah menjadi batas.                                                                                        |

**Dasar penerimaan.** Pemeriksaan saturasi bawaan menilai generator dari CPU
seluruh host. Di host bersama ini nilainya 85% sampai 95% di setiap run,
sehingga pemeriksaan bawaan menolak semuanya karena alasan yang tidak ada
hubungannya dengan generator (hal yang sama terjadi pada uji coba 15
November). Run ini digabung dengan `--cpu-basis process`, yang menilai CPU
proses k6 sendiri (CPU k6 di atas) dan mencetak CPU host dan load di
sampingnya. "Diterima" di bawah berarti **generator bukan batasnya**; itu
**tidak** berarti host sepi. Tetangga mungkin mengambil CPU dari app dan
database, sehingga setiap angka cenderung pesimistis dan tidak ada yang dapat
diulang dengan ketelitian lebih baik dari margin lebar (lihat baris 400 dan 500
iterasi/detik).

## Arti "laju" di sini

Satu iterasi adalah satu tampilan halaman atau satu panggilan API. Satu
tampilan halaman publik adalah **dua permintaan HTTP**: origin menjawab
`/blog/<tenant>/<post>` dengan 307 ke path berawalan locale dan k6
mengikutinya. Laporan menampilkan kedua hitungan; tabel di bawah memakai
**iterasi per detik** (tampilan halaman per detik, atau panggilan API per
detik) kecuali tertulis "permintaan".

## Hasil

Semua run: 3 generator, `--cpu-basis process`, tanpa HTTP 429, tanpa iterasi
dijatuhkan yang berarti. Latensi adalah nilai generator terburuk (batas
konservatif); persentil tidak dapat digabung persis. Rata-rata permintaan/detik
dihitung atas seluruh run termasuk ramp.

### Halaman publik di origin (skenario 2), tanpa cache

| Target iter/dtk | Rata-rata permintaan/dtk | p50 ms | p95 ms | p99 ms | 5xx    | Ambang k6 | CPU app rata-rata / puncak (dari 200%) | CPU DB rata-rata / puncak |
| --------------- | ------------------------ | ------ | ------ | ------ | ------ | --------- | -------------------------------------- | ------------------------- |
| 300             | 421                      | 3,2    | 6,9    | 14,3   | 0%     | lulus     | 53% / 99%                              | 32% / 61%                 |
| 400             | 558                      | 4,5    | 130,0  | 353,0  | 18,77% | **gagal** | 69% / 124%                             | 46% / 83%                 |
| 500             | 700                      | n/a    | 121,8  | 238,0  | 14,98% | **gagal** | tidak disimpan                         | 57% / 88%                 |
| 900             | 1.262                    | 34,8   | 183,8  | 622,2  | 72,37% | **gagal** | 92% / 117%                             | 49% / 93%                 |

Baris 400 dan 500 tidak monoton (run 400 melayani lebih sedikit permintaan dan
gagal lebih parah daripada run 500). Itu ulah tetangga: workstation yang sama
menjalankan pekerjaan lain pada run pertama dan run-run berikutnya. Satu-satunya
kesimpulan adalah rentangnya: **300 iterasi/detik lulus bersih, 400 ke atas
tidak.**

**Batasnya adalah pool database, bukan CPU.** Pada 400 ke atas app mencatat
`database.pool.rejected` untuk work-class `interactive` lebih dari 150.000 kali
sepanjang run (8 koneksi aktif, antrean 32 penuh) dan menjawab 5xx. Rata-rata
app berada di 35% sampai 46% jatah 2 CPU-nya (puncak 58% sampai 62%) saat itu.
Dengan edge cache mati, setiap render publik mengambil satu koneksi dari pool,
sehingga langit-langitnya adalah ukuran pool itu dan antreannya. Ini sejalan
dengan petunjuk uji coba 15 November.

### Skenario 1 (halaman publik lewat CDN)

**Tidak dijalankan.** Environment sementara tidak punya CDN dan belum ada
environment berCDN yang disetujui (#1281). Skenario 1 dan rasio cache hit tetap
terbuka.

### Baca admin terautentikasi (skenario 3), `GET /api/v1/offices`

| Target iter/dtk | Rata-rata permintaan/dtk | p50 ms | p95 ms | p99 ms | 5xx    | Ambang k6 | CPU app rata-rata / puncak | CPU DB rata-rata / puncak |
| --------------- | ------------------------ | ------ | ------ | ------ | ------ | --------- | -------------------------- | ------------------------- |
| 300             | 210                      | 8,3    | 20,4   | 42,0   | 0,03%  | lulus     | tidak disimpan             | 94% / 156%                |
| 600             | 420                      | 30,1   | 125,9  | 171,5  | 12,92% | **gagal** | 74% / 103%                 | 176% / 277%               |

Di sini CPU database, bukan app, yang naik (PostgreSQL tidak dibatasi CPU dan
mencapai hampir 3 core); pada 600 laju 5xx lagi-lagi penolakan pool.

### Tulis API terautentikasi (skenario 4), `POST /api/v1/blog/posts`

| Target iter/dtk | Rata-rata permintaan/dtk | p50 ms | p95 ms | p99 ms | 5xx | Ambang k6 | CPU app rata-rata / puncak | CPU DB rata-rata / puncak |
| --------------- | ------------------------ | ------ | ------ | ------ | --- | --------- | -------------------------- | ------------------------- |
| 60              | 42                       | 10,9   | 22,7   | 34,1   | 0%  | lulus     | 17% / 80%                  | 26% / 44%                 |
| 150             | 105                      | 9,5    | 12,7   | 16,1   | 0%  | lulus     | 27% / 50%                  | 53% / 114%                |

Penulisan tidak didorong sampai batasnya.

### Lonjakan (10x dalam 60 detik, ADR-0161)

Halaman publik di origin, 30 iterasi/detik selama 2 menit, lalu 300
iterasi/detik tercapai dalam 60 detik dan ditahan 60 detik: p50 2,3 ms, p95
4,7 ms, p99 7,6 ms, maks 96,6 ms, **5xx 0%**, ambang lulus. CPU app 23%
rata-rata / 73% puncak, database 16% / 55%. Faktor 10x bertahan, tetapi
puncaknya (300 iterasi/detik) persis tingkat yang mampu dipikul run berkelanjutan,
sehingga ini menunjukkan bentuknya bekerja, bukan bahwa lonjakan lebih besar
akan lolos.

## Terhadap nilai awal ADR-0161

Angka lokal dengan catatan di atas; tidak ada yang menutup sebuah NFR.

| Nilai awal ADR-0161                                     | Run ini                                                                                                                                          | Putusan                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Origin dinamis: 2.000 rps per node 2 vCPU, p95 < 500 ms | 300 tampilan/dtk bersih (421 permintaan/dtk), p95 6,9 ms; batas antara 300 dan 400 tampilan/dtk, ditentukan pool DB interactive, edge cache mati | **Tidak berlaku tanpa cache**: sekitar 15% dari target pada host yang berebut. Hanya dapat berlaku bila edge cache yang bekerja, yang tidak dapat ditunjukkan setup ini. Perlu run dengan cache hidup. |
| Baca admin p95 <= 500 ms, tulis <= 900 ms               | baca p95 20 ms pada 300 panggilan/dtk, tulis p95 23 ms pada 60 panggilan/dtk, pada database tmpfs yang cepat                                     | **Berlaku di sini**, tetapi tmpfs dan `fsync=off` menguntungkan penulisan. Perlu database berdisk dan konkurensi per tenant yang dinyatakan.                                                           |
| Lonjakan 10x dalam 60 detik, 5xx <= 1%                  | 5xx 0% pada 30 sampai 300 iterasi/dtk                                                                                                            | **Berlaku hanya pada skala ini.** Perlu lonjakan dengan puncak di atas langit-langit berkelanjutan untuk tahu apa yang terjadi melewatinya.                                                            |
| Rasio hit >= 99%                                        | tidak terukur                                                                                                                                    | **Terbuka**: perlu environment berCDN.                                                                                                                                                                 |

Nilai yang perlu direvisi: belum ada berdasarkan bukti ini. Nilai origin tampak
tak tercapai **tanpa** edge cache; apakah 2.000 rps dipertahankan sebagai target
dengan edge hidup atau dirumuskan ulang adalah keputusan pemilik setelah ada run
dengan cache hidup. Ukuran pool interactive (8) dan antrean (32) adalah hal
pertama yang perlu divariasikan run mirip-produksi.

## Yang TIDAK diukur

- Perilaku CDN dan rasio hit (skenario 1).
- Apa pun di host yang sepi, mesin generator terpisah, atau PostgreSQL berdisk.
- Tahan 5 menit; tiap run ditahan 60 detik.
- Edge cache hidup (`--edge-cache`), Redis, connection pooler.
- Metrik p95 di dalam app (issue #1287 belum selesai), sehingga latensi hanya
  dari k6.
- Keterulangan: tiap titik dijalankan sekali.

## Mengulang

```bash
bun run loadtest:env:up -- --run-id lt-local1122 --posts 50
set -a; . "$XDG_RUNTIME_DIR/awcms-loadtest-lt-local1122/loadtest.env"; set +a
docker update --cpus 2 awcms-lt-lt-local1122-app-1   # opsional: memodelkan node 2 vCPU
export LOADTEST_TARGET_APPROVED=lt-local1122
bun run loadtest:run -- --run-id lt-local1122 --base-url "$LOADTEST_BASE_URL" \
  --tenant-code "$LOADTEST_TENANT_CODE" --scenario public-page --profile baseline \
  --target-rps 300 --generators 3 --hold 60s --k6-docker
bun run loadtest:merge -- --run-id lt-local1122 --generators 3 --cpu-basis process
bun run loadtest:env:down -- --run-id lt-local1122
```

CPU app dan database berasal dari `docker stats` sekali per detik selama tiap
run; koneksi database dari `pg_stat_activity` (puncak 41 di setiap run).
