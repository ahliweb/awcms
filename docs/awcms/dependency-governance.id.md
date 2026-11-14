🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](dependency-governance.md)

<!-- i18n-source-hash: sha256:b480a62846fca8a16be40e3ee5e94a1b75bd869a9734b18a44927f9a1934c036 -->

# Tata kelola dependensi — audit kesegaran dan upgrade atomik

> **Apa ini.** Aturan untuk menjaga pustaka, runtime Bun, dan image container yang
> dipin tetap mutakhir, aman, dan kompatibel **tanpa pernah membawa perubahan
> versi yang belum ditinjau ke produksi**, beserta dua artefak pendukungnya:
> `bun run deps:freshness` (laporan baca-saja) dan register versi yang ditahan
> (`scripts/dependency-held-back.ts`). Issue #1173.
>
> **Apa yang bukan.** Ini bukan upgrade massal dan tidak meng-upgrade apa pun.
> Setiap perubahan versi adalah pull request tersendiri yang ditinjau.

## Prinsip

1. **Laporan bukan upgrade.** Job mingguan hanya membaca registry dan mencetak
   drift. Ia tidak pernah mengubah `package.json`, `bun.lock`, workflow, atau
   Dockerfile, dan tidak membuka pull request. Job terjadwal yang mengubah lock
   adalah upgrade massal senyap yang justru dicegah kebijakan ini.
2. **Satu upgrade, satu pull request.** Satu PR menggeser satu dependensi (atau
   satu himpunan yang terikat erat, seperti `astro` + `@astrojs/node`, atau
   seluruh tempat pin Bun berada). Tujuannya rollback dan pelacakan: bila ada
   yang rusak, satu revert membatalkan satu perubahan.
3. **`bun.lock` dihasilkan Bun, tidak pernah disunting tangan.** Pratinjau dengan
   `bun update <nama> --dry-run`, terapkan dengan `bun update <nama>`. `bun update
--latest` melintasi rentang semver dan dijalankan **hanya setelah upgrade
   disetujui** di issue atau ADR.
4. **UNKNOWN bukan lulus.** Pemeriksaan yang tidak bisa berjalan (registry tak
   terjangkau, kena rate limit, keluaran dalam bentuk yang tidak kita parse)
   dilaporkan sebagai `UNKNOWN`, tidak pernah sebagai "tidak ada drift". Ini
   aturan gagal-tertutup yang sama yang dicatat `deps:audit:check` untuk dirinya.
5. **Pin berarti deterministik.** Versi produksi dipin: versi Bun di
   `packageManager`, langkah `setup-bun`, dan image (`oven/bun:<x.y.z>`, dengan
   digest indeks dicatat di sebelahnya dalam `Dockerfile.production`); `bun
install --frozen-lockfile` di mana-mana. Tidak ada `latest` mengambang di
   jalur menuju produksi.

## Apa yang diaudit, oleh apa

| Permukaan                                                                                          | Dicakup oleh                                                                                                                         | Ritme                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Dependensi langsung (terpasang vs terbaru)                                                         | `bun run deps:freshness` (`bun outdated`)                                                                                            | mingguan, sesuai kebutuhan        |
| Advisory, termasuk transitif                                                                       | `bun run deps:audit:check` (memblokir `high`/`critical`, ada di setiap `bun run check`) dan bagian `bun audit` pada `deps:freshness` | setiap PR; mingguan               |
| Pin runtime Bun vs terbaru di npm                                                                  | `deps:freshness`                                                                                                                     | mingguan                          |
| Image dasar (`Dockerfile.production`, image runner cron dan backup di `deploy/cron/awcms.crontab`) | `deps:freshness` — tag terbaru sebentuk di Docker Hub, dan apakah digest yang dicatat di Dockerfile masih cocok dengan tag-nya       | mingguan                          |
| GitHub Actions (dipin dengan SHA)                                                                  | Dependabot `github-actions`                                                                                                          | mingguan (Sen 09:30 Asia/Jakarta) |
| Dependensi npm, usulan PR                                                                          | Dependabot `bun` (maksimum 5 PR terbuka)                                                                                             | mingguan (Sen 09:00 Asia/Jakarta) |
| Analisis statis                                                                                    | CodeQL (required check)                                                                                                              | setiap PR                         |
| Lisensi dan SBOM pohon dependensi                                                                  | `bun run deps:license:check` (di setiap `bun run check`; menulis SBOM CycloneDX dengan `--out-sbom`)                                 | setiap PR; mingguan               |
| Changelog API provider                                                                             | `bun run deps:provider-changelog:check` (di setiap `bun run check`) terhadap `scripts/provider-api-register.ts`                      | setiap PR; mingguan               |
| SBOM image rilis                                                                                   | `release.yml` (`anchore/sbom-action`)                                                                                                | per rilis                         |
| Versi yang ditahan                                                                                 | `scripts/dependency-held-back.ts` + `tests/dependency-held-back.test.ts`                                                             | berkelanjutan (test)              |

