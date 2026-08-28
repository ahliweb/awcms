🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0119-the-latest-badge-is-decided-not-inherited.md)

<!-- i18n-source-hash: sha256:f44d93f9f65da6c7493bafd3be4774c4cf3c93ae9309e8be25c20849d87eee9a -->

# ADR-0119 — badge "Latest" DIPUTUSKAN, bukan diwariskan

- **Status:** Accepted
- **Tanggal:** 2026-08-28
- **Pengambil keputusan:** ahliweb
- **Memperluas:** [ADR-0117](0117-latest-moves-only-after-the-approval-that-signs-it.id.md). ADR itu membuat tag kontainer `:latest` baru bergerak sesudah approval. Yang ini menangani "latest" LAIN di workflow yang sama — badge GitHub Release — yang tak dipertimbangkannya dan gagal ke arah sebaliknya.
- **Terkait:** `.github/workflows/release.yml` §`sign-attest-publish`; `scripts/release-latest-flag.ts`; `scripts/lib/release-verify-checks.ts` (`shouldMarkReleaseLatest`); `tests/release-latest-flag.test.ts`; run rilis 31547796968 (`v8.1.0`), 33033515836 (`v10.0.0`), 33052902887 (`v10.0.1`)

## Konteks

### Ada DUA hal bernama "latest", dan ADR-0117 hanya memperbaiki satu

ADR-0117 menetapkan bahwa **tag kontainer** `:latest` tak boleh bergerak sebelum
approval yang menandatangani image diberikan. Itu berhasil: pada 28 Agustus 2026
`gh attestation verify oci://ghcr.io/ahliweb/awcms:latest` mengembalikan exit 0,
dan `:latest` menunjuk digest `v10.0.4` yang bertanda tangan.

**Badge GitHub Release** adalah mekanisme terpisah dengan mode kegagalan
terpisah, dan `release.yml` tak pernah mengambil keputusan tentangnya:

```bash
gh release create "${{ github.ref_name }}" \
  --title "${{ github.ref_name }}" \
  --notes-file release-notes.md \
  CHECKSUMS.txt sbom-source.cdx.json sbom-image.cdx.json source.tar.gz
```

Tanpa flag `--latest`. `gh` mendokumentasikan default-nya sebagai "automatic
based on date and version", dan pada praktiknya rilis yang baru dibuat merebut
badge itu. Default tersebut menyandikan satu andaian: **rilis selalu bergerak
MAJU.**

### Repo ini MELANGGAR andaian itu secara sengaja, dan ADR-0117 sebabnya

Gerbang environment `release` ada supaya seorang manusia menandatangani sebelum
penerbitan. Gerbang yang harus dicapai manusia adalah gerbang yang bisa dicapai
TERLAMBAT — dan di repo ini itu rutin terjadi, berhari-hari sampai berminggu.
Jadi urutan rilis _diterbitkan_ bukan urutan versinya _dibuat_, dan tak bisa.

ADR-0117 menerima konsekuensi itu secara eksplisit: ia menolak memperbaiki run
tertahan yang ditemukannya, sebab "run yang dipicu push tag mengeksekusi
workflow versi TAG-nya". Ia tidak melanjutkan konsekuensinya satu langkah lagi,
ke apa yang terjadi ketika seseorang akhirnya menyetujuinya.

### Yang terjadi, terukur

Pada 28 Agustus 2026 tiga run terparkir yang tersisa — `v8.1.0` (menunggu sejak
11 Agustus), `v10.0.0` dan `v10.0.1` — disetujui agar image terbitnya memperoleh
atestasi yang belum dimilikinya. Itu berhasil: ketiganya kini terverifikasi.

Itu juga MEMINDAHKAN badge. Dalam hitungan detik setelah release `v10.0.0`
terbit, `GET /repos/ahliweb/awcms/releases/latest` mengembalikan **`v10.0.0`** —
versi yang sudah digantikan empat rilis, dan versi yang akan dipilih apa pun
yang mengikuti endpoint itu. Dipulihkan manual dengan
`gh release edit v10.0.4 --latest`.

### Kenapa tak ada yang mengantisipasinya — dan ini bagian yang lebih berguna

Perpindahan itu diprediksi **tidak** akan terjadi, di atas bukti yang tampak
kokoh: empat rilis di-backfill malam sebelumnya (`v8.0.0`, `v9.0.0`, `v9.1.0`,
`v9.1.1`, semuanya terbit 22:05), dan `GET /releases/latest` tetap melaporkan
`v10.0.4`. Kesimpulannya — "backfill tidak merebut badge" — SALAH. Keempatnya
**merebut**, lalu `v10.0.3` (22:36) dan `v10.0.4` (23:06) terbit sejam kemudian
dan merebutnya kembali.

**State akhir tak bisa menjawab pertanyaan tentang urutan.** Dua peristiwa yang
saling meniadakan tak bisa dibedakan dari satu peristiwa yang tak pernah
terjadi. Ini sekelas dengan cacat ADR-0117 sendiri — urutan dua job yang
masing-masing benar dan tak meninggalkan jejak pada artefak mana pun — dan
itulah sebabnya aturan di bawah digerbangi oleh TES terhadap insiden yang
tercatat, bukan oleh pembacaan siapa pun atas state saat ini.

