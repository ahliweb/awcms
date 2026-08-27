🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0117-latest-moves-only-after-the-approval-that-signs-it.md)

<!-- i18n-source-hash: sha256:dc8af3e5b02cc9fe58c292f93ef2fe100be1797a3d5d389e1ae5b9cf039df7fc -->

# ADR-0117 — `:latest` berpindah hanya setelah persetujuan yang menandatanganinya

- **Status:** Accepted
- **Tanggal:** 2026-08-28
- **Pengambil keputusan:** ahliweb
- **Mengamandemen:** [ADR-0024](0024-semver-numbering-continues-legacy-major-line.id.md) tidak tersentuh; yang diamandemen adalah rasional yang tercatat di `docs/awcms/release-process.md` §Environment approval — job `build` TETAP tanpa gerbang, tetapi tidak lagi menerbitkan `:latest`. Lihat §Apa yang diamandemen, dan apa yang tidak.
- **Terkait:** `.github/workflows/release.yml`; `docs/awcms/release-process.md` §2, §job `build`, §Environment approval; release run 33059543662 (`v10.0.2`), 31805359202 (`v9.1.1`), 31803264915 (`v9.1.0`), 31725195596 (`v9.0.0`), 31479624884 (`v8.0.0`)

## Konteks

### Gerbang itu didokumentasikan MELINDUNGI KREDENSIAL, dan dibaca sebagai melindungi PENERBITAN

`release.yml` memisahkan `sign-attest-publish` dari `build` dan menggerbanginya di
belakang GitHub Environment bernama `release` dengan required reviewer.
`release-process.md` §Environment approval menjelaskan mengapa `build` sendiri
**tidak** digerbangi:

> `sign-attest-publish` declares `environment: release` (`build` does not — since
> it holds no signing/attestation credentials, gating it behind approval would
> only add friction with no security benefit).

Kalimat itu bernalar sepenuhnya tentang **kredensial**, dan tentang kredensial ia
benar: `id-token`/`attestations` bersifat per-JOB, sehingga menjaga
`anchore/sbom-action` pihak ketiga tetap di luar job yang memegangnya adalah
properti pengurungan yang nyata dan layak dipertahankan.

Yang tidak diperhitungkan kalimat itu: `build` juga **MENERBITKAN**. Langkah
`Build and push image`-nya berjalan dengan `push: true` dan daftar tag yang, untuk
rilis nyata, memuat `${REPO}:latest` dan `${JOBS_REPO}:latest`. Jadi klaim "no
security benefit" mengukur hal yang keliru: manfaat menggerbangi langkah itu tak
pernah soal apa yang bisa ia tandatangani, melainkan soal apa yang bisa ia jadikan
jawaban default bagi `docker pull ghcr.io/ahliweb/awcms`.

### Persetujuan yang bisa ditahan tanpa batas ternyata menggerbangi hal yang tidak penting

Gerbang menahan job, dan menahannya selama tak ada yang mengklik. Itu desain yang
bekerja. Tetapi karena `:latest` sudah berpindah sebelum itu, "belum disetujui"
tak pernah berarti "belum diterbitkan" — ia hanya berarti "belum ditandatangani".

Ini bukan hipotesis, dan bukan nyaris-luput. Per 2026-08-28 release run berikut
**MASIH** duduk di `status: waiting` pada environment `release`, antara 13 dan 17
hari setelah tag-nya di-push:

| Run         | Tag      | Menunggu sejak | Image ter-push | `:latest` berpindah | Ditandatangani |
| ----------- | -------- | -------------- | -------------- | ------------------- | -------------- |
| 31479624884 | `v8.0.0` | 2026-08-11     | ya             | ya                  | **tidak**      |
| 31725195596 | `v9.0.0` | 2026-08-13     | ya             | ya                  | **tidak**      |
| 31803264915 | `v9.1.0` | 2026-08-14     | ya             | ya                  | **tidak**      |
| 31805359202 | `v9.1.1` | 2026-08-14     | ya             | ya                  | **tidak**      |

Diukur, bukan disimpulkan — `gh attestation verify` terhadap image terbit:

