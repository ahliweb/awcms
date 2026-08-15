🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0058-unenforced-permissions-disposition.md)

<!-- i18n-source-hash: sha256:43389b6e9a40339b77b1a14830f1d20ac2f7a00b5c40a6fefca38622b377ef9e -->

# ADR-0058 — Empat permission terdeklarasi tanpa penegak: dua permukaan, dua pencabutan

- **Status:** Accepted
- **Tanggal:** 2026-08-03
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0057](0057-blog-page-lifecycle.md) (§F membangun gerbang yang menemukan keempatnya), [ADR-0056](0056-media-library-admin-surface.md) (preseden: cabut yang usang, beri permukaan yang lubang nyata), [ADR-0041](0041-comments-module-admission.md) (model moderasi `comments`), [ADR-0036](0036-media-library-module-admission-ownership-inversion.md) (preseden pencabutan lewat migrasi)

## Konteks

[ADR-0057](0057-blog-page-lifecycle.md) §F menambahkan
`bun run access:permissions:enforcement:check`: tiap permission yang
di-deklarasikan sebuah descriptor wajib punya call site `authorizeInTransaction`
di `src/`, atau alasan tertulis kenapa tidak. Gerbang itu ada karena dua modul
sudah pernah mengirim permission ter-seed yang tak diperiksa apa pun, dan
keduanya baru ketahuan berbulan-bulan kemudian — pada `blog_content`
akibatnya sebuah page **tidak pernah bisa terbit sama sekali**.

### 1. Skor pertamanya memuat dua tuduhan palsu, dan itu bagian dari konteks

Run pertama melaporkan **199/205 dengan 6 pengecualian**. Dua di antaranya —
`visitor_analytics.settings.read` dan `.update` — **tergerbangi dengan benar**;
`src/pages/api/v1/analytics/settings.ts` membangun `READ_GUARD`/`UPDATE_GUARD`
persis pada activity itu. Scanner-nya yang salah: ia menyelesaikan tiap
`const NAME = "value"` lewat satu tabel datar seluruh repo, dan `MODULE_KEY`
terikat di lima berkas ke empat nilai berbeda, sehingga aturan "nama berkonflik
= tak-terpecahkan" mematikannya di semua berkas — termasuk berkas yang
mengikatnya satu baris di atas guard-nya.

Yang perlu dicatat sebagai konteks keputusan ini bukan bug-nya, melainkan
akibatnya: kedua tuduhan itu **langsung ditulis sebagai KEPUTUSAN ber-alasan**
di daftar `EXCEPTIONS`, dengan alasan yang menyatakan tentang rute yang ada
bahwa "no route names a settings activity", lalu tersalin ke
`docs/PROJECT_STATE.md` sebagai backlog. Diperbaiki di PR #359 (resolusi
konstanta file-first, mutation-proven di dua lapis); skor kini **201/205 dengan
4 pengecualian**.

Konsekuensinya untuk ADR ini: **tiap satu dari empat sisa di bawah diverifikasi
ulang ke kode**, di direktori rute dan bukan hanya di dalam modulnya, sebelum
dituliskan sebagai keputusan.

### 2. Keempat sisanya jatuh ke dua kelas yang berbeda, bukan satu

