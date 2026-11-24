🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](contract-fixtures-pack-consumer-guide.md)

<!-- i18n-source-hash: sha256:0003e223048ecd2deb964a76c06f147c436f29917a1bf24024d7542f60ca0a96 -->

# Paket fixture kontrak: memin dan memverifikasi (panduan konsumen)

Issue #1394 (sub-issue #1396), [ADR-0167](../adr/0167-contract-derived-fixtures-and-two-sided-conformance-checks-with-an-in-repo-generator-and-ajv.md). Paket: [`fixtures/api-contract/contract-fixtures.json`](../../fixtures/api-contract/contract-fixtures.json). Generator dan gerbang: `scripts/api-contract-fixtures.ts` (`bun run api:fixtures:generate|:check`). Aturan higiene: `scripts/lib/contract-fixture-pack-hygiene.ts`.

## Apa itu paket ini

Data, bukan layanan. Untuk setiap operasi pada bundle OpenAPI, paket memuat satu contoh body permintaan dan satu contoh per respons JSON yang dideklarasikan, masing-masing valid terhadap skema di sampingnya. Konsumen (Storybook, build SSG, tes) mengganti tiruan tulisan tangannya dengan paket ini, atau memvalidasinya terhadap paket. Konsumen **tidak pernah mengimpor kode repositori ini** dan tidak pernah membaca databasenya.

## Kanal penerbitan (keputusan K19.15, 24 Nov 2026)

Permintaan konsumen dihitung: repositori situs publik `ahliweb/awcms-astro` (isu `awcms-astro#194`). Kanalnya: **konsumen mem-pin berkas pada SHA commit immutable `ahliweb/awcms` dan memverifikasi dua hash SHA-256.** Tanpa aset rilis, tanpa registry, tanpa penerbitan artefak CI, tanpa infrastruktur baru.

Opsi dinilai dengan kriteria repositori (keamanan, perawatan, kompatibilitas):

| Opsi                                            | Keamanan                                                                          | Perawatan                                                             | Kompatibilitas                                                                  | Putusan                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| A. Pin SHA commit atas berkas di repositori ini | Immutable secara konstruksi (SHA tidak bisa dipindah); tanpa kredensial/host baru | Tidak ada: berkas sudah ada dan `api:fixtures:check` menjaganya segar | Konsumen mana pun yang bisa mengambil berkas mentah atau `git archive` pada SHA | **Diputuskan**              |
| B. Aset rilis GitHub                            | Dapat berubah kecuali rilis dikunci; butuh job penerbitan berhak tulis            | Langkah rilis yang harus dijalankan dan diselaraskan dengan kontrak   | Ambil lewat tag                                                                 | Ditolak: infrastruktur baru |
| C. Artefak CI                                   | Kedaluwarsa; butuh token untuk mengunduh; cakupan token luas                      | Job penerbitan dan kebijakan retensi                                  | Lemah: unduhan yang kedaluwarsa tidak bisa dipin                                | Ditolak                     |
| D. Registry paket                               | Kredensial penerbitan dan target rantai pasok                                     | Versioning, penerbitan, deprekasi                                     | Baik, tetapi mengubah data menjadi dependensi                                   | Ditolak: infrastruktur baru |

## Format paket (manifes)

Kunci pertama berkas adalah manifes, dengan urutan ini:

