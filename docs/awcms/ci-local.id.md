🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](ci-local.md)

<!-- i18n-source-hash: sha256:7bc49d2c9004ca620fd5860aabbde9226afb92c631694a1d818197fa0db9d0e6 -->

# Menjalankan setiap job CI secara lokal (`bun run ci:local`)

> **Apa ini.** Satu perintah yang menjalankan, di mesin Anda, job-job yang
> dijalankan GitHub Actions untuk sebuah pull request — `ci.yml` (`quality`,
> `hygiene`, `integration-tests`, `minimum-supported`, `e2e-smoke`) dan
> `changesets.yml` (`policy-check`) — dengan perintah yang sama dalam urutan yang
> sama, lalu mencetak tabel ringkasan. Issue #1001.
>
> **Apa yang bukan.** Ia tidak menggantikan ruleset. Required status checks di
> ruleset `11653326` tetap menentukan merge, persis seperti sebelumnya
> ([`branch-protection.md`](branch-protection.md)). `ci:local` adalah verifikasi
> **sebelum push**: ia ada agar sebuah branch tidak di-push hanya untuk mengetahui
> apakah ia hijau.

## Mulai cepat

```bash
bun run ci:local                         # semua job
bun run ci:local --job quality           # satu job (boleh diulang: --job a --job b, atau --job a,b)
bun run ci:local --job hygiene --job changesets   # dua yang hanya butuh git

# job ber-database butuh connection string PostgreSQL SUPERUSER:
CI_LOCAL_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/postgres \
  bun run ci:local --job integration --job e2e
```

Commit dulu. Job `changesets` membandingkan riwayat yang **sudah di-commit**
dengan base (`origin/main` secara default, `--base <ref>` untuk mengubahnya),
sehingga changeset yang belum Anda commit tidak terlihat olehnya — runner
memperingatkan bila working tree kotor.

## Job-jobnya

Job berjalan **berurutan**, yang paling murah lebih dulu (urutan di bawah),
karena semuanya berbagi `dist/` dan mesin yang sama.

| Job lokal           | Mencerminkan (`workflow` > job)   | Yang dijalankan                                                                                                                                  | Butuh                          |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `hygiene`           | `ci.yml` > `hygiene`              | grep Bun-only atas script `package.json`; tidak ada berkas `.env` ter-track. Shell workflow, apa adanya.                                         | bash, git                      |
| `changesets`        | `changesets.yml` > `policy-check` | Fetch base, `bun install --frozen-lockfile`, `bun run changesets:policy:check` dengan `CHANGESET_POLICY_BASE_REF=<--base>`.                      | riwayat git dengan merge-base  |
| `quality`           | `ci.yml` > `quality`              | Fetch tag (gerbang `version:check` membutuhkannya), install frozen, `bun run check` **penuh** dengan `DATABASE_URL` kosong.                      | —                              |
| `integration`       | `ci.yml` > `integration-tests`    | Database sementara, install frozen, `bun run db:migrate`, `bun test tests/integration/ --timeout 60000`, lalu daftar berkas suite legacy ad-hoc. | superuser PostgreSQL           |
| `minimum-supported` | `ci.yml` > `minimum-supported`    | Di atas **Bun 1.3.0**: install frozen, `typecheck`, `build`, `family:conformance:check`.                                                         | Bun 1.3.0 (lihat di bawah)     |
| `e2e`               | `ci.yml` > `e2e-smoke`            | Database sementara, migrate, build, menyalakan server, seed lewat `POST /api/v1/setup/initialize`, `bun run test:e2e`.                           | superuser PostgreSQL, Chromium |

Id job workflow (`policy-check`, `integration-tests`, `e2e-smoke`) diterima
sebagai alias `--job`.

## Opsi, hasil, dan exit code

| Opsi           | Efek                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `--job <nama>` | Jalankan hanya job ini. Boleh diulang atau dipisah koma. Job selalu berjalan dalam urutan tetap.          |
| `--base <ref>` | Ref base untuk job `changesets` (default `origin/main`). Ref `origin/<branch>` di-fetch lebih dulu.       |
| `--fail-fast`  | Berhenti di job pertama yang gagal; sisanya dilaporkan sebagai `skipped (not run)`.                       |
| `--keep-going` | Default: jalankan setiap job terpilih meski ada yang gagal, supaya satu run menampilkan semua yang merah. |
| `--allow-skip` | Exit 0 bila tidak ada yang gagal tetapi ada job yang dilewati. Ringkasan tetap berkata INCOMPLETE.        |
| `--list`, `-h` | Daftar job dan padanan workflow-nya; tampilkan bantuan.                                                   |

