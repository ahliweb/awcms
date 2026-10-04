🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0127-generic-jurisdiction-neutral-tax-calculation-module.md)

<!-- i18n-source-hash: sha256:562b97ea8c196fdee813c4a97b3159d55aba458b27034c8e7ed152bd83223b30 -->

# ADR-0127 — modul kalkulasi pajak generik yang netral yurisdiksi (`tax`)

- **Status:** Diterima
- **Tanggal:** 2026-10-04
- **Pengambil keputusan:** ahliweb
- **Menggantikan:** tidak ada.
- **Terkait:** [Issue #889](https://github.com/ahliweb/awcms/issues/889) (hilir: `ahliweb/awcms-one#293`); [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (modul ERP hidup di `src/modules/` template ini); [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (sebuah kapabilitas dibangun di sini, dengan admission-nya sendiri); [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (chokepoint otorisasi per-handler); [ADR-0006](0006-offline-first-sync-outbox.md) (outbox); [ADR-0026](0026-modular-openapi-ownership-and-composition.md); `src/modules/tax/`; `sql/171`–`sql/173`; `docs/awcms/tax-calculation.md`; `docs/awcms/21_module_admission_governance.md`

## Konteks

Konsumen template ini membawa **satu persentase pajak tingkat-toko**: satu angka
di tabel pengaturan, dikalikan ke total keranjang oleh pemanggil mana pun yang
kebetulan menampilkannya. Itu benar sampai salah satu hal berikut terjadi, dan
tiap-tiapnya lumrah, bukan eksotis:

- tarif berubah, dan setiap dokumen yang terbit sebelum perubahan harus
  mempertahankan pajak saat ia terbit — angka pengaturan yang sekadar ditimpa
  tidak bisa mengatakan tarif mana yang dipakai struk bulan Maret;
- satu daftar harga memuat barang kena pajak, barang dibebaskan, dan barang
  tarif-nol;
- sebuah yurisdiksi mengenakan dua pungutan, salah satunya dihitung atas harga
  yang sudah memuat yang lain;
- etalase menampilkan harga termasuk pajak, back-office harga di luar pajak, dan
  POS membulatkan per baris sementara faktur membulatkan per dokumen — tiga
  pemanggil, tiga total yang sedikit berbeda untuk keranjang yang sama;
- pelanggan mengembalikan satu dari tiga barang, berbulan-bulan kemudian,
  setelah tarif bergeser.

`docs/awcms/21_module_admission_governance.md` §4.3 menyebut pajak di antara modul
domain ERP yang generik lintas tenant dan boleh dibangun langsung di
`src/modules/`; `AGENTS.md` mencantumkan pajak/ekspor Coretax di peta ERP. Yang
belum ada adalah inti generik di bawahnya: kalkulator yang **dapat diaudit,
deterministik, otoritatif-server, dan tidak tahu hukum satu negara pun**.

## Keputusan

Menerima **satu modul domain baru, `tax`** (`type: "domain"`, kategori: modul
domain ERP — generik lintas tenant, dapat dinonaktifkan per tenant), API-first.

### 1. Dua tabel, bukan enam

Sebuah profil adalah sebuah **kode** yang dibagi oleh versi-versi yang saling
menggantikan; ia tidak punya baris sendiri. Kategori, aturan, dan komponen sebuah
versi hidup di jsonb `definition`-nya, divalidasi ketat oleh aplikasi sebelum
insert dan tak berubah begitu terbit. Baris-baris sebuah snapshot hidup di
barisnya sendiri. Jadi seluruh modul adalah `awcms_tax_rule_versions` dan
`awcms_tax_snapshots`.

Ini bukan minimalisme demi minimalisme. Setiap tabel harus menjawab pertanyaan
retensi (`data-lifecycle:table-coverage:check`), dan ledger pengecualian
(`BOUNDED_BY_DESIGN`) dibatasi dengan standar "penyusutan bersih, bukan sebuah
argumen". Desain enam tabel (yurisdiksi, kategori, profil, versi, aturan,
komponen) akan butuh lima entri baru untuk baris yang di-AUTHOR, bukan
diakumulasi, dan yang akan dihapus purge generik berbasis umur **saat sedang
berlaku**. Desain dua tabel butuh satu entri (batas naik 14 → 15, dengan alasannya
di tes), dan tabel yang benar-benar tumbuh seiring lalu lintas membawa deskriptor
`dataLifecycle` yang sungguhan.