Daftar pengecualian memperlakukan keempatnya sebagai satu kelas ("permission
tanpa penegak"). Pemeriksaan ke kode membantah itu — dua di antaranya punya
seluruh mesinnya kecuali permukaan, dua lagi tidak punya mesin sama sekali:

| Permission                                    | Mesin domain/aplikasi                                                         | Permukaan | Kelas    |
| --------------------------------------------- | ----------------------------------------------------------------------------- | --------- | -------- |
| `profile_identity.profile_management.restore` | kolom `deleted_at`/`restored_at`/`restored_by` (`sql/003`), `softDeleteParty` | tidak ada | lubang   |
| `comments.moderation.delete`                  | transisi `delete`→`deleted` di `applyModerationAction`, filter queue          | tidak ada | lubang   |
| `blog_content.seo.configure`                  | tidak ada — datanya dikelola permission LAIN                                  | tidak ada | duplikat |
| `blog_content.posts.export`                   | tidak ada, di mana pun                                                        | tidak ada | usang    |

#### `profile_identity.profile_management.restore` — soft delete tanpa jalan pulang

`sql/003` memberi `awcms_profiles` lima kolom lifecycle: `deleted_at`,
`deleted_by`, `delete_reason`, `restored_at`, `restored_by`, plus index
`awcms_profiles_tenant_deleted_idx` yang dibangun persis untuk menyaring
sumbu itu. `party-directory.ts` mengekspor `createParty`,
`fetchPartyById`, `listParties`, `updateParty`, dan **`softDeleteParty`** —
tanpa pasangan.

Kelima rute profil (`/api/v1/profiles`, `/{id}`, `/{id}/identifiers`,
`/{id}/links`, `/resolve`) menggerbangi `read`/`create`/`update`/`delete`.
Tidak ada rute restore. Jadi `restored_at`/`restored_by` **tidak pernah bisa
terisi lewat API**, dan sebuah profil yang di-soft-delete efektif permanen:
barisnya ada, index-nya ada, kolom pemulihannya ada, dan tak ada satu pun jalur
kode yang bisa menulisinya. Bentuk yang persis sama dengan yang ADR-0056 §B
tutup untuk objek media.

> **Koreksi terhadap edisi pertama ADR ini.** Paragraf di sini semula menuduh
> `profile-identity/README.md` menulis bahwa rutenya menggerbangi
> `read`/`create`/`update`/**`merge`**. Itu **salah**, dan salah dengan cara
> yang pantas dicatat: README-nya benar (`{read,create,update,delete}`) —
> kalimat "merge" itu ada di **teks alasan pengecualian gate**, ditulis pada
> run pertamanya dan sudah dikoreksi di PR #359. Saya mengutip catatan gate
> lalu mengatribusikannya ke README tanpa membuka README-nya.
>
> Yang membuatnya layak disimpan alih-alih dihapus diam-diam: ini contoh KETIGA
> dari pola yang sama dalam satu rangkaian kerja — teks yang salah dari sebuah
> gate menjadi sumber untuk dokumen berikutnya, yang lalu terbaca sebagai
> temuan independen. Persis mekanisme yang membuat dua tuduhan palsu di §1
> bertahan. Aturannya: **kutip berkas, bukan catatan tentang berkas.**

#### `comments.moderation.delete` — separuh yang mendarat adalah separuh penulis

Ini kasus yang paling mudah salah baca, jadi urutan buktinya penting.

Status `deleted` **bisa dicapai hari ini** — tapi hanya oleh PENULIS komentar:
`requestCommentDeletion` menulis `SET status = 'deleted'` bila permintaan datang
di dalam edit window, lalu mencatat baris moderation-event ber-`actor_kind`
`'author'`. Jalur itu diautentikasi oleh binding penulis (user id / IP hash),
bukan oleh permission.

Sisi moderator tidak pernah mendarat, padahal seluruh mesinnya ada:

- `applyModerationAction` menerima `"delete"` dan mentransisikannya ke `deleted`;
- `LEGAL_TRANSITIONS` mengizinkannya dari **keempat** status non-terminal;
- `QUEUE_STATUSES` memuat `deleted`, jadi antrean admin bisa memfilternya —
  moderator dapat MELIHAT komentar terhapus tanpa pernah bisa menghapus satu pun;
- descriptor modul (`module.ts` §retention) menyebutnya eksplisit: "Soft delete
  (`status='deleted'`) is a separate **moderator**/author action, also
  non-destructive";
- header `comment-moderation.ts` mengklaim mengimplementasikan
  "approve/reject/spam/archive/restore/**delete** transitions (single + bulk)".

Empat rute moderasi yang ada menggerbangi `read`, `approve`/`reject` (guard
kondisional), `archive`, dan `restore`. Tak ada satu pun yang meneruskan
`"delete"`.

Klaim header itu — sebuah dokumen yang memerikan permukaan yang tak pernah ada —
adalah pelajaran yang sama yang `docs/PROJECT_STATE.md` §4 catat untuk README
`reporting` dan `workflow-approval`, dan ia ikut menjelaskan kenapa cacat ini
lolos review: yang membacanya melihat konfirmasi, bukan pertanyaan.

Yang TERSISA untuk moderator hari ini semuanya reversibel dan semuanya
mempertahankan badan komentar di antrean: `reject`, `spam`, `archive`. Tidak ada
aksi yang menarik sebuah komentar dari peredaran secara **satu arah** — padahal
penulisnya punya persis itu.

#### `blog_content.seo.configure` — sumbu kedua untuk data yang sudah dikelola

`sql/036` men-seed `('blog_content', 'seo', 'configure', …)` dan descriptor
mendeklarasikannya sebagai "Configure blog SEO metadata defaults". Satu-satunya
kemunculan `activityCode: "seo"` di seluruh repo adalah deklarasi itu sendiri.

Dan defaults yang dijanjikannya **memang sudah dikelola** — oleh permission
lain: `blog-settings-policy.ts` memuat `seoDefaultTitle` dan
`seoDefaultDescription` sebagai field `awcms_blog_settings`, ditulis lewat
`PATCH /api/v1/blog/settings` di bawah `blog_content.settings.configure`.

Jadi baris ini bukan lubang: ia sumbu otorisasi KEDUA untuk data yang sudah
punya sumbu. Mempertahankannya berarti dua permission berbeda menjanjikan
kewenangan atas kolom yang sama, dan hanya satu yang pernah ditanya.

#### `blog_content.posts.export` — janji tanpa mesin

`sql/036` men-seed `('blog_content', 'posts', 'export', 'Export blog posts')`.
Tidak ada rute, tidak ada fungsi aplikasi, tidak ada serializer, tidak ada job,
tidak ada kolom — nol mesin ekspor di modul ini maupun di mana pun di repo.
Berbeda dari tiga di atas, tak ada apa pun yang setengah jadi untuk diselesaikan.

### 3. Kenapa keempatnya penting walau tak satu pun exploitable

`POST /api/v1/setup/initialize` memberikan **seluruh katalog** ke role `owner`
tiap tenant baru. Jadi tiap owner tenant memegang kewenangan atas empat aksi
yang tak satu pun jalur kode periksa. Itu tidak bisa dieksploitasi hari ini —
tak ada yang membacanya — dan itu justru masalahnya: ia persis ambiguitas yang
membuat review permission BERIKUTNYA harus menebak apakah sebuah baris tak
terpakai adalah gap atau sisa. ADR-0052/`sql/084` dan ADR-0056 §A/`sql/087`
keduanya menutup bentuk yang sama.

## Keputusan

### A. `profile_identity.profile_management.restore` mendapat permukaan

`POST /api/v1/profiles/{id}/restore` — ter-guard `profile_management.restore`,
ber-`Idempotency-Key` wajib, ter-audit, di dalam satu `withTenant`.
`restoreParty` menjadi pasangan `softDeleteParty` dan menulis
`deleted_at = NULL`, `restored_at`, `restored_by` dalam satu `UPDATE`.

**Prasyarat ditegakkan di WHERE, bukan dibaca lebih dulu**, mengikuti
`canRestorePost`: `WHERE tenant_id = … AND id = … AND deleted_at IS NOT NULL`,
dan nol baris terpengaruh → 404. Membaca dulu lalu menulis membuka balapan yang
menghasilkan dua baris audit "restored" untuk satu pemulihan.

**Tidak ada jebakan `23505` di sini, dan itu diverifikasi bukan diasumsikan.**
Refleks yang benar untuk sebuah restore adalah mencurigai unique parsial:
`sql/003` memang memasang `awcms_profile_identifiers_dedup_key … WHERE
deleted_at IS NULL`, dan memulihkan baris ke bawah index seperti itu adalah
sumber `23505` yang klasik. Tapi index itu ada pada
**`awcms_profile_identifiers`**, sedangkan `awcms_profiles` **tidak punya satu
pun constraint unique** — dan `softDeleteParty` menyentuh **satu tabel saja**,
tidak meng-cascade ke identifier. Identifier milik profil yang di-soft-delete
karenanya tetap hidup (`deleted_at IS NULL`) selama profil itu terhapus.

Jadi restore-nya simetris persis dengan delete-nya: satu `UPDATE` satu tabel,
tanpa jalur `23505`. Konsekuensi yang dicatat agar tidak ditemukan ulang sebagai
kejutan: soft delete profil **tidak** melepaskan dedup key identifier-nya, jadi
selama profil terhapus, identifier yang sama tidak bisa dipakai profil lain.
Itu perilaku yang ada hari ini, tidak diubah oleh ADR ini, dan justru yang
membuat restore bebas benturan.

### B. `comments.moderation.delete` mendapat permukaan, dan sifat SATU ARAH-nya adalah bagian keputusannya

`POST /api/v1/comments/admin/{id}/delete` — ter-guard `moderation.delete`,
ber-`Idempotency-Key` wajib, ter-audit, meneruskan `"delete"` ke
`moderateComment` yang sudah ada. Nol perubahan pada state machine: transisinya
sudah legal dari keempat status non-terminal.

Yang TIDAK berubah, dan sengaja: **`deleted` tetap terminal.**
`LEGAL_TRANSITIONS.deleted` tetap `[]`, dan komentarnya ("recovering a deleted
comment is an operator/database action, deliberately not an in-band moderator
move") tetap berlaku. Jadi ADR ini memberi moderator satu-satunya aksi
tak-terbalikkan di modul itu — dan itu diterima secara sadar dengan tiga alasan:

1. keadaannya **sudah tercapai hari ini** lewat jalur penulis, jadi keputusan ini
   tidak memperkenalkan state baru maupun sifat terminal baru — ia hanya berhenti
   membuat penulis satu-satunya aktor yang bisa mencapainya;
2. ia tetap **non-destruktif**: baris, badan, dan riwayat moderasi bertahan
   (ADR-0041 arsip-bukan-hapus tidak dilanggar — yang dihapus adalah
   keterlihatan, bukan data);
3. yang tersisa tanpa ini semuanya reversibel dan semuanya mempertahankan badan
   komentar di antrean, sehingga moderator yang menghadapi konten yang harus
   ditarik permanen tidak punya jawaban in-band sama sekali.

`bulk-moderate.ts` **tidak** ikut menerima `delete`: bulk hari ini hanya
approve/reject, dan aksi tak-terbalikkan adalah aksi terakhir yang pantas
diberi tombol massal.

### C. `blog_content.seo.configure` dicabut

Dicabut dari katalog dan dari tiap grant role. `settings.configure` sudah
menjadi jawabannya, dan menjaga dua sumbu untuk satu kolom hanya menunda
pertanyaan yang sama ke review berikutnya. **Tidak ada** perubahan pada
`seoDefaultTitle`/`seoDefaultDescription`, pada `PUT /api/v1/blog/settings`,
atau pada renderer `seo_distribution`: yang hilang cuma baris katalog yang tak
pernah ditanyakan.

### D. `blog_content.posts.export` dicabut

Membangun fitur ekspor untuk membenarkan baris katalog adalah ekor
menggerakkan anjing — kalimat yang sudah tertulis di alasan pengecualiannya
sejak ADR-0057 §F. Bila ekspor post kelak benar-benar dibutuhkan, ia datang
dengan ADR-nya sendiri, permission-nya sendiri, dan mesinnya — bukan dengan
baris tiga tahun lebih tua yang kebetulan sudah ada.

### E. Satu migrasi untuk kedua pencabutan

Satu migrasi baru — nomor bebas berikutnya di `sql/` saat ia mendarat; ADR ini
sengaja tidak menuliskannya, karena `check:docs` menolak token `sql/NNN` yang
berkasnya belum ada dan sebuah nomor yang dipesan di dokumen adalah nomor yang
bisa keliru saat PR lain mendarat lebih dulu. Bentuknya mengikuti `sql/087`
persis: grant lebih dulu (`awcms_role_permissions`
mereferensi `awcms_permissions`, jadi urutan terbalik menabrak FK), lalu baris
katalog; keduanya delete tanpa syarat ber-natural-key sehingga idempoten; tanpa
statement rollback, karena memulihkannya berarti mengiklankan ulang permukaan
yang ADR ini nyatakan tidak ada.

Kedua pencabutan digabung dalam SATU migrasi karena keduanya keputusan yang
sama pada modul yang sama, dan memecahnya menjadi dua nomor hanya menambah dua
baris di tabel migrasi tanpa menambah satu pun kemampuan meninjau.

### F. Pencabutan menyusul permukaan, bukan sebaliknya

Urutan PR mengikat: dua permukaan lebih dulu, migrasi pencabutan terakhir.
Alasannya bukan estetika — `access:permissions:enforcement:check` menandai
pengecualian yang permission-nya **sudah punya penegak** sebagai **stale** dan
memerahkan CI. Jadi tiap PR permukaan wajib menghapus entri pengecualiannya
dalam PR yang SAMA, dan PR pencabutan menghapus dua entri terakhir bersama
migrasinya. Setelah keempatnya mendarat, daftar `EXCEPTIONS` **kosong** dan
skornya `203/203` — angka yang gerbangnya sendiri hitung, bukan yang ditulis
tangan di sini.

## Konsekuensi

- **Dua permukaan baru, nol perubahan skema.** §A dan §B keduanya menulis kolom
  yang sudah ada dan memakai permission yang sudah ter-seed; tak ada tabel,
  kolom, CHECK, atau index baru.
- **Dua permission hilang dari tiap tenant.** Owner yang hari ini "punya"
  `blog_content.seo.configure` dan `posts.export` berhenti punya. Tak ada
  perilaku yang berubah — tak ada jalur kode yang pernah menanyakannya.
- **`awcms_permissions` turun dari 205 ke 203 baris.** Test dan dokumen yang
  memuat angka itu ikut berubah dalam PR yang sama.
- **Satu aksi moderator tak-terbalikkan yang baru**, dinyatakan eksplisit di §B
  dan dibatasi: satuan saja, bukan bulk.
- **Backfill tak diperlukan.** Ini pencabutan, bukan penambahan — dan justru
  arah inilah yang tidak punya jebakan tenant-lama: `DELETE` lewat natural key
  mengenai setiap tenant sekaligus, sedangkan seed permission baru hanya
  menjangkau tenant yang lahir sesudahnya (lihat
  `identity-access:permissions:backfill`).
- **Daftar pengecualian gerbang menjadi kosong.** Nilainya: pengecualian
  BERIKUTNYA akan menjadi satu-satunya entri di daftar itu, jadi ia tidak bisa
  bersembunyi di tengah daftar yang sudah panjang.

## Alternatif yang ditolak

- **Cabut keempatnya.** Menolak §A berarti memberkati sebagai desain sebuah
  soft delete yang tak punya jalan pulang, dengan tiga kolom di `sql/003` yang
  memang untuk memulangkannya. Ini alasan yang sama yang ADR-0057 §A tolak untuk
  `pages.publish`: mencabut permission yang cacatnya justru "tak ada yang
  memanggilnya" mengubah bug menjadi spesifikasi.
- **Beri permukaan keempatnya.** Menuntut membangun ekspor post yang tak
  seorang pun minta, dan sumbu SEO kedua yang bertabrakan dengan
  `settings.configure`. Baris katalog bukan requirement.
- **Satu ADR per permission (seperti bunyi tiap alasan pengecualian).** Empat
  ADR untuk satu kelas cacat yang sama, tiga di antaranya beberapa paragraf.
  ADR-0056 sudah memutuskan lima permission `media_library` dalam satu dokumen
  ber-§A/§B/§C, dan itu justru yang membuat kontrasnya — cabut vs beri
  permukaan — bisa dibaca sebagai satu keputusan.
- **Beri `delete` ke `bulk-moderate.ts` sekalian.** Simetri yang menggoda dan
  salah: bulk mengubah biaya satu kesalahan dari satu komentar menjadi seluruh
  halaman antrean, dan aksi ini satu arah.
- **Buat `deleted` bisa dipulihkan agar §B tidak menambah aksi terminal.**
  Perubahan pada state machine yang sudah dipakai jalur penulis, di ADR yang
  tidak sedang membahas model moderasi. Bila terminalitas `deleted` kelak
  dianggap salah, itu revisi ADR-0041 dengan konteksnya sendiri.