Belum dicakup, dan dikatakan terus terang alih-alih disiratkan: tipe API OMES
Control Center (dilacak bersama pekerjaannya). Changelog API provider WhatsApp,
Telegram, Meta Graph, Mailketing, dan Google FCM dicakup register provider di
bawah; PR upgrade tetap membaca changelog SDK berhadapan-provider secara manual.

**Bukan milik kita.** Runtime Python OMES / Hermes dan sistem operasi di host
tidak dimiliki AWCMS. Itu diaudit di repositori host, terpisah. `awcms-astro`
punya himpunan dependensi dan auditnya sendiri.

## Ritme dan tingkat keparahan

| Kelas                                                | Penanganan                                                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Perbaikan keamanan (advisory `high`/`critical`)      | Mendesak, di luar siklus. Biasanya entri `overrides` untuk paket transitif, tidak pernah `bun update <nama>` (itu menambahkan paketnya sebagai dependensi langsung) — lihat `scripts/dependency-audit-exceptions.ts`. |
| Patch / minor dependensi langsung                    | Satu PR atomik per dependensi (atau himpunan terikat), diambil dari laporan mingguan.                                                                                                                                 |
| Versi major, atau perubahan kontrak dukungan runtime | Hanya setelah ADR dan matriks kompatibilitas. Tidak diambil dari laporan; laporan hanya menyatakan ia ada.                                                                                                            |
| Runtime Bun                                          | PR tersendiri, mengikuti playbook pin-bump di bawah.                                                                                                                                                                  |
| Image dasar                                          | Dinaikkan bersama pin Bun bila itu image Bun; image lain adalah PR tersendiri dengan perubahan Dockerfile/crontab dan pemeriksaan `docker run`.                                                                       |

## Gerbang yang harus dilewati setiap PR upgrade

1. `bun run check` — seluruh rantai, termasuk `deps:audit:check`,
   `family:conformance:check`, typecheck, suite test, dan build. Job `quality` CI
   menjalankan perintah yang sama dan menjadi otoritas.
2. Test integrasi berbasis DB dan smoke Playwright (pemindaian aksesibilitas axe)
   di CI — pustaka yang mengubah perilaku saat runtime muncul di sana, bukan di
   unit test (Bun 1.4.4 menolak `BEGIN` mentah lewat klien ber-pool ditemukan oleh
   suite integrasi).
3. Anggaran aset klien (`bun run build:asset-budget:check`) setelah build bila
   upgrade menyentuh Astro, sebuah integrasi, atau apa pun yang dikirim ke browser.
4. `bun.lock` dibuat ulang oleh Bun dalam PR yang sama; diff hanya menyentuh paket
   yang di-upgrade dan tepi dependensinya sendiri. Diff lock yang menggeser paket
   lain adalah alasan untuk berhenti dan memecah PR.
5. Sebuah changeset (`"awcms": patch` untuk kenaikan dependensi tanpa perubahan
   perilaku).
6. Paket baru atau yang baru menjadi transitif hanya dari penerbit tepercaya;
   atestasi provenance bila npm menerbitkannya; lisensi kompatibel dengan
   repositori; `engines` dan `peerDependencies` terpenuhi; tidak ada skrip instalasi
   baru tanpa tinjauan `trustedDependencies`. SDK yang berhadapan dengan provider:
   baca changelog untuk perubahan API dan tanda tangan webhook sebelum merge.
7. Jangan pernah melewati test yang gagal, jangan pernah `--force`, jangan pernah
   melonggarkan gerbang demi meloloskan upgrade. Upgrade yang merah dipecah atau
   ditahan — dan penahanan dicatat di register.

### Menaikkan pin Bun (playbook)

Versi Bun dipin di beberapa tempat yang harus bergerak bersama; #1102 (1.4.2 ->
1.4.3) dan #1176 (1.4.3 -> 1.4.4) adalah presedennya. Dalam satu PR:
`packageManager` dan `@types/bun` di `package.json`; langkah `setup-bun` pin-saat-ini
di `ci.yml`, `changesets.yml`, `release.yml`, dan `dependency-freshness.yml`;
`Dockerfile.production` (tag image, beserta digest indeks di komentarnya); image
runner cron di `deploy/cron/awcms.crontab`; `CI_BUN_CURRENT` di
`scripts/ci-local.ts` beserta test paritasnya; `awcms-family-compatibility.yaml`;
dokumen yang menyebut pin (family compatibility, ci-local, implementation
blueprint, ADR-0032); `bun.lock` dibuat ulang lewat Bun yang baru. Lantai
`engines.bun` dan sel CI `minimum-supported` **tidak** ikut bergerak bersama pin —
itu keputusan kontrak dukungan ADR-0032, tercatat di register versi yang ditahan.
Dependabot tidak dipakai untuk image Bun: kenaikan hanya di Dockerfile akan
meninggalkan pin lain tertinggal.

