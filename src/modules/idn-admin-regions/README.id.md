🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:30c1c3652aa0cca9b48fabc2c6c6bb4e46cceba5ec6d168b7e064f8a486c0a10 -->

# `idn_admin_regions` — wilayah administrasi Indonesia

Master data berversi untuk hierarki administrasi Indonesia — **provinsi /
kabupaten-kota / kecamatan / desa** — diakui oleh
[ADR-0046](../../../docs/adr/0046-idn-admin-regions-module-admission.md).

| Aspek           | Nilai                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kunci / tipe    | `idn_admin_regions` · `system`, `isCore: false`                                                                                                                                       |
| Tabel           | `awcms_idn_region_datasets`, `awcms_idn_admin_regions` (`sql/080`)                                                                                                                    |
| Izin            | `region.read`, `dataset.read` (`sql/081`); `dataset.configure`/`.restore`, `scope: platform` (`sql/085`, ADR-0053 — sempat dicabut `sql/084`/ADR-0052, dikembalikan keesokan harinya) |
| API             | `/api/v1/idn-regions/*` (`openapi/modules/idn-admin-regions.openapi.yaml`)                                                                                                            |
| Job             | `bun run idn-regions:import`                                                                                                                                                          |
| Dataset         | `data/idn-admin-regions/` — `cahyadsn/wilayah` yang di-vendor (MIT)                                                                                                                   |
| Bergantung pada | `tenant_admin`, `identity_access` — tidak ada yang bergantung pada modul ini                                                                                                          |

## Sumber, lisensi, dan klaim yang TIDAK dibuat modul ini