```
9.1.0  -> exit 1  HTTP 404 (tanpa attestation)
9.1.1  -> exit 1  HTTP 404 (tanpa attestation)
9.1.2  -> exit 0  ok
10.0.2 -> exit 0  ok
```

Selama jendela waktu ketika masing-masing dari keempatnya adalah build terbaru,
image yang ditunjuk `ghcr.io/ahliweb/awcms:latest` adalah image yang tak pernah
disetujui proyek ini dan tak pernah ditandatangani. Konsumen yang mengikuti resep
verifikasi milik repo ini sendiri — `release-process.md` §Verification, `gh
attestation verify oci://ghcr.io/ahliweb/awcms:… --owner ahliweb` — terhadap
`:latest` pada jendela itu akan menerima persis 404 di atas, dari artefak yang
justru disodorkan pipeline kepadanya.

`v10.0.2` memperlihatkan bentuk yang sama dari jarak dekat: tag di-push 2026-08-27
09:39 UTC, `build` selesai dan `:latest` berpindah pada 09:45, persetujuan tiba
11j53m kemudian pada 21:33. Hampir sepanjang satu hari, pull default proyek ini
adalah image tak bertanda tangan yang sedang menunggu keputusan yang belum dibuat.

### Mengapa tak ada yang melaporkannya

Setiap gerbang di repo ini berjalan terhadap pohon sumber. Cacat ini hidup di
_URUTAN dua job_, dan kedua job itu masing-masing benar — `build` membangun dan
mem-push apa yang diperintahkan, `sign-attest-publish` menandatangani apa yang
dihasilkan `build`. Tak ada artefak yang isinya salah, jadi tak ada yang bisa
dibaca gerbang berbasis sumber. Satu-satunya tempat urutan itu tertulis sebagai
prosa adalah kalimat yang dikutip di atas, dan di kalimat itulah letak salah
nalarnya.

Komentar ringkasan pipeline sendiri justru menguatkannya alih-alih menandainya,
dengan mendaftar keduanya sebagai satu hasil atomik:

```
#   - push tag `v*.*.*`   -> REAL release (image :latest moved, GitHub Release published)
```

`:latest` berpindah dan Release terbit BUKAN satu peristiwa, dan keempat run di
atas adalah empat kesempatan ketika yang pertama terjadi tanpa yang kedua.

## Keputusan

**`:latest` diproduksi hanya SETELAH persetujuan environment `release`, dan hanya
setelah digest yang ditunjuknya ditandatangani serta di-attest.**

Konkretnya:

1. `build` tidak lagi memancarkan `:latest` untuk kedua repository. Ia tetap
   mem-push tag imutabel `:${VERSION}` dan `:sha-<12>`, tanpa gerbang. Itulah
   input yang dialamati sisa pipeline, tak pernah dipakai ulang, dan rilis tak
   disetujui yang meninggalkannya bersifat inert — tak ada yang menunjuk ke sana
   kecuali seseorang meminta versi persis itu.
2. Job baru `promote-latest`, `needs: [build, sign-attest-publish]`, me-retag
   `:latest` untuk `ghcr.io/ahliweb/awcms` dan `ghcr.io/ahliweb/awcms-jobs`.
   `needs` pada job ber-gerbang itulah yang menggerbanginya; ia tidak
   mendeklarasikan `environment:` sendiri, karena prompt persetujuan kedua untuk
   keputusan yang sama adalah friksi tanpa keputusan kedua di belakangnya.
3. Ia memegang `packages: write` dan tak lebih. Ia dibuat sebagai **job TERPISAH**
   alih-alih langkah tambahan di dalam `sign-attest-publish` persis karena alasan
   keberadaan job itu sendiri: `id-token`/`attestations` bersifat per-job, dan
   makin sedikit langkah yang duduk di job yang memegangnya, makin kecil permukaan
   yang bisa mencetak token OIDC. Menambahkan `docker/setup-buildx-action` ke job
   berprivilese justru akan membelanjakan properti pengurungan yang hendak
   dipertahankan ADR ini.