| Kunci             | Arti                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packVersion`     | Versi **format** paket (saat ini `2`). Perubahan format menaikkannya, sehingga perubahan format tak pernah dikira perubahan isi.                                     |
| `contractVersion` | `info.version` bundle OpenAPI tempat paket diturunkan.                                                                                                               |
| `contractSha256`  | SHA-256 (hex) berkas bundle `openapi/awcms-public-api.openapi.yaml`, pada commit yang sama.                                                                          |
| `contentSha256`   | SHA-256 (hex) paket itu sendiri: atas `JSON.stringify(rest, null, 2) + "\n"`, dengan `rest` adalah paket yang di-parse tanpa kunci ini (urutan kunci dipertahankan). |

Sisanya (`summary`, `sharedResponses`, `operations`, `skipped`) dijelaskan di [`05_openapi_asyncapi_detail.id.md`](05_openapi_asyncapi_detail.id.md) (bagian "Fixtures pack and freshness gate").

## Cara memin

1. Pilih SHA commit `ahliweb/awcms` (40 karakter hex, bukan nama branch atau tag) dan catat di repositori konsumen, misalnya di `contract-pin.json` di samping berkas yang di-vendor: `{ "repo": "ahliweb/awcms", "sha": "<40 hex>", "contentSha256": "<64 hex>", "contractSha256": "<64 hex>" }`.
2. Ambil dua berkas pada SHA itu:

```sh
SHA=<40-hex-commit-sha>
BASE=https://raw.githubusercontent.com/ahliweb/awcms/$SHA
curl -fsSL "$BASE/fixtures/api-contract/contract-fixtures.json" -o contract-fixtures.json
curl -fsSL "$BASE/openapi/awcms-public-api.openapi.yaml" -o awcms-public-api.openapi.yaml
```

3. Verifikasi kedua hash terhadap berkas yang diambil dan terhadap nilai yang dicatat (Bun):

```ts
import { createHash } from "node:crypto";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const text = await Bun.file("contract-fixtures.json").text();
const pack = JSON.parse(text);
const { contentSha256, ...rest } = pack;

const contentOk = sha(JSON.stringify(rest, null, 2) + "\n") === contentSha256;
const bundleOk =
  sha(await Bun.file("awcms-public-api.openapi.yaml").text()) ===
  pack.contractSha256;
if (!contentOk || !bundleOk || pack.packVersion !== 2) {
  throw new Error("fixtures pack failed verification, do not use it");
}
// bandingkan juga contentSha256 dan contractSha256 dengan nilai di berkas pin Anda
```

Pemeriksaan shell untuk hash bundle saja: `sha256sum awcms-public-api.openapi.yaml` harus mencetak `contractSha256`.

Hash pertama membuktikan berkas tidak berubah di jalan atau di disk. Hash kedua membuktikan paket diturunkan dari kontrak yang Anda pakai untuk memvalidasi. Keduanya tidak membuktikan paket itu yang Anda maksud untuk dipin: SHA di berkas pin Anda yang menentukannya.

## Aturan kesegaran (kapan memin ulang)

- Setiap perubahan bundle OpenAPI membuat paket yang di-commit basi, dan `api:fixtures:check` (dalam `bun run check`) merah sampai paket diregenerasi dan di-commit **dalam pull request yang sama**. Jadi di `main` paket dan bundle selalu cocok, dan `contractSha256` berubah pada setiap perubahan kontrak.
- Konsumen **wajib memin ulang** bila butuh operasi atau field yang tidak ada di kontrak terpin, bila mengadopsi `contractVersion` baru, atau bila `packVersion` berubah. Konsumen **boleh** tetap pada SHA lama tanpa batas waktu: tidak ada yang kedaluwarsa.
- Konsumen tidak boleh mengikuti branch. Pin adalah SHA, dipindah lewat perubahan yang ditinjau di repositori konsumen, dengan tiga nilai di atas diperbarui bersama.
- Paket membuktikan sebuah body cocok dengan skema, bukan bahwa skemanya lengkap (batas TV-2: properti yang diganti nama pada skema tanpa `required` tetap valid). Jangan membaca validasi hijau sebagai pernyataan tentang perilaku.

## Yang tidak pernah ada di paket

`bun run api:fixtures:check` menggagalkan build bila paket yang di-commit, selain basi, tidak membawa manifes yang dapat diverifikasi atau memuat: nilai berbentuk rahasia (JWT, kunci privat PEM, id kunci AWS, nilai `Bearer`/`Basic`, DSN berkredensial, kunci GitHub atau pembayaran live); data pribadi (e-mail di luar domain reserved, pengenal 16 digit berbentuk NIK, bentuk NPWP, nomor ponsel Indonesia); atau nama repositori di luar keluarga (`ahliweb/awcms`, `ahliweb/awcms-astro`). Temuan mencetak aturan dan path JSON, tidak pernah nilainya. Ini heuristik terhadap salah-tempel, bukan sistem pencegah kebocoran data; nilai yang dibangkitkan adalah placeholder tetap secara konstruksi.