## Rollback

- **Kode dan lock:** revert PR upgrade. Revert mengembalikan `package.json` dan
  `bun.lock` bersamaan; CI memverifikasi ulang dengan `bun install
--frozen-lockfile`. Karena tiap PR memuat satu upgrade, revert menghapus tepat
  perubahan itu.
- **Runtime Bun / image dasar:** revert PR pin. Untuk image yang sudah di-deploy,
  deploy ulang tag `oven/bun:<x.y.z>` sebelumnya; tag dipin, tidak pernah
  `latest`, dan digest indeks sebelumnya ada di riwayat Dockerfile.
- **Jangan pernah** memulihkan lock dengan menyunting tangan, dan jangan pernah
  `git checkout` satu berkas dari PR upgrade — `package.json` dan `bun.lock` adalah
  satu kesatuan.
- Bila revert diperlukan karena upgrade ternyata tidak aman, tambahkan entri
  versi-ditahan dalam PR yang sama agar laporan berikutnya tidak mengusulkannya
  lagi tanpa tinjauan.

## Memakai laporan

```bash
bun run deps:freshness                          # laporan markdown di stdout
bun run deps:freshness --json                   # manifes, terbaca mesin
bun run deps:freshness --out-json m.json --out-md r.md
bun run deps:freshness --strict                 # exit 1 kecuali semuanya bersih
```

Untuk setiap permukaan di atas ia mencetak terpasang vs pembaruan-dalam-rentang vs
terbaru beserta kelas drift (patch / minor / major), ringkasan advisory, pin Bun vs
npm, tiap image yang dipin vs tag terbaru sebentuk dan digest-nya, serta register
versi yang ditahan. **Tidak ada satu pun yang ditulis balik ke repositori.**

Exit code: drift saja tidak pernah menggagalkan (hampir tiap minggu ada, dan
laporan yang selalu merah tidak dibuka). Dengan `--strict` ia exit 1 bila ada
bagian `UNKNOWN`, advisory `high`/`critical` yang belum tertangani, entri
versi-ditahan yang kedaluwarsa atau usang, atau digest image tercatat yang tak lagi
cocok dengan tag-nya.

Workflow terjadwal `.github/workflows/dependency-freshness.yml` menjalankannya tiap
Senin 02:00 UTC (09:00 Asia/Jakarta) dan lewat `workflow_dispatch`, hanya dengan
`contents: read`. Laporan masuk ke ringkasan run dan manifes JSON diunggah sebagai
artefak (90 hari) — itulah manifes mingguan yang dapat diaudit. Run merah berarti
"lihat laporan ini", bukan bahwa sesuatu diubah.

### Mengubah laporan menjadi pekerjaan

- Pilih **satu** baris. Buka issue (atau pakai yang ada) yang menyebut paket,
  versi terpasang dan target, serta sumbernya (`bun outdated` pada tanggal
  laporan), lalu kerjakan upgrade dalam PR sendiri dengan gerbang di atas.
- Baris yang sengaja tidak diambil masuk ke **register versi yang ditahan**, bukan
  ke komentar.
- `bun outdated` melaporkan pembaruan dalam-rentang terpisah dari yang terbaru:
  paket dengan pembaruan dalam-rentang (`astro 7.4.0 -> 7.4.2`) bisa diambil tanpa
  menyentuh `package.json`; yang terbarunya di luar rentang adalah perubahan
  rentang, dan untuk major, sebuah ADR.

## Lisensi dan SBOM

`bun run deps:license:check` membaca `bun.lock` (diurai skrip, hanya Bun),
membaca lisensi tiap paket dari `node_modules/<pkg>/package.json` yang terpasang,
dan gagal bila sebuah lisensi di luar `ALLOWED_LICENSES` di
`scripts/dependency-license-policy.ts`. `--out-sbom <berkas>` menulis SBOM
CycloneDX 1.6 untuk pohon yang sama (purl, SHA-512 dari integrity lock, lisensi,
dan sisi dependensi yang diselesaikan mengikuti penyarangan lock).