Biayanya nyata dan diterima: sebuah kategori atau komponen tidak bisa di-foreign-key
atau di-query relasional dari SQL. Keduanya tak berubah begitu terbit, dan itulah
yang membuat denormalisasi ini aman — keduanya tak bisa menyimpang — dan laporan
rekonsiliasi membuka (unnest) keduanya di SQL bila perlu.

### 2. Uang itu eksak: rasional `bigint`, string desimal di kawat

Tidak ada floating point yang menyentuh sebuah jumlah. Setiap kuantitas, harga,
diskon, dan tarif adalah **string desimal** di API (JSON `number` ditolak, bukan
dikonversi — ia sudah melewati IEEE double) dan pembilang `bigint` di atas
penyebut `bigint` di kalkulator (`domain/decimal.ts`). Rasional, bukan integer
berskala, karena penetapan harga termasuk-pajak butuh _pembagian_ (`bruto / (1 +
tarif)`) yang hasilnya bukan desimal; rasional menjaganya eksak dan menunda
pembulatan ke satu tempat yang dikatakan aturan pembulatan. `numeric(24,6)` di
database; skala pembulatan 0–6.

### 3. Satu kalkulator murni, pembulatan dinyatakan bukan diimplikasikan

`calculateTax(version, lines)` adalah fungsi murni: tanpa jam, tanpa database,
tanpa locale. Masukan dan versi aturan yang sama menghasilkan keluaran
byte-identik — properti yang memungkinkan snapshot tersimpan dihitung ulang
bertahun-tahun kemudian, dan klien offline menanamkan berkas yang sama.

Sebuah versi aturan menyatakan secara eksplisit: **mode harga** (`exclusive` /
`inclusive`), **mode pembulatan** (`half_up`, `half_down`, `half_even`, `up`,
`down`, `ceiling`, `floor`), **skala**, dan **level**:

- `line` — pajak tiap baris dibulatkan sendiri dan dokumen adalah jumlahnya;
- `document` — pajak eksak setiap baris dijumlahkan per komponen, dibulatkan
  **sekali**, lalu dibagi kembali ke baris dengan sisa terbesar (seri jatuh ke
  indeks lebih rendah, sehingga hasil tak pernah bergantung pada urutan iterasi).

Bagaimanapun, `neto + pajak = bruto` pada tiap baris dan dokumen sama dengan
jumlah barisnya sampai unit terakhir. Harga inklusif **mempertahankan bruto**: apa
yang dihargakan itulah yang ditagih, dan pajak adalah sisa setelah neto dibulatkan.

**Komponen** berurutan; komponen `cumulative` dikenakan atas neto ditambah pajak
setiap komponen sebelumnya — kasus bertumpuk / majemuk — dan komponen `net` atas
neto. **Dibebaskan (exempt)** dan **tarif-nol (zero-rated)** adalah perlakuan
berbeda yang dicatat per baris (keduanya baris berbeda pada sebuah laporan
pengembalian), dan keduanya tak punya komponen. Baris yang tak tercakup aturan
**ditolak** (`422 TAX_RULE_NOT_FOUND`), tak pernah diam-diam tanpa pajak; satu-satunya
cara mencakup "yang lain" adalah aturan fallback eksplisit.