4. Retag adalah operasi **REGISTRY**: GET manifest-nya, lalu PUT byte yang SAMA
   di bawah nama `latest`. Isi yang identik byte-per-byte menghasilkan hash yang
   identik, sehingga `:latest` tak bisa mendarat di mana pun selain digest
   tertandatangani. Image aplikasi diikat dengan `@${APP_DIGEST}` — digest persis
   yang diserahkan ke `cosign sign` dan kedua langkah attest — sehingga ia tak
   bisa melenceng sekalipun ada yang memindahkan tag versi di antaranya. (Butir
   ini semula menetapkan `docker buildx imagetools create`; itu SALAH dan run
   nyata pertama membuktikannya. Lihat §Amandemen.)
5. Satu langkah verifikasi membaca ulang `:latest` dari registry dan menggagalkan
   job kecuali ia menunjuk digest tertandatangani itu. Invarian yang diperkenalkan
   ADR ini cukup murah untuk diasersi langsung, dan ADR yang propertinya hanya
   diasersi dalam prosa adalah bentuk yang MELAHIRKAN cacat ini.

### Urutan: promosikan SETELAH GitHub Release, bukan sebelum

Kedua urutan sama-sama menjaga `:latest` tertandatangani, jadi pilihan ditentukan
oleh mode kegagalan, yang tidak simetris.

Langkah release-notes adalah langkah yang BENAR-BENAR pernah gagal di pipeline
ini: `v7.0.0` mati di sana pada body 186.449 karakter, **setelah** penandatanganan,
attestation, dan push image semuanya berhasil — insiden yang memasang penjaga
pemotongan 118.000 byte di workflow. Mempromosikan `:latest` terakhir berarti
pengulangan kejadian itu meninggalkan `:latest` pada rilis sebelumnya.
Mempromosikannya lebih dulu berarti `:latest` menunjuk versi yang tak punya
GitHub Release yang menjelaskannya — keadaan yang lebih buruk dari keduanya,
karena deployment yang mengikuti `:latest` akan berpindah ke kode yang catatannya
tak pernah terbit.

## Apa yang diamandemen, dan apa yang tidak

**Tidak diamandemen.** Pemisahan `build`/`sign-attest-publish`, beserta alasannya
yang tertulis. `build` tetap tanpa gerbang dan tetap satu-satunya job yang
menjalankan `anchore/sbom-action`. Jalur gladi tak berubah: `workflow_dispatch`
tetap tak bisa menyentuh `:latest`, kini ditegakkan oleh `if: github.event_name ==
'push'` pada SATU JOB UTUH alih-alih oleh cabang di dalam skrip penghitung tag.