- **Ekspresi dievaluasi, bukan dicocokkan sebagai teks.** `A OR B` lolos bila salah
  satu sisi diizinkan, `A AND B` butuh keduanya, `X WITH Y` adalah satu lisensi yang
  harus terdaftar persis, dan ekspresi yang tak bisa diurai ditolak.
- **Pengecualian adalah entri beralasan yang kedaluwarsa** di `LICENSE_EXCEPTIONS`:
  paket (atau `keluarga-*`), lisensi yang dideklarasikannya, alasan dapat diterima,
  pemilik, tanggal tinjau. Ia hanya meloloskan paket itu pada lisensi itu: paket yang
  berganti lisensi menjadi pelanggaran lagi. Pengecualian yang tak cocok dengan apa
  pun itu basi dan gagal; yang lewat tanggal tinjau juga gagal, begitu pula yang
  tanggalnya bukan `YYYY-MM-DD` sungguhan dalam 400 hari (`"never"` kalau tidak
  tak akan pernah kedaluwarsa).
- **Tidak ada copyleft yang diizinkan secara global.** Paket `MPL-2.0` dan `LGPL`
  masing-masing adalah pengecualian bertanggal, jadi paket baru menghentikan
  gerbang alih-alih lolos lewat daftar yang ditulis untuk paket lain. Arti
  redistribusi dicatat di berkas kebijakan: `Dockerfile.production` menyalin
  `node_modules` `--production` ke image runtime, sehingga paket yang terjangkau
  runtime (`lightningcss`, dijangkau lewat `astro` -> `vite`, dan biner libvips
  milik `sharp`) IKUT terkirim, masing-masing dengan berkas lisensinya sendiri dan
  tanpa modifikasi; paket `axe-core` khusus tes tidak. Memodifikasi atau
  membundel salah satunya butuh ADR sebelum tanggal baru.
- **Tak terbaca bukan bersih.** Paket yang lisensinya tak bisa dibaca (tak ada di
  disk, tak ada field) dilaporkan `UNKNOWN` dan gagal; jalankan `bun install` dulu.
  Paket opsional yang tak dipasang instalasi biasa (biner platform, fallback wasm)
  dihitung dan didaftar sebagai tidak terpasang di sini: lisensinya ditandai belum
  terverifikasi di SBOM, tidak dikarang.