**Mode harga milik versi, bukan permintaan.** Rancangan awal membolehkan pemanggil
menimpa `exclusive`/`inclusive` per permintaan. Itu dihapus: pemanggil yang hanya
memegang `tax.calculations.analyze` atau `tax.snapshots.create` bisa menghargai
ulang keranjang yang sama dengan mode lain dan membuat server mencatat hasilnya
sebagai otoritatif — kuasa penyusunan aturan (`tax.rules.publish`) yang dicapai
lewat izin pemostingan dokumen. Override yang dijaga flag pada versi juga
dipertimbangkan dan ditolak — tak ada konsumen yang membutuhkannya (sebuah toko
inklusif-pajak atau tidak, dan menyatakannya di versinya), dan flag yang tak pernah
diset hanyalah permukaan yang ada untuk disalah-konfigurasi. `pricingMode` di body
permintaan kini adalah field tak dikenal.

### 4. Versi tak berubah dan tak pernah tumpang tindih — ditegakkan di database

Versi terbit tak bisa disunting, dibuka ulang, atau dihapus oleh penulis mana pun
(`awcms_tax_rule_versions_guard`), dengan tepat satu pengecualian: jendela
terbuka-ujung boleh **ditutup sekali**, maju, ketika penerusnya terbit. Jendela
setengah-terbuka (`effective_from` inklusif, `effective_to` EKSKLUSIF), sehingga
hari batas menjadi milik tepat satu versi dan tak ada celah. Versi baru harus
berlaku **tepat sesudah** versi terbit terbaru — tidak ada penerbitan ke masa
lalu, karena menarik-mundur sebuah aturan memajaki ulang hari yang sudah punya
dokumen. Koreksi atas sejarah adalah reversal.

Aturan urutan itu saja menyisakan dua cara menarik-mundur, sehingga sebuah
penerbitan juga ditolak (`409 TAX_VERSION_BACKDATED`, berbeda dari
`TAX_VERSION_OUT_OF_ORDER`) bila `effective_from`-nya **sebelum tanggal server saat
ini** — `now()` dari database, UTC, tak pernah waktu JavaScript — atau **pada atau
sebelum `tax_date` terbaru dari snapshot mana pun di bawah profil itu pada tenant**.
Yang pertama mencegah aturan memajaki ulang hari yang sudah lewat; yang kedua
mencegahnya mengklaim hari yang sudah memuat dokumen terhitung di bawah versi
sebelumnya (sebuah dokumen boleh bertanggal besok, jadi "setelah hari ini" tak
cukup). Akibatnya versi pertama pun tak bisa mulai di masa lalu: sejarah sebelum
cutover mempertahankan jumlah saat terbit (`docs/awcms/tax-calculation.md`
§Kontrak adapter migrasi). Kedua pemeriksaan berjalan di bawah advisory lock profil,
dan finalisasi mengambil bentuk **shared** lock itu sebelum me-resolve versi
aturannya, sehingga penerbitan menunggu finalisasi yang berjalan selesai commit dan
melihat tanggal pajaknya, dan tak ada dokumen yang bisa menyelip di antara
pemeriksaan dan commit. Pemeriksaan ada di aplikasi, bukan trigger: tugas trigger
adalah invarian yang harus berlaku untuk setiap penulis (ketaktergantian,
tanpa-tumpang-tindih); "tidak sebelum hari ini" adalah kebijakan tentang jam.

Tanpa-tumpang-tindih adalah trigger yang mengambil **advisory lock** tingkat
transaksi pada profil sebelum memeriksa, bukan exclusion constraint, karena
exclusion atas `(tenant, profil, daterange)` butuh ekstensi `btree_gist`: sebuah
`CREATE EXTENSION` berhak-istimewa yang tak diminta migrasi mana pun di repo ini
dan mungkin tak diberikan operator database terkelola kepada peran migrasi.
Aplikasi mengambil lock yang sama lebih dulu, sehingga dua penerbitan konkuren
berbaris alih-alih berlomba (satu menang; yang lain mendapat `409
TAX_VERSION_OUT_OF_ORDER`), dan trigger menjadi pengaman bagi setiap penulis yang
bukan modul ini.