## Keputusan

**1. Flag-nya selalu dioper, dan selalu dihitung.** `gh release create` menerima
`--latest=true|false` secara eksplisit. Mewarisi default itulah yang membuat
versi usang menjadi otoritatif; default yang benar di sebagian besar waktu tetap
keputusan yang tak diambil siapa pun.

**2. Aturannya: Latest hanya bila tak ada rilis terbit dengan versi lebih
tinggi.** Draft dan pre-release dikecualikan, sebab GitHub sendiri tak pernah
menaruh badge itu pada keduanya — memperhitungkannya akan membuat pre-release
usang menolak badge dari rilis stabil yang sah. Tag di luar `vX.Y.Z` diabaikan
di KEDUA sisi; repo ini memikul tag lama tanpa prefix (`3.0.0`, `4.5.0`) dan
membandingkan sesuatu yang bukan versi menghasilkan urutan tak bermakna.

**3. Perbandingannya fungsi MURNI ber-tes, bukan shell di dalam blok `run:`.**
`shouldMarkReleaseLatest` tinggal bersama pemeriksaan `release:verify` lainnya;
`scripts/release-latest-flag.ts` hanya jembatan I/O — membaca
`gh release list --json tagName,isPrerelease,isDraft` dari STDIN dan mencetak
satu kata. Perbandingan versi yang ditulis langsung di YAML adalah logika yang
tak terjangkau tes, dan logika tak-teruji di jalur rilis persis cara cacat ini
tiba.

**4. Jembatannya gagal-TERTUTUP, dan tertutup di sini berarti `false`.** Input
tak terbaca, bukan array, tag kosong: cetak `false`. Asimetrinya disengaja.
Salah `false` membuat sebuah rilis tanpa badge — terlihat, dan satu
`gh release edit` dari selesai. Salah `true` memindahkan badge ke versi yang
salah dan **tak ada yang melaporkannya**, yaitu kegagalan yang sedang
dihilangkan.

**5. Badge-nya DIBACA ULANG sesudah penerbitan, dan job gagal bila berbeda.**
Langkah ini tampak mubazir. Amandemen ADR-0117 adalah argumennya: di sana,
mekanisme yang dipilih untuk menjamin sebuah properti justru mematahkannya di
run pertamanya, dan satu-satunya sebab hal itu ketahuan di rilis yang
melahirkannya — bukan oleh konsumen berminggu kemudian — adalah pembacaan ulang
yang tak dianggap perlu siapa pun.

**6. `release.yml` DIASERSI, bukan dipercaya.** `tests/release-latest-flag.test.ts`
menyusun ulang setiap pemanggilan `gh release create` yang nyata dari baris
sambungannya dan mensyaratkan `--latest=` eksplisit. Ia mengecualikan baris
komentar dengan sengaja: workflow ini membicarakan `gh release create` dalam
prosa dua kali, jadi pencarian substring polos menemukan komentar lebih dulu dan
menjawab pertanyaan tentang dokumentasi sambil tampak menjawab pertanyaan
tentang perilaku.

## Yang TIDAK dikerjakan

**Tiga rilis yang disetujui tidak diurutkan ulang.** `v8.1.0`, `v10.0.0` dan
`v10.0.1` tetap memegang Release dan atestasinya; hanya badge-nya yang
dikembalikan, dan kini duduk di `v10.0.4` sebagaimana mestinya.

**Tak ada yang mencegah rilis terbit di luar urutan.** Itu bukan cacat — itu
konsekuensi langsung dari gerbang approval manusia, dan ADR-0117 memilihnya
dengan sadar. Yang berubah: terbit di luar urutan tak lagi diam-diam mengubah
makna "latest".

**Tidak memakai mode `make_latest: legacy`.** GitHub menyediakan varian berbasis
tanggal. Ia akan memberi jawaban benar di sini secara kebetulan, dan memberi
jawaban salah pertama kali sebuah patch di lini lama dirilis setelah major yang
lebih baru — `v9.1.3` terbit sesudah `v10.0.4` persis kasus yang dibuat mungkin
oleh kebijakan dukungan repo ini.

## Konsekuensi

- Menyetujui run terparkir, mem-backfill rilis historis, atau mengirim patch di
  lini lama tak lagi mengganggu apa yang dipilih konsumen sebagai latest.
- Satu panggilan `gh release list` dan satu `gh api` tambahan per rilis.
- Rilis yang versinya bukan tertinggi terbit tanpa badge sama sekali, dan itu
  benar serta itulah yang diasersi langkah verifikasi.
- Insidennya disandikan sebagai fixture tes (`AS_IT_STOOD`), bukan sebagai
  prosa, sehingga aturannya diperiksa terhadap apa yang benar-benar terjadi,
  bukan terhadap versi ingatan atasnya.