- **Pemakaian ulang di workspace turunan.** Gerbang tak mengandaikan tata letak repo
  ini: `--root <dir>` menunjuk akar workspace yang memuat `bun.lock`, `package.json`
  dan `node_modules`, dan `--policy <berkas>` mengganti `ALLOWED_LICENSES` /
  `LICENSE_EXCEPTIONS` dengan milik workspace itu. Workspace yang membenamkan repo
  ini memegang berkas kebijakannya sendiri; ia tidak mengubah yang ini
  (ahliweb/awcms-one#471 adalah konsumen yang jadi acuan rancangan ini).

## Changelog API provider

`scripts/provider-api-register.ts` mencatat, per permukaan provider yang diajak
bicara kode (Meta Graph untuk Facebook Pages, Meta WhatsApp Cloud, Fonnte,
StarSender, Telegram Bot API, Mailketing, Google FCM HTTP v1, Cloudflare API,
Cloudflare Turnstile, GitHub REST API, dan TikTok sebagai `planned`), versi atau
permukaan yang dipakai, URL changelog, pemilik, dan tanggal terakhir seorang
maintainer membaca changelog itu. `bun run deps:provider-changelog:check`
menegakkan:

1. **Register -> kode.** Tiap literal `pins` harus muncul **tepat satu kali** di
   berkasnya, sehingga literal yang berulang (atau dikutip di komentar) tak
   membiarkan satu salinan dinaikkan tanpa diketahui; pin satu konstanta yang
   diekspor. Mengubah versi di kode tanpa register membuat gerbang gagal. Pin
   hanya melihat nilai bawaan kode, bukan override lingkungan deployment
   (misalnya `WHATSAPP_META_API_VERSION`): tanyakan nilai yang terpasang saat
   tinjauan.
2. **Kode -> register.** Setiap berkas sumber non-tes yang menyebut host provider
   harus didaftarkan entri aktif. Konektor baru yang tak didaftarkan gagal. Aturan
   itu hanya melihat host yang sudah ada di `PROVIDER_HOSTS`, maka
   `tests/provider-changelog-check.test.ts` juga mengekstrak setiap host `https://`
   di sumber non-tes dan mewajibkannya menjadi host provider atau tercantum di
   peta `NOT_A_PROVIDER` tes itu beserta alasannya: integrasi keluar baru tak bisa
   menyelinap tanpa ada yang memilih. Entri
   `planned` tidak memiliki berkas; host-nya muncul di sumber gagal sampai entri
   dijadikan `active` dengan tinjauan pertama.
3. **Jam.** `lastReview` (atau `recordedOn` selama `null`) ditambah `maxAgeDays`
   adalah tenggatnya; lewat itu gerbang merah. Dalam 14 hari ia peringatan dan
   workflow mingguan membuat issue. `--skip-age` hanya menjalankan aturan 1 dan 2.
   Jam tak punya tuas lain: `recordedOn` dan `lastReview` tak boleh di masa depan
   dan `maxAgeDays` dibatasi 180. Entri membawa interval berbeda (90 sampai 150
   hari) agar tidak jatuh tempo pada hari yang sama dan memerahkan semua PR
   terbuka sekaligus; bahwa pemeriksaan usia ada di `bun run check` adalah
   pertukaran yang disengaja, dan peringatannya datang lewat issue mingguan, yang
   membuat job gagal (bukan senyap) bila issue tak bisa dibuat.

`lastReview` diisi orang yang membaca changelog, tidak pernah oleh skrip dan tidak
pernah dimajukan demi menghijaukan gerbang; `null` berarti "dicatat dari kode,
belum ditinjau" dan laporan menyebutnya. Gerbang tidak mengambil URL changelog:
pemeriksaan PR tak boleh bergantung pada pihak ketiga yang hidup. Untuk workspace
turunan: `--register <berkas>` (mengekspor `PROVIDER_REGISTER` dan
`PROVIDER_HOSTS`), `--src <dir>` dan `--root <dir>`.

## Issue dari putaran mingguan

Job `file-issues` pada workflow terjadwal menjalankan `bun run deps:issues:sync`
atas manifes freshness dan temuan kedua gerbang di atas. Itu satu-satunya
penulisan yang dimiliki workflow (`issues: write`, hanya pada job itu).

- **Satu issue terbuka per temuan.** Tiap temuan punya kunci stabil (tak pernah
  hitungan hari atau digest); sidik jarinya adalah penanda tersembunyi di badan
  issue. Satu putaran mendaftar issue terbuka berlabel `dependency-finding` dan
  hanya membuat temuan yang belum punya penanda terbuka.
- **Menutup bukan menyembunyikan.** Issue yang ditutup padahal temuannya masih
  benar dibuat lagi pada putaran berikutnya.
- **Tanpa spam.** Paling banyak 10 per putaran (`--max-create`); sisanya ditunda
  dan dibuat pada putaran berikutnya. Ia tak pernah mengedit, berkomentar, atau
  menutup issue. Bila daftar issue terbuka gagal diambil atau mungkin terpotong,
  tidak ada yang dibuat. Langkah workflow berjalan dengan `shell: bash`
  (`-eo pipefail`) agar kegagalan itu, atau create yang gagal, memerahkan job
  alih-alih lenyap di balik `| tee`.
- **Teks pihak ketiga tidak dipercaya.** Penanda hanya dihormati sebagai baris
  pertama badan, dan teks temuan (field `license` dependensi, judul advisory)
  dinetralkan penanda komentarnya dan `@`-nya di luar code span sebelum masuk ke
  issue publik.
- Dry run secara bawaan (`bun run deps:issues:sync --findings f.json --freshness m.json`);
  `--create` menulis. `workflow_dispatch` manual membuat issue hanya dengan input
  `create_issues`.

## Register versi yang ditahan

`scripts/dependency-held-back.ts` mendaftar versi yang sengaja kita pertahankan:

| Kolom         | Arti                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `packageName` | Seperti nama di registry; `bun` mewakili runtime Bun.                                                           |
| `heldVersion` | Versi atau lantai yang kita pertahankan.                                                                        |
| `reason`      | Temuan apa yang membuat versi lebih baru tidak aman sekarang — bukan "risiko".                                  |
| `owner`       | Siapa yang memutuskan dan siapa yang membenarkannya kembali.                                                    |
| `reviewDate`  | Tanggal ISO. Setelahnya, `tests/dependency-held-back.test.ts` gagal sampai entri dibenarkan ulang atau dihapus. |

Entri juga bisa menjadi **usang**: bila versi yang ditahan tak lagi tertinggal dari
registry, `deps:freshness --strict` melaporkannya agar dihapus alih-alih dibiarkan
sebagai sesuatu yang tak lagi benar. Drift yang belum dievaluasi siapa pun tidak
termasuk di sini (itu backlog), dan advisory yang tak bisa diperbaiki masuk ke
`scripts/dependency-audit-exceptions.ts`.