### 5. Snapshot adalah pajak dokumen itu, selamanya

Finalisasi menulis baris **append-only** (`awcms_tax_snapshots_immutable` menolak
setiap update dan setiap delete yang lebih muda dari 1826 hari) yang membawa
baris-baris terhitung **dan salinan definisi aturan yang dipakai**. Memperbarui
aturan karena itu tak mungkin mengubah dokumen historis secara konstruksi: versi
yang dikutipnya tak berubah, dan barisnya bahkan tak perlu membacanya.

Finalisasi idempoten dua kali — `Idempotency-Key`, dan kunci alami `(tenant, kind,
documentType, documentId)` dengan hash permintaan tersimpan — sehingga POS offline
yang memutar ulang antreannya dengan kunci berganti tetap menghasilkan satu snapshot.

**Refund dihitung dari snapshot asli saja.** `computeReversal` mengambil kuantitas
dan jumlah tercatat snapshot dan tak punya parameter yang bisa membawa tarif: ia
tak bisa berkonsultasi pada aturan hari ini. Reversal parsial mengambil `q/Q` baris,
dibatasi pada apa yang belum di-reverse, dan reversal yang menuntaskan sebuah baris
mengambil **sisa** eksak, sehingga refund dalam berapa pun langkah mengembalikan
persis apa yang ditagih. Reversal konkuren atas satu penjualan berbaris pada row
lock; trigger mengulang aritmetikanya dan menolak yang akan me-refund lebih dari
yang ditagih. `original_snapshot_id` sengaja bukan foreign key — retensi boleh
menghapus asli yang sudah tua sementara reversal yang lebih muda bertahan, dan baris
reversal berdiri sendiri.

Retensi: `retentionClass: financial_tax`, lantai 1826 hari (lima tahun dan satu hari
kabisat), ditegakkan oleh trigger selain deskriptor sehingga database tetap yang
terakhir bicara. Lantai itu adalah **minimum platform, bukan pernyataan masa
retensi hukum yurisdiksi mana pun**; operator yang kewajibannya lebih panjang
menetapkan kebijakan lebih panjang atau legal hold.

### 6. Otoritatif-server, dengan penolakan yang khas

Tidak ada endpoint yang menerima jumlah pajak. Setiap objek permintaan tertutup
(kunci tak dikenal adalah error), dan kunci yang tampak seperti field uang
terhitung — `taxAmount`, `vat`, `total`, `net`, `gross`, `rate` — ditolak dengan
kodenya **sendiri**, `400 TAX_AMOUNT_NOT_ACCEPTED`, bukan diabaikan: menjatuhkannya
diam-diam akan membuat pemanggil mengira angkanya dihormati dan membuat refactor
mendatang mulai membacanya. Setiap jalur etalase, POS, dan quote mencapai **satu**
kalkulator, sehingga keranjang, struk, dan refund tak bisa berselisih.

**Tanggal pajak dibatasi terhadap tanggal server.** Pemanggil menyatakan tanggal
pajak dokumen (penjualan POS offline yang terlambat sinkron wajar membawa tanggal
kemarin), tetapi pemanggil yang boleh menyatakan tanggal _apa pun_ bisa memposting
ke periode tertutup atau periode yang aturannya belum mulai. Maka `POST /snapshots`
— dan `taxDate` yang _dinyatakan_ pada reversal — harus berada dalam jendela di
sekitar tanggal UTC server (`now()` dari database): **7 hari ke belakang, 1 hari ke
depan** secara default, diatur `TAX_TAXDATE_PAST_DAYS` / `TAX_TAXDATE_FORWARD_DAYS`
(nilai cacat kembali ke default, bukan melebarkan jendela). Di luarnya pemanggil
harus juga memegang **`tax.snapshots.backdate`**, izin berisiko-tinggi terpisah yang
dibenihkan di `sql/173` dan dicek lewat chokepoint (sehingga log keputusan
mencatatnya); tanpanya jawabannya `403 TAX_BACKDATE_PERMISSION_REQUIRED`, tak pernah
diterima diam-diam, dan baris audit mencatat `backdated: true` bila izin dipakai.
Reversal tanpa `taxDate` bertanggal **server**, bukan tanggal aslinya: refund
dilaporkan pada periode terjadinya. Dari opsi yang dipertimbangkan — jendela via env,
baris pengaturan per-tenant, izin tanpa syarat — jendela env dipilih sebagai yang
paling sederhana yang tak pernah menerima diam-diam; pengaturan per-tenant adalah
tindak lanjut bila tenant butuh skew berbeda. `/quote` tidak dijendelakan: ia tak
mencatat apa pun.