Datanya berasal dari proyek komunitas pihak ketiga
[`cahyadsn/wilayah`](https://github.com/cahyadsn/wilayah) (MIT), di-vendor di
bawah `data/idn-admin-regions/` beserta lisensinya, commit hulu, checksum
per-berkas, dan rujukan keputusan per-berkas.

**Ini bukan API atau ekspor resmi Kementerian Dalam Negeri (Kemendagri).**
Ini adalah pengemasan komunitas atas keputusan Kepmendagri — AWCMS tidak pernah
mengklaim menerbitkan data ini, dan ini tidak menggantikan rujukan
hukum/kepatuhan operator sendiri ke keputusan itu. Berkas yang diimpor
(`db/wilayah.sql`) mengutip
**Kepmendagri No 300.2.2-2138 Tahun 2025**.

Peringatan itu hidup di tepat satu tempat dalam kode —
[`domain/source-provenance.ts`](domain/source-provenance.ts) — dan dibaca ulang
oleh respons API dataset dan layar admin, sehingga ketiganya tak pernah bisa
menyimpang.

## Mengapa data ini GLOBAL, dan apa yang menggantikan RLS

Provinsi "Aceh" adalah baris yang sama untuk setiap tenant. Karena itu kedua
tabel **tidak punya `tenant_id`, tidak punya RLS, dan tidak punya policy** —
postur yang sama dengan `awcms_permissions` dan `awcms_modules`. Menggandakan
91.599 baris per tenant akan mengubah data referensi menjadi penyimpanan yang
tumbuh mengikuti daftar pelanggan dan membuat "apakah setiap tenant berada pada
versi wilayah yang sama?" tak bisa dijawab.

Yang menggantikan RLS **bukan** kepercayaan:

- kedua tabel terdaftar di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`
  (`scripts/security-readiness.ts`), yang memaksa deklarasi privilege eksplisit
  per-role alih-alih mewarisi DML pukul-rata dari `ALTER DEFAULT PRIVILEGES`;
- `awcms_app` memegang `SELECT` pada keduanya plus `UPDATE` hanya pada tabel
  dataset (aktivasi); `awcms_worker` memegang jalur insert; **tak satu pun
  memegang `DELETE`**;
- setiap endpoint tetap menjalankan sesi → konteks tenant → RBAC/ABAC
  default-deny. Yang global adalah BARISNYA, bukan otorisasinya.

## Versioning: impor, aktifkan, kembalikan

```text
impor (job)             aktifkan (aksi admin)          kembalikan (aksi admin)
  ─────────►  validated  ──────────────────────►  active  ─────────────►  superseded
                                                    ▲                          │
                                                    └──────────────────────────┘
```

- **Impor** mem-parse dump yang di-vendor sebagai **teks** (tanpa mesin SQL,
  tanpa MySQL, tanpa jaringan), memvalidasinya secara utuh, dan menulis satu
  dataset baru **di samping** yang sebelumnya — tidak pernah menimpanya. Itulah
  yang membuat rollback menjadi pembalikan status alih-alih impor ulang.
- Dataset baru selalu mendarat sebagai `validated`, tidak pernah `active`:
  mengimpor adalah langkah deployment, memilih apa yang DISAJIKAN adalah
  keputusan operator yang diaudit.
- **Hanya satu dataset yang aktif**, ditegakkan oleh partial unique index di
  basis data — bukan oleh pemeriksaan aplikasi yang bisa disisipi dua permintaan
  konkuren.

```bash
bun run idn-regions:import            # dry run: parse, validasi, laporkan, tidak menulis apa pun
bun run idn-regions:import --commit   # tulis satu versi dataset baru
```

Menjalankan ulang `--commit` pada byte yang identik adalah no-op: kode dataset
diturunkan dari commit hulu + checksum berkas, sehingga ia berbenturan alih-alih
menciptakan versi duplikat.

## Validasi menolak hierarki parsial

Sebuah impor gagal — alih-alih mengimpor sebisanya — bila salah satu dari ini
terpenuhi:

| Kondisi                                           | Mengapa itu fatal                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Sebuah baris tidak cocok dengan tata bahasa nilai | Wilayah akan hilang diam-diam, dan tak ada yang memberitahukannya          |
| Kode wilayah duplikat                             | Dataset menyanggah dirinya sendiri tentang satu tempat nyata               |
| Wilayah yang induknya tidak ada                   | Hierarki yang kehilangan bagian tengahnya merusak picker, tanpa terlihat   |
| Sebuah tingkat dengan nol baris                   | Secara struktural bukan hierarki utuh — kemungkinan besar berkas terpotong |
| Checksum ≠ manifes                                | Provenans yang tercatat akan jadi fiksi                                    |

## API lookup

| Metode + path                            | Izin           | Catatan                                         |
| ---------------------------------------- | -------------- | ----------------------------------------------- |
| `GET /api/v1/idn-regions/regions`        | `region.read`  | `level`, `parentCode`, `search`, keyset `after` |
| `GET /api/v1/idn-regions/regions/{code}` | `region.read`  | Satu wilayah + jalur leluhur yang diresolusikan |
| `GET /api/v1/idn-regions/datasets`       | `dataset.read` | Versi + provenans + peringatan                  |

Setiap endpoint di tabel ini **hanya-baca**. Aktivasi dan rollback BUKAN
hanya-baca dan BUKAN bagian tabel ini, tapi keduanya juga tidak hilang — ada dua
jalur untuk mencapainya:

```bash
# job operator — CI, shell pemulihan, atau deployment yang tenant platformnya tak bisa login
bun run idn-regions:activate -- --dataset <code|uuid>            # dry run
bun run idn-regions:activate -- --dataset <code|uuid> --commit   # menyajikannya
bun run idn-regions:rollback --commit                            # batalkan
```

```http
# HTTP — konsol /admin/idn-regions
POST /api/v1/idn-regions/datasets/{id}/activate
POST /api/v1/idn-regions/datasets/rollback
```

Keduanya mengubah dataset yang disajikan ke **setiap** tenant, yang justru
sebabnya izin yang menggerbangi jalur HTTP (`dataset.configure`/`.restore`)
ber-`scope: "platform"` (ADR-0053, `sql/085`): dikecualikan dari katalog
borongan yang di-`grant` `setup/initialize` ke `owner` tiap tenant baru, dan
ditolak chokepoint otorisasi kecuali tenant yang bertindak ADALAH tenant
platform. Dulu tidak begini — izinnya pertama kali dirilis sebagai izin tenant
BIASA, sehingga seorang owner tenant biasa memegang wewenang atas data yang
disajikan ke tenant lain, yang justru sebabnya
[ADR-0052](../../../docs/adr/0052-idn-region-dataset-lifecycle-is-an-operator-job.md)
menghapus kedua endpoint dan izinnya selama satu hari (`sql/084`): gerbang
platform yang bisa membatasinya dengan aman belum ada.
[ADR-0053](../../../docs/adr/0053-platform-scoped-permissions.md) membangunnya
dan mengembalikan keduanya.

Kedua jalur itu TIDAK setara: endpoint HTTP menulis baris `awcms_audit_events`,
ke log tenant platform; job operator tidak menulis apa pun, karena tabel itu
tenant-scoped sedangkan aksinya global — biaya yang sengaja diterima dan
didokumentasikan pada jalur job, bukan kelalaian.

Kueri secara bawaan memakai dataset **active**; `?dataset=<code>` membaca versi
tertentu, dan itulah yang membuat menyimpan versi superseded sepadan dengan
barisnya. Bila belum ada yang diaktifkan, respons list kosong dan membawa
`reason: "no_active_dataset"` — instalasi baru adalah keadaan nyata, bukan
kesalahan yang perlu dilacak.

## Sengaja tidak ada di sini

- **Tidak ada izin `import`.** Impor adalah job, bukan aksi HTTP; menyemai
  izinnya akan mengiklankan permukaan yang tidak ada.
- **Tidak ada capability port / tidak ada event.** Konsumen membaca API; tidak
  ada yang berlangganan perubahan wilayah.
- **Tidak ada deskriptor `dataLifecycle`.** Data referensi berversi digantikan
  (superseded), bukan diusangkan karena umur.
- **Tidak ada pulau / populasi / kode area.** Ketiga dump itu di-vendor dari
  commit hulu yang sama, tetapi belum ada yang membacanya.
- **Istilah lokal untuk kecamatan bernilai `null`.** Hulu mengirim nama
  kecamatan polos; mengisikan "Kecamatan" akan salah bagi provinsi yang
  tingkatannya "Distrik". Sebuah null yang bisa dilihat operator lebih baik
  daripada nilai masuk akal yang tak bisa mereka periksa.