Dalam satu job, step yang gagal menghentikan job (seperti di Actions). Setiap job
berakhir sebagai salah satu dari tiga hasil, dan **job yang tidak bisa jalan tidak
pernah dilaporkan `PASS`**:

| Hasil     | Arti                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `PASS`    | Setiap step exit 0.                                                                                              |
| `FAIL`    | Sebuah step gagal; detail menyebut step dan exit code-nya. Output child ada di atas tabel.                       |
| `SKIPPED` | Job tidak bisa jalan di sini; alasannya ada di tabel (tanpa URL database, tanpa Chromium, tanpa Bun 1.3.0, ...). |

| Exit code | Verdict      | Kapan                                                                           |
| --------- | ------------ | ------------------------------------------------------------------------------- |
| `0`       | `PASS`       | Setiap job terpilih lulus (atau hanya skip, dengan `--allow-skip`).             |
| `1`       | `FAIL`       | Sedikitnya satu job gagal.                                                      |
| `2`       | `INCOMPLETE` | Tidak ada yang gagal, tetapi sedikitnya satu job dilewati: belum terverifikasi. |
| `64`      | —            | Kesalahan penggunaan (job atau opsi tidak dikenal).                             |

Jadi `bun run ci:local && git push` menolak push setelah sebuah skip, dengan sengaja.

## Prasyarat

- **bash dan git** di `PATH`. Step `run:` workflow adalah skrip bash dan
  dijalankan dengan `bash -e -c`, seperti Actions. Di Windows pakai WSL.
- **Koneksi superuser PostgreSQL** untuk `integration` dan `e2e`, dari
  `CI_LOCAL_DATABASE_URL` (fallback ke `DATABASE_URL`). Ia hanya dipakai sebagai
  _kanal admin_: tiap job membuat database bernama unik
  (`awcms_cilocal_<job>_<pid>_<waktu>`) di server itu, mengarahkan `DATABASE_URL`
  ke sana, dan **menghapusnya ketika job selesai, juga saat gagal atau Ctrl-C**.
  Runner sendiri hanya membuat dan menghapus database itu (migrasi dan harness
  integrasi juga membuat dan mengubah role tingkat-cluster; lihat bagian
  berikutnya). Password tidak pernah dicetak. Role itu harus superuser (milik CI
  begitu): migrasi menjalankan `ALTER ROLE ... SET` pada setting kustom dan
  harness integrasi membuat role.
- **Versi PostgreSQL.** CI memakai `postgres:18.4`. **16 ke atas diterima** (versi
  tempat migrasi dan perilaku RLS diverifikasi, dan yang dipakai container lokal);
  ringkasan mencatat bila bukan 18. **Lebih lama dari 16 ditolak** (job di-skip
  beserta alasannya). Apa pun versinya, job GitHub yang menjadi otoritas untuk
  perilaku spesifik-versi.
- **Bun 1.3.0** untuk `minimum-supported`: `bun` di `PATH` bila persis versi itu,
  jika tidak `bunx bun@1.3.0` (paket npm membawa binary-nya; setelah ter-cache ia
  juga jalan offline). Ia ditaruh paling depan di `PATH` hanya untuk job itu,
  sehingga setiap `bun run` bersarang memakainya. Bila keduanya gagal job
  **di-skip**, tidak pernah dijalankan di Bun yang salah. Job lain memakai `bun`
  di `PATH`; runner mencetaknya di samping versi yang dipin CI (1.4.2), karena Bun
  yang berbeda adalah sumber "hijau di lokal, merah di GitHub".