### 7. Otorisasi, idempotensi, audit, event

Setiap handler mengotorisasi lewat `authorizeInTransaction` (ADR-0063),
default-deny. Sembilan izin: `tax.rules.{read,configure,publish}`,
`tax.calculations.analyze`, `tax.snapshots.{read,create,reverse,backdate}`,
`tax.reports.read`. Menyusun draf bukan menerbitkannya (`configure` vs `publish`,
kunci kedua alami dari pemisahan maker/checker yang bisa dituliskan tenant sebagai
aturan SoD); memfinalisasi bukan me-refund. Dua aksi baru, **`reverse`** dan **`backdate`**,
ditambahkan ke `AccessAction` dan digolongkan **berisiko-tinggi** — reversal
memposting dokumen pajak negatif.

Pembuatan draf, penerbitan, finalisasi, dan reverse mewajibkan `Idempotency-Key`;
penerbitan dan reversal diaudit pada `critical`. Quote tanpa-status tak butuh
keduanya. Tiga event lewat outbox (ADR-0006, transaksi sama, tanpa panggilan
provider) dan terdaftar di registry runtime serta kontrak AsyncAPI:
`awcms.tax.rule_version.published`, `awcms.tax.snapshot.finalised`,
`awcms.tax.snapshot.reversed`. Replay tidak menerbitkan apa pun. Atribut audit dan
payload event membawa pengenal, kode, dan total — modul **tidak menyimpan data
pelanggan**, sebuah dokumen adalah rujukan buram.

### 7a. Pengerasan dari audit keamanan atas versi pertama

- **Jumlah dibatasi.** Setiap angka baris dan total dokumen harus muat di
  `numeric(24,6)` (di bawah 10^18); jika tidak `422 TAX_INPUT_INVALID`, dari `/quote`
  dan `/snapshots` sama-sama, bukan error database setelah kerja selesai.
- **Kunci lock profil kanonik.** Advisory lock aplikasi meng-cast id tenant lewat
  `::uuid` sebelum membangun kunci, sehingga header huruf-besar menghasilkan kunci
  yang sama dengan `tenant_id::text` milik trigger.
- **Daftar berupa ringkasan.** Daftar snapshot tanpa `lines`, daftar versi aturan
  tanpa `definition`; isi lengkap dari endpoint detail.
- **Pembacaan snapshot tidak membocorkan aturan.** Detail mengembalikan id dan nomor
  versi, bukan definisi aturan yang tertanam: tarif dan kategori adalah
  `tax.rules.read`, kuasa berbeda dari membaca dokumen.
- **`{id}` cacat** pada keempat rute `[id]` menjawab 404, bukan 500.
- **Rujukan dokumen/baris adalah handle buram**: `[A-Za-z0-9][A-Za-z0-9._:/-]*`,
  dibatasi panjang, tak pernah di-trim. `reason` tetap di luar payload event (baris
  audit menyimpannya; audit disamarkan menurut kunci).

### 8. Pelaporan