**Diamandemen.** Kalimat §Environment approval "gating it behind approval would
only add friction with no security benefit" benar untuk kredensial dan salah
untuk penerbitan. Ia ditulis ulang untuk menyatakan apa yang dicakup dan tidak
dicakup gerbang itu, dan langkah 1 §job `build` ("`:latest` is added only for a
real release") kini menunjuk ke `promote-latest`.

**Yang secara eksplisit TIDAK dikerjakan.** Keempat run tertahan itu tidak
diperbaiki oleh perubahan ini. Run yang dipicu push tag mengeksekusi berkas
workflow _sebagaimana adanya pada tag itu_, sehingga `v8.0.0`–`v9.1.1` tetap akan
mem-push `:latest` dari `build` bila dijalankan ulang. Keduanya adalah butir
operasional — setujui agar mendapat tanda tangan dan Release-nya, atau biarkan
artefaknya kedaluwarsa pada 30 hari — dan bagaimanapun `:latest` hari ini menunjuk
`10.0.2`, yang sudah ditandatangani.

## Amandemen 2026-08-28 — `imagetools create` TIDAK BISA melakukannya, dan `v10.0.3` membuktikannya

Rilis pertama yang menjalankan `promote-latest` adalah `v10.0.3`, dan ia **GAGAL
di langkah verifikasi** — dan justru itulah satu-satunya sebab ini menjadi
amandemen, bukan cacat yang ditemukan konsumen berminggu-minggu kemudian.

`docker buildx imagetools create` TIDAK menunjuk sebuah tag ke byte yang sudah
ada. Ia selalu **membangun dan mem-push manifest list BARU** yang membungkus
sumbernya, sehingga `:latest` mendarat pada index hasil serialisasi baru
`sha256:5dde705e…` sementara manifest tertandatangani adalah `sha256:d5423378…`
(sebuah `application/vnd.oci.image.manifest.v1+json` polos, bukan index —
`imagetools` membungkusnya). Layer sama, config sama, digest BERBEDA.

Perbedaan itulah inti persoalannya, karena **attestation terikat pada DIGEST**.
Diukur segera sesudahnya:

```
gh attestation verify oci://ghcr.io/ahliweb/awcms:10.0.3 --owner ahliweb  -> exit 0
gh attestation verify oci://ghcr.io/ahliweb/awcms:latest --owner ahliweb  -> exit 1
```

Jadi mekanisme yang dipilih untuk menjamin "`:latest` selalu bisa diverifikasi"
justru menghasilkan, pada run pertamanya, `:latest` yang TIDAK bisa diverifikasi
— persis kondisi yang hendak dicegah ADR ini, dilahirkan kembali oleh
implementasinya sendiri. Keputusan di §Keputusan sudah benar; MEKANISME butir 4
yang salah.

**Mekanisme yang dikoreksi.** Sebuah tag hanyalah nama yang dipetakan registry ke
byte manifest, jadi retag yang menjaga digest adalah yang harfiah: `GET
/v2/<name>/manifests/<digest>`, lalu `PUT /v2/<name>/manifests/latest` dengan
body dan `Content-Type` yang sama. Isi identik byte-per-byte menghasilkan hash
identik. Diverifikasi terhadap registry NYATA sebelum dikirim: manifest untuk
`sha256:d5423378…` berukuran 2.189 byte dan `sha256sum` atas byte itu
mereproduksi `d5423378…` persis. Hanya memakai `curl` dan `jq`, keduanya sudah
ada di runner — yang sekaligus mengeluarkan `docker/setup-buildx-action` dan
`docker/login-action` dari job yang memegang `packages: write`, dividen kecil
bagi argumen pengurungan di butir 3.

Langkah verifikasi tak berubah tujuannya, tetapi kini membaca header
`Docker-Content-Digest` milik registry sendiri untuk tag itu, bukan digest yang
dihitung ulang oleh alat lokal. Penalaran butir 5-lah yang menangkap ini, dan
layak dinyatakan ulang karena ia nyaris tak lolos tinjauan sebagai "asersi yang
sudah jelas": **pemeriksaan yang tampak mubazir justru yang menangkap mekanisme
yang Anda pilih keliru.**

`v10.0.3` terbit tertandatangani dan ter-attest di bawah tag versinya, dengan
GitHub Release dan asetnya utuh; hanya `:latest` yang salah, dan ia tetap salah
sampai rilis berikutnya menjalankan job yang sudah dikoreksi — tak ada cara
memperbaikinya di tempat, karena run yang dipicu push tag mengeksekusi berkas
workflow sebagaimana adanya pada tag itu sendiri.

## Konsekuensi

- Pull default proyek ini kini selalu image yang disetujui dan ditandatangani.
  Resep verifikasi di `release-process.md` §Verification kini berlaku terhadap
  `:latest`, yang selama empat rilis tidak demikian.
- Rilis yang tak pernah disetujui meninggalkan `:version`/`:sha-*` di registry dan
  tidak memindahkan apa pun. Itulah keadaan istirahat yang dikehendaki, dan ia
  bisa ditemukan — tag-nya ada, Release-nya tidak.
- Satu job tambahan per rilis nyata, beberapa detik kerja manifest. Tanpa
  persetujuan ekstra, tanpa perubahan atas apa yang dibangun atau ditandatangani.
- `:latest` dan tag `:version` terbaru kini BISA berbeda, selama rilis tak
  disetujui duduk di gerbang. Itulah maksudnya, dan ini pertama kalinya registry
  mampu menyatakannya.