- **Chromium Playwright** untuk `e2e`. Workflow menjalankan
  `bun run test:e2e:install` (`playwright install --with-deps`), yang butuh
  root/apt dan jaringan, sehingga runner **memverifikasi** browser alih-alih
  memasangnya: revisi yang diharapkan `@playwright/test` terpasang harus ada di
  `PLAYWRIGHT_BROWSERS_PATH` (atau cache default), atau
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` harus menunjuk binary Chromium
  (`playwright.config.ts` menghormatinya). Jika tidak, job di-skip dan
  menyebutkan cara memasangnya.

## Apa yang dilakukannya pada mesin Anda, dan yang perlu dihindari

- **Pakai server PostgreSQL tersendiri** (container sekali-pakai ideal), bukan
  cluster di balik aplikasi dev yang sedang Anda jalankan. Harness integrasi
  membalik role **tingkat-cluster** `awcms_app` dan `awcms_worker` ke `LOGIN` lalu
  kembali ke `NOLOGIN` dengan password fixture, dan migrasi `019`/`022`
  membuatnya. Dua run terhadap satu server karena itu saling mengganggu (gagalnya
  berbunyi "not permitted to log in"), begitu pula apa pun yang login sebagai role
  itu. Di CI setiap job punya server sendiri; di sini itu tanggung jawab Anda.
  Server yang kekurangan koneksi gagal dengan cara yang sama ("too many clients
  already").
- Ia menulis `dist/` (hasil build) dan `playwright/.auth/` (keduanya
  di-gitignore), seperti CI, dan membaca `bun.lock` dengan `--frozen-lockfile`,
  sehingga tidak bisa menulis ulang berkas itu.
- **Ctrl-C, SIGTERM, dan SIGHUP ditangani.** Runner berhenti memulai apa pun,
  menghentikan pohon proses dari child yang _ia sendiri_ jalankan (`bun run check`
  beserta semua di bawahnya), menghapus database sementara, lalu keluar dengan
  130 / 143 / 129. Ia menelusuri tautan parent dari PID miliknya sendiri dan tidak
  pernah mencocokkan berdasarkan nama atau command line, sehingga `bun` milik sesi
  lain tidak pernah tersentuh, dan ia tidak pernah menjalankan `pkill` atau
  `killall`. Memberi sinyal ke child langsung saja tidak cukup: `bun run` keluar saat
  SIGTERM dan membiarkan proses skripnya tetap berjalan.
- **`.env` dimuat otomatis oleh Bun dan CI tidak punya.** Runner memperingatkan
  bila ada. Ia mem-pin `DATABASE_URL`, `SETUP_DATABASE_URL`, dan
  `WORKER_DATABASE_URL` untuk setiap child (kosong untuk job tanpa database,
  database sementara untuk dua job yang punya), sehingga URL database sungguhan
  tidak pernah bocor ke run test — tetapi variabel _lain_ dari `.env` atau shell
  Anda tetap berlaku.
  [`awcms-testing`](../../.claude/skills/awcms-testing/SKILL.md) menjelaskan kenapa
  keberadaan `.env` saja bisa menyalakan suite DB-gated.
- `CI=true` di-set untuk setiap job, seperti runner GitHub-hosted (retry dan
  `forbidOnly` Playwright, perilaku snapshot `bun test`).
- Job e2e memilih **port bebas** alih-alih 4321 tetap milik workflow, agar tidak
  bertabrakan dengan `bun run dev` yang sedang jalan (404-nya akan memenuhi probe
  kesiapan dan mengirim seed ke database yang salah).

## Bagaimana ia tetap sejalan dengan workflow

`scripts/ci-local.ts` adalah cermin yang ditulis tangan, dan cermin tulis-tangan
bergeser. [`tests/ci-local-parity.test.ts`](../../tests/ci-local-parity.test.ts)
mem-parse `ci.yml` dan `changesets.yml` dan gagal ketika:

- sebuah **job** workflow tidak punya padanan lokal (atau runner memetakan job
  yang sudah tidak ada);
- sebuah **step** workflow tidak dicerminkan dan tidak tercantum di `omitted`
  beserta alasannya, atau teks `run:` step yang dicerminkan berbeda dari workflow
  (step shell membawa teks workflow **apa adanya**);
- fakta yang dipin bergeser: versi Bun (1.4.2 saat ini, 1.3.0 lantai), major
  PostgreSQL, environment dan body seed e2e, ref base default.

Ia mencocokkan step shell lewat apa yang dieksekusinya, bukan labelnya, sehingga
mengganti nama step tidak merusaknya tetapi mengubah perintah merusaknya. Blok
terakhir berkas itu memutasi salinan workflow asli dan menuntut penjaganya
protes.

Step yang tidak bisa berupa teks workflow bersifat **native** dan menyebut
alasannya di `scripts/ci-local.ts` (`adapted`): container `services:` Postgres
dan `$GITHUB_ENV` (diganti database sementara), action `uses:` (checkout,
setup-bun, cache, upload-artifact), step `playwright install`, dan skrip
start/seed e2e (port bebas, `fetch` alih-alih `curl` + `jq`, server selalu
dimatikan).

## Tidak tercakup

`codeql.yml` (CodeQL hanya jalan di GitHub), app GitGuardian, dan `release.yml`
(dipicu tag) tidak punya padanan lokal. `ci:local` yang hijau itu perlu, bukan
cukup: required checks GitHub tetap yang menentukan merge.

## Lihat juga

- [`branch-protection.md`](branch-protection.md) — ruleset dan required checks-nya.
- [`alur-pengembangan.md`](alur-pengembangan.md) §12 — posisinya dalam alur.
- [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md) — strategi testing yang diimplementasikan job-job ini.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — validasi sebelum PR.