Dua bagian, karena engine punya satu batas. Proyeksi `cursor_table` pada engine
`reporting` yang ada (`tax.snapshot_activity`) menghitung dokumen terfinalisasi dan
reversal tercatat — dilacak kesegarannya, dapat dibangun ulang, direkonsiliasi
terhadap `COUNT` segar oleh engine; `awcms_tax_snapshots` append-only, satu-satunya
sumber yang kursor hanya-naiknya tepat benar. Aturan metrik engine hanya bisa
menghitung, maka uang hidup di `GET /api/v1/tax/reports/reconciliation`: penjualan
neto dari reversal per mata uang, per versi aturan, komponen, dan perlakuan, plus
**blok integritas** yang memeriksa setiap snapshot pada periode terhadap
baris-barisnya sendiri. Ia adalah drill-down proyeksi, diagregasi di SQL dan
rentangnya dibatasi.

### 9. API-first: tanpa layar, tanpa entri navigasi

Perubahan ini mengirim API. Entri `navigation` tanpa halaman nyata adalah 404
permanen di sidebar (`AGENTS.md`), sehingga deskriptor tidak mendeklarasikannya.
Layar penyusunan aturan adalah tindak lanjut pertama (di bawah).

## Keberlakuan regulasi

**Inti tidak membawa hukum negara mana pun, dan ADR ini tidak menyatakannya.**
Khususnya ia **tidak** mengirim profil Indonesia, dan tidak mencatat undang-undang,
tarif, dasar pengenaan, ambang batas, atau daftar pembebasan untuk Indonesia atau
tempat lain. Issue mensyaratkan _pemetaan regulasi yang terverifikasi_ sebelum
profil negara ada, dan itu jenis pekerjaan yang berbeda dari rekayasa: ia butuh
teks regulator yang **terkini**, ditinjau orang yang berkualifikasi, pada suatu
tanggal, dan hukum berubah — itulah sebabnya modul ini diversikan berdasarkan
tanggal efektif.

Profil negara, begitu ada, adalah **konfigurasi** — versi aturan yang disusun lewat
`POST /api/v1/tax/rule-versions` — tak pernah kode di `domain/`. Pemetaan yang
harus diverifikasi sebelum versi semacam itu diterbitkan untuk produksi mencakup
setidaknya:

1. komponen, tarifnya, dan apakah masing-masing dikenakan atas neto atau kumulatif;
2. definisi **dasar pengenaan** (apa yang termasuk sebelum tarif berlaku, dan
   diskon apa yang menguranginya);
3. aturan pembulatan, skalanya, dan apakah berlaku per baris atau per dokumen;
4. apakah harga wajib ditampilkan inklusif atau eksklusif, dan di mana hitung-balik
   diwajibkan;
5. penyerahan mana yang **dibebaskan** dan mana yang **tarif-nol**, dengan tanggal
   efektif — modul menjaganya berbeda karena pengembalian membedakannya;
6. tanggal efektif setiap perubahan, termasuk aturan peralihan;
7. segala sesuatu yang **bukan** kalkulasi pajak dan tetap di luar modul ini:
   penomoran faktur, format e-faktur/e-filing, dan penyampaian ke otoritas pajak
   (ekspor Coretax adalah modul integrasi eksternal tersendiri, di belakang outbox).

Sebuah tenant boleh memakai modul ini hari ini dengan perangkat aturan apa pun yang
berhak ia susun; modul adalah kalkulator, bukan pendapat kepatuhan, dan
mengatakannya dalam deskripsi API-nya. Tidak ada di sini maupun di modul yang boleh
dibaca sebagai menyatakan apa yang diwajibkan yurisdiksi mana pun.

## Alternatif yang dipertimbangkan

- **Mempertahankan persentase datar dan menambah tanggal efektif pada pengaturan.**
  Hanya menyelesaikan kasus perubahan tarif, meninggalkan semua butir di Konteks,
  dan tetap membiarkan tiap pemanggil menghitung pajaknya sendiri.
