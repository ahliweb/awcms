# ADR-0056 — Permukaan admin `media_library`: cabut yang mati, beri permukaan yang perlu

- **Status:** Accepted
- **Tanggal:** 2026-08-02
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0036](0036-media-library-module-admission-ownership-inversion.md) (inversi kepemilikan media), [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (seluruh layar admin dibangun di sini), [ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md) (preseden mencabut permission yang tak semestinya dipegang tenant)

## Konteks

[ADR-0051](0051-admin-screens-consolidated-in-awcms.md) menyisakan `media_library`
sebagai satu dari dua modul tanpa layar. Ia terdaftar berdampingan dengan modul
lain yang benar-benar hanya kehilangan halaman — dan audit gelombang layar kedua
(PR #335–#338, #340) menemukan bahwa untuk modul ini kalimat itu **salah**.

Tiga temuan, semuanya diverifikasi ke kode, bukan disimpulkan dari dokumen.

### 1. Lima dari sebelas permission tidak digerbangi apa pun

`media_library` mendeklarasikan 11 permission, dan `sql/052` men-seed seluruhnya
ke katalog global. Enam punya call site `authorizeInTransaction` yang nyata:
`media.create`, `media.read`, `media.verify`, `media.cancel`,
`enforcement.read`, `enforcement.enable`.

**Lima tidak punya sama sekali:** `media.attach`, `media.detach`,
`media.delete`, `media.restore`, `media.purge`. Tidak ada route, tidak ada
fungsi aplikasi, tidak ada job yang menegakkannya. Mereka ada di katalog dan
di-grant ke role `owner` tiap tenant baru, dan tidak ada satu pun jalur kode
yang memeriksanya.

> Catatan cara memeriksanya, karena mudah salah: `media-object-directory.ts`
> memuat banyak string `action: "news_media.object.attached"` dan sejenisnya.
> Itu **nama aksi audit**, bukan gerbang permission. Sebaliknya `media.verify`
> TIDAK muncul di berkas route mana pun — gerbangnya ada di dalam fungsi
> aplikasi `media-finalize-upload-session.ts`. Memindai route saja memberi
> jawaban yang salah di kedua arah.

### 2. Lima fungsi aplikasi yang pemanggilnya nol

`attachNewsMediaObject`, `detachNewsMediaObject`, `softDeleteNewsMediaObject`,
`restoreNewsMediaObject`, dan `purgeNewsMediaObject` diekspor dari
`application/media-object-directory.ts` dan **tidak dipanggil dari mana pun** —
tidak di `src/`, tidak di `scripts/`, tidak di `tests/`. Satu-satunya rujukan
tersisa untuk `purgeNewsMediaObject` adalah sebuah komentar.

Lifecycle yang benar-benar berjalan hari ini dilakukan job rekonsiliasi lewat
fungsi yang BERBEDA — `purgeExpiredPendingNewsMediaObject` dan
`markStaleOrphanedNewsMediaObjectDeleted` — pada jadwalnya sendiri.

### 3. Tidak ada fungsi daftar

`GET /api/v1/media/objects` menuntut `?ids=` (maksimum 100) — ia **resolver
batch**, dibangun untuk `awcms-astro` menukar id jadi URL saat build, bukan
daftar. Lapisan aplikasi hanya punya `fetchNewsMediaObjectById`,
`fetchNewsMediaObjectsByIds`, dan `fetchNewsMediaObjectByObjectKey`. Tidak ada
`list*` sama sekali.

Artinya layar browse **tidak bisa** dibangun dari permukaan yang ada: ia butuh
fungsi baca baru. "Layarnya hilang" karena itu bukan deskripsi yang jujur untuk
modul ini, dan mendaftarkannya bersama enam modul yang memang hanya kehilangan
halaman membuatnya tampak seperti pekerjaan satu PR selama dua gelombang.

## Keputusan

Permukaan admin `media_library` **tidak** dibangun sebagai satu layar di atas
permission yang ada. Ia dipecah tiga, karena kelima permission tak-tergerbangi
itu tidak sekelas.

### A. `media.attach` / `media.detach` — DICABUT

Keduanya usang sejak [ADR-0036](0036-media-library-module-admission-ownership-inversion.md).
Sebelum inversi, `news_media` memiliki relasi objek→konten, sehingga
"attach"/"detach" adalah aksi nyata pada modul ini. Setelah inversi,
keterikatan media dinyatakan oleh **FK milik konsumen** — `featuredMediaId`
pada post `blog_content`, `media_object_id` pada ad placement. Mengubahnya
berarti meng-update baris konsumen, digerbangi permission konsumen.

Membiarkan keduanya di katalog berarti setiap owner tenant memegang wewenang
atas aksi yang tak bisa dilakukan siapa pun, dan review permission berikutnya
harus menebak lagi apakah itu celah atau peninggalan. Dicabut lewat migrasi
baru, mengikuti preseden [ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md)
(`sql/084`).

**Koreksi terhadap edisi pertama ADR ini.** Kalimat aslinya berbunyi "kelima
fungsi mati dihapus bersamanya" — itu bertentangan dengan §B, yang justru
MEMAKAI tiga dari lima fungsi tersebut. Yang dihapus adalah **dua**:
`attachNewsMediaObject` dan `detachNewsMediaObject`. `softDeleteNewsMediaObject`,
`restoreNewsMediaObject`, dan `purgeNewsMediaObject` tetap — §B memberi mereka
endpoint.

Status `attached` sendiri **tidak** ikut dicabut: CHECK di `sql/041` masih
menerimanya dan `isNewsMediaObjectSafeForPublicReference` masih menganggapnya
aman, jadi baris yang sudah berada di status itu tetap resolve. Yang hilang
adalah kemampuan menulisnya dari modul ini — yang memang tak dipakai siapa pun.

### B. `media.delete` / `media.restore` / `media.purge` — DIBERI PERMUKAAN

Ketiganya bukan peninggalan; mereka lubang. Objek yang salah unggah, yatim,
atau melanggar kebijakan hari ini **hanya** bisa hilang bila job rekonsiliasi
kebetulan mengategorikannya begitu, pada jadwalnya sendiri. Tidak ada jalan bagi
administrator untuk menghapus satu objek, dan tidak ada jalan untuk
membatalkannya bila salah.

Ketiganya mendapat endpoint ter-guard, ter-audit, ber-`Idempotency-Key`, dan
fungsi aplikasi yang sudah ditulis untuk mereka dipakai — bukan dihapus.

**`purge` menghapus baris registry, bukan objek R2.** Job rekonsiliasi yang
memiliki jalur penghapusan R2, dan menduplikasinya di endpoint berarti dua
penulis pada satu bucket dengan dua gagasan berbeda tentang apa yang aman
dihapus. Endpoint memurnikan registry; job tetap pemilik byte-nya. Biaya yang
diterima dan dinyatakan: jendela di mana objek R2 hidup lebih lama dari baris
registry-nya, ditutup oleh tick rekonsiliasi berikutnya.

### C. Daftar objek — fungsi baca BARU, bukan pelebaran resolver

`listMediaObjects(tx, tenantId, filter, cursor)` ditambahkan ke
`application/media-object-directory.ts`, dengan filter status/MIME dan **keyset
cursor** (`(created_at, id)`, teks presisi mikrodetik — jebakan yang sudah
tercatat di repo ini).

`GET /api/v1/media/objects` **tidak** diperluas menjadi mode-ganda. `?ids=`
adalah kontrak yang sudah dipakai `awcms-astro` di jalur build-nya; menambahkan
cabang "tanpa `ids` berarti daftar semuanya" ke endpoint yang sama mengubah
arti request yang hari ini adalah 400 menjadi dump seluruh registry. Daftar
mendapat rute sendiri.

Layar `/admin/media` menyusul setelah A–C mendarat, dan hanya menggerakkan
permission yang tergerbangi.

## Konsekuensi

- **Perubahan otorisasi nyata.** Dua permission dicabut dari katalog. Tenant
  yang men-grant-nya ke role kustom kehilangan grant itu; tak ada perilaku yang
  berubah, karena tak ada yang pernah memeriksanya.
- **Tiga endpoint baru** menambah permukaan tulis pada modul yang selama ini
  hampir seluruhnya baca + job. Ketiganya `isHighRiskAction`-worthy: `purge`
  tak bisa dibatalkan.
- **Urutan mengikat.** A dan B mengubah katalog permission; keduanya harus
  mendarat sebelum layar apa pun menggerbangi sesuatu di atasnya — persis kelas
  cacat yang `tests/admin-*-page-contract.test.ts` sudah dua kali tangkap.
- **`media_library` tetap tanpa layar sampai C selesai**, dan
  `docs/PROJECT_STATE.md` §4 harus menyebutnya sebagai pekerjaan ber-ADR, bukan
  sebagai satu layar yang tertinggal.

## Alternatif yang ditolak

- **Bangun layar di atas enam permission yang tergerbangi saja, biarkan lima
  sisanya.** Ini yang paling cepat, dan ia meninggalkan lima permission
  ter-seed yang tak diperiksa siapa pun di katalog yang di-grant ke tiap owner.
  Repo ini sudah dua kali mengirim cacat latent-authz; membiarkan lima
  permission menganggur adalah bahan bakunya.
- **Cabut kelimanya.** Rapi, dan salah: `delete`/`restore`/`purge` menggambarkan
  aksi yang operator memang butuhkan dan hari ini tak punya. Mencabutnya
  mengubah lubang jadi keputusan tanpa ada yang memutuskan.
- **Beri kelimanya permukaan.** Berarti membangun attach/detach yang menulis
  keterikatan yang bukan milik modul ini — persis kepemilikan yang ADR-0036
  balik.
- **Perluas `GET /api/v1/media/objects` jadi mode-ganda.** Ditolak di §C:
  mengubah 400 hari ini menjadi dump registry adalah perubahan kontrak yang
  menyamar sebagai penambahan.