- **Model aturan relasional (profil, kategori, aturan, komponen sebagai tabel).**
  Bentuk buku-teks, ditolak karena biaya ledger retensi di §1. Tinjau ulang bila
  konsumen butuh join SQL atas komponen; `definition` yang tak berubah dapat
  diproyeksikan ke tabel tanpa mengubah API.
- **Aritmetika `numeric` di SQL.** Eksak juga, tetapi kalkulator akan hidup di
  database, tak bisa dibagi dengan klien offline, dan tak bisa diuji unit tanpanya.
  Ditolak: determinisme dan portabilitas adalah intinya.
- **`number` JavaScript dengan unit minor integer.** Eksak untuk harga eksklusif,
  tak aman melewati 2^53 dan tak mampu menyatakan hitung-balik inklusif. Ditolak.
- **Exclusion constraint untuk tanpa-tumpang-tindih.** Lebih bersih, butuh
  `btree_gist` (§4).
- **Tabel anak untuk baris dan komponen snapshot.** Lebih mudah di-query, tiga
  jaminan append-only alih-alih satu dan tiga jawaban retensi alih-alih satu.
  Laporan rekonsiliasi membuka jsonb; tinjau ulang bila ada kebutuhan terukur.

## Konsekuensi

- Pajak menjadi satu kalkulator di belakang satu API; keranjang, struk, dan refund
  sepakat secara konstruksi.
- Dokumen historis kebal terhadap perubahan aturan — properti skema, bukan tinjauan
  kode.
- Penyusun aturan **tidak bisa** menarik-mundur, menyunting, atau menghapus versi
  terbit, dan sebuah versi tak bisa berlaku sebelum tanggal server sama sekali —
  termasuk yang pertama untuk sebuah profil. Kesalahan pada versi terbit dikoreksi dengan menerbitkan penerus, dan
  dokumen yang salah dengan me-reverse-nya. Operator yang terbiasa menyunting
  sebuah pengaturan harus diberi tahu.
- Konsumen yang me-back-date atau terlambat sinkron melebihi jendela butuh
  `tax.snapshots.backdate`.
- Tidak ada penghapusan draf di perubahan ini; draf terbengkalai tetap ada (tak
  pernah di-resolve). Dibatasi penyusunan manusia, dicatat sebagai tindak lanjut.
- `AccessAction` mendapat `reverse` (berisiko-tinggi); `BOUNDED_BY_DESIGN` bertambah
  satu dan batasnya satu; `awcms_worker` mendapat `SELECT, DELETE` pada
  `awcms_tax_snapshots`.
- Tenant yang sudah ada tidak mendapat izin baru sampai job backfill izin-owner
  berjalan (`sql/173` hanya memperluas katalog).

## Tindak lanjut (bukan di perubahan ini)

1. **Layar admin** untuk penyusunan aturan, penerbitan, dan tampilan rekonsiliasi
   (`/admin/tax`), dengan entri `navigation` dalam perubahan yang sama dengan
   halamannya.
2. **Profil negara** sebagai konfigurasi, satu per pemetaan regulasi terverifikasi.
3. **Adapter konsumen** — `awcms-one#293` dan `awcms-astro` menggantikan persentase
   datar (`docs/awcms/tax-calculation.md` §Migration adapter contract).
4. **Penghapusan draf**, dan registri kategori/yurisdiksi untuk tenant bila
   konsumen membutuhkannya.
5. **POS offline**: build kalkulator murni yang dapat ditanam plus protokol cache
   versi-aturan yang terdokumentasi (dokumen versi aturan sudah merupakan semua yang
   ia butuhkan); snapshot server tetap otoritatif saat sync.
6. **Ekspor Coretax / e-faktur** sebagai modul integrasi eksternal di belakang
   outbox, setelah tindak lanjut 2.
7. **Aturan SoD** atas `tax.rules.configure` + `tax.rules.publish` untuk tenant yang
   menginginkan maker/checker (basis tidak mengirim satu pun, menurut kebijakan).
