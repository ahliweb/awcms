🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](tax-calculation.md)

<!-- i18n-source-hash: sha256:de6b649e16db5a2c76de430be318785c2eaff61887b00f7d08f5619292d293b5 -->

# Kalkulasi pajak — spesifikasi algoritma, kamus data, dan kontrak adapter

> **Status.** Spesifikasi untuk modul `tax` yang diterima oleh
> [ADR-0127](../adr/0127-generic-jurisdiction-neutral-tax-calculation-module.md)
> (Issue #889). Kodenya `src/modules/tax/`, skemanya `sql/171`–`sql/173`, kontrak
> HTTP-nya `openapi/modules/tax.openapi.yaml`, event-nya ada di
> `asyncapi/awcms-domain-events.asyncapi.yaml`. Setiap contoh kerja di bawah juga
> merupakan asersi di `tests/tax-calculator.test.ts`.
>
> **Ini kalkulator, bukan pendapat kepatuhan.** Ia tidak mengirim hukum negara mana
> pun dan tidak menyatakannya. Lihat ADR-0127 §Keberlakuan regulasi.

## 1. Model dalam satu halaman

```
versi aturan (profile_code + version_no, jendela efektif, penetapan harga, pembulatan,
              definition = { categories[], rules[ { kategori, perlakuan, komponen[] } ] })
      │  terbit ⇒ tak berubah (kecuali: menutup jendela terbuka satu kali)
      ▼
quote       POST /api/v1/tax/quote        tanpa-status, tidak mencatat apa pun
snapshot    POST /api/v1/tax/snapshots    append-only; membawa SALINAN definisi
reversal    POST /api/v1/tax/snapshots/{id}/reverse
                                          dihitung dari snapshot ASLI saja
```

- **Profil** adalah kode (`retail`, `export`, …) yang dibagi oleh versi-versi yang
  saling menggantikan. Tidak ada baris profil.
- **Versi** berlaku dari `effectiveFrom` (inklusif) sampai `effectiveTo`
  (eksklusif; `null` = terbuka). Paling banyak satu versi terbit mencakup suatu
  hari kalender sebuah profil.
- **Tanggal pajak** adalah tanggal kalender yang dinyatakan _pemanggil_ ("hari
  penyerahan terjadi"). Ia tak pernah jam server, dan itulah yang membuat dokumen
  yang di-back-date atau terlambat sinkron menggunakan aturan yang berlaku pada
  tanggalnya sendiri.

## 2. Kosakata

| Istilah         | Nilai                                                           | Arti                                                                                                                           |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pricingMode`   | `exclusive` · `inclusive`                                       | `unitPrice` adalah neto (pajak ditambahkan) / bruto (pajak ada di dalamnya)                                                    |
| `treatment`     | `taxable` · `exempt` · `zero_rated`                             | `taxable` punya ≥ 1 komponen; dua lainnya tak punya dan dijaga berbeda karena keduanya baris berbeda pada laporan pengembalian |
| `basis`         | `net` · `cumulative`                                            | tarif komponen dikenakan atas neto / atas neto **ditambah pajak setiap komponen sebelumnya** menurut urutan deklarasi          |
| `roundingMode`  | `half_up` `half_down` `half_even` `up` `down` `ceiling` `floor` | lihat §4                                                                                                                       |
| `roundingScale` | 0 – 6                                                           | jumlah desimal pembulatan                                                                                                      |
| `roundingLevel` | `line` · `document`                                             | tiap baris dibulatkan sendiri / pajak eksak dijumlahkan per komponen, dibulatkan **sekali**, lalu dibagi kembali               |

Jumlah, kuantitas, dan tarif adalah **string desimal**. JSON number ditolak.
Kuantitas dan harga paling banyak enam digit pecahan; tarif adalah persen dengan
paling banyak enam, antara 0 dan 1000.

## 3. Algoritma

Masukan: versi aturan `V`, baris `L₁…Lₙ` (`quantity`, `unitPrice`, `discount`
opsional, `categoryCode` opsional). Mode harga adalah milik versi, tak pernah
pemanggil. Keluaran: neto,
pajak, dan bruto per baris dan per dokumen, dengan rincian per komponen.

**Langkah 1 — jumlah baris.** `A = quantity × unitPrice − discount`, dihitung eksak
(rasional), ditolak bila negatif, lalu dibulatkan **sekali** ke `V.roundingScale`
dengan `V.roundingMode`. `A` adalah **neto** baris pada harga eksklusif dan
**bruto**-nya pada harga inklusif. Dinyatakan dalam _unit_ bilangan bulat 10⁻ˢᶜᵃˡᵉ
di bawah.

**Langkah 2 — aturan.** Aturan untuk kategori baris; jika tidak ada, aturan
**fallback** (`categoryCode: null`); jika tidak ada pula, kalkulasi ditolak dengan
`TAX_RULE_NOT_FOUND`. Sebuah baris tak pernah diam-diam diperlakukan tanpa pajak.

**Langkah 3 — faktor.** Untuk komponen `c₁…c_m` berurutan, dengan `rᵢ = tarif/100`:

```
kᵢ = rᵢ                        bila basis = net
kᵢ = rᵢ × (1 + k₁ + … + kᵢ₋₁)   bila basis = cumulative
K  = 1 + k₁ + … + k_m
```

**Langkah 4 — pajak eksak (rasional, belum ada yang dibulatkan).**

```
exclusive:  neto = A                    pajakᵢ = neto × kᵢ
inclusive:  neto = A / K                pajakᵢ = neto × kᵢ
```

**Langkah 5 — pembulatan, sekali, pada level yang dinyatakan.**

| Level      | Eksklusif                                                                                        | Inklusif                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `line`     | `pajakᵢ ← round(pajakᵢ)` per baris, per komponen                                                 | `neto ← round(A/K)`; `T = A − neto`; `T` dibagi ke komponen sebanding `kᵢ` dengan sisa terbesar                                                                  |
| `document` | per komponen `c`: `T_c = round(Σ_baris pajak_c)`; bagi `T_c` ke baris menurut `pajak_c` eksaknya | `N = round(Σ_baris A/K)`; `T = Σ A − N`; bagi `T` ke komponen menurut `Σ_baris pajak_c`; lalu tiap komponen ke baris menurut `pajak_c` eksak; `neto = A − pajak` |

**Pembagian sisa-terbesar** membagi bilangan bulat `T` ke bobot non-negatif sehingga
bagian-bagiannya berjumlah tepat `T`: ambil tiap `floor(T × wᵢ / Σw)`, lalu beri
satu unit pada sisa pecahan terbesar, **seri ke indeks lebih rendah**. Ia fungsi dari
masukannya saja — tak pernah dari stabilitas pengurutan.

**Invarian** (diasersikan atas 1.008 dokumen acak ber-seed pada setiap mode
pembulatan, level, dan mode harga): per baris `neto + pajak = bruto`; per baris
komponen berjumlah pajak baris; baris-baris berjumlah dokumen; total komponen
berjumlah total pajak; total perlakuan berjumlah total bruto; dan pada harga
inklusif **bruto setiap baris persis jumlah yang dihargakan**.

**Satu penolakan yang perlu diketahui.** Pada pembulatan tingkat-dokumen, jumlah
beberapa unit terkecil yang bertemu beberapa komponen sekaligus dapat membuat pajak
terbagi melebihi bruto baris. Itu berarti neto negatif pada sebuah penjualan,
sehingga kalkulasi ditolak (`TAX_INPUT_INVALID`, "too small to carry its tax")
alih-alih dikeluarkan.

## 4. Mode pembulatan

Ke satu unit utuh, pada setengah eksak dan negatifnya (negatif hanya penting untuk
`ceiling`/`floor`; kalkulator membulatkan jumlah non-negatif, dan tabel ini adalah
kontrak primitifnya):

| Mode        | 2.5 | 3.5 | −2.5 | −3.5 | Aturan                                         |
| ----------- | --- | --- | ---- | ---- | ---------------------------------------------- |
| `half_up`   | 3   | 4   | −3   | −4   | setengah menjauhi nol (simetris)               |
| `half_down` | 2   | 3   | −2   | −3   | setengah mendekati nol                         |
| `half_even` | 2   | 4   | −2   | −4   | setengah ke tetangga genap (pembulatan bankir) |
| `up`        | 3   | 4   | −3   | −4   | sisa apa pun menjauhi nol                      |
| `down`      | 2   | 3   | −2   | −3   | potong mendekati nol                           |
| `ceiling`   | 3   | 4   | −2   | −3   | ke +∞                                          |
| `floor`     | 2   | 3   | −3   | −4   | ke −∞                                          |

Pajak atas neto `0.25` dan `0.35` pada 10 %, skala 2 (`0.025` dan `0.035` — setengah
eksak):

| Mode                           | pajak atas 0.25 | pajak atas 0.35 |
| ------------------------------ | --------------- | --------------- |
| `half_up` / `up` / `ceiling`   | 0.03            | 0.04            |
| `half_down` / `down` / `floor` | 0.02            | 0.03            |
| `half_even`                    | 0.02            | 0.04            |

## 5. Contoh kerja

Semua memakai `roundingMode: half_up`, `roundingScale: 2`, `roundingLevel: line`,
harga eksklusif, satu aturan fallback `vat 10 net`, kecuali dinyatakan lain.

**5.1 Eksklusif.** `3 × 19.99` → neto `59.97`; pajak `5.997` → **`6.00`**; bruto
`65.97`.

**5.2 Diskon.** `2 × 10.00`, diskon `5.00` → neto `15.00`; pajak `1.50`; bruto
`16.50`. Diskon dikurangkan sebelum pajak.

**5.3 Float akan salah di sini.** Baris dibebaskan `1 × 1.005`: neto `1.005 → 1.01`
pada half-up. Float menyimpan `1.00499999999999989…` dan membulatkan ke `1.00`.

**5.4 Inklusif, 11 %.** Bruto `111.00` → neto `100.00`, pajak `11.00`. Bruto
`100.00` → `100 / 1.11 = 90.0900…` → neto **`90.09`**, pajak **`9.91`**, bruto
`100.00` dipertahankan.

**5.5 Dua komponen atas neto** (`vat 10`, `levy 5`) pada `100.00` → `10.00` +
`5.00`, pajak `15.00`.

**5.6 Majemuk.** `levy 5 cumulative` pada `100.00`: `vat 10.00` atas `100.00`; levy
`5 % × 110.00 = 5.50`; pajak `15.50`; `taxableBase` levy adalah `110.00`.

**5.7 Inklusif majemuk.** `K = 1 + 0.10 + 0.05 × 1.10 = 1.155`. Bruto `115.50` →
neto `100.00`; `vat 10.00`; `levy 5.50`.

**5.8 Level baris vs dokumen.** Tiga baris `1 × 0.05`, pajak `0.005` masing-masing:

| Level      | Pajak per baris  | Total  | Sebabnya                                                |
| ---------- | ---------------- | ------ | ------------------------------------------------------- |
| `line`     | `0.01 0.01 0.01` | `0.03` | tiga pembulatan `0.005`                                 |
| `document` | `0.01 0.01 0.00` | `0.02` | `Σ = 0.015 → 0.02`, dibagi, seri ke indeks lebih rendah |

**5.9 Perlakuan.** Kategori `books` (dibebaskan) dan `food` (tarif-nol); baris
`100.00` standar, `50.00` books, `20.00` food:

| Perlakuan    | Neto     | Pajak   | Bruto    |
| ------------ | -------- | ------- | -------- |
| `taxable`    | `100.00` | `10.00` | `110.00` |
| `exempt`     | `50.00`  | `0.00`  | `50.00`  |
| `zero_rated` | `20.00`  | `0.00`  | `20.00`  |

**5.10 Mata uang tanpa desimal** (`roundingScale: 0`): `105` pada `8 %` = `8.4` →
`8`; dicetak `8`, bukan `8.00`.

**5.11 Reversal dari snapshot asli.** Penjualan: baris `a` = `3 × 3.33` (neto
`9.99`, pajak `0.999 → 1.00`), baris `b` = `1 × 20.00` (neto `20.00`, pajak `2.00`),
pajak dokumen `3.00`.

- Kembalikan 1 dari 3 `a`: rasio `1/3` → neto `3.33`, pajak `0.3333 → 0.33`.
- Kembalikan 1 dari 3 lagi: neto `3.33`, pajak `0.33`.
- Kembalikan yang terakhir: ia mengambil **sisa**, bukan sepertiga — neto `3.33`,
  pajak `1.00 − 0.33 − 0.33 = 0.34`.
- Ketiga pengembalian berjumlah tepat `1.00` milik baris itu. Yang keempat ditolak.
- Jika tarif kemudian menjadi 20 %, tidak ada yang berubah: reversal tak pernah
  membaca tarif.

## 6. Aturan reversal

`computeReversal` menerima baris tercatat snapshot, mode dan skala pembulatan, dan
apa yang sudah diambil reversal-reversal sebelumnya atas asli yang sama. Ia **tak
punya masukan aturan**. Untuk tiap baris yang diminta (atau setiap baris yang masih
punya kuantitas, bila `lines` dihilangkan):

1. `sisa = kuantitas asli − yang sudah di-reverse`. Permintaan harus memenuhi
   `0 < q ≤ sisa`.
2. Jika `q = sisa`, jumlahnya adalah **sisa** eksak neto asli dan pajak tiap
   komponen.
3. Jika tidak, tiap jumlah adalah `round(asli × q / Q)` dengan mode dan skala
   snapshot sendiri, **dibatasi** pada apa yang belum di-reverse.
4. Jumlah negatif; kuantitas tetap positif; `originalLineRef` menamai baris yang
   di-reverse.

Membulatkan reversal per baris, bahkan pada pembulatan tingkat-`document`, adalah
sengaja: refund menyasar baris. Pembatasan dan aturan sisa itulah yang menjamin
jumlah seluruh reversal tak pernah melebihi — dan, bila semuanya dikembalikan,
selalu sama dengan — yang asli.

## 7. Kamus data

### `awcms_tax_rule_versions` (`sql/171`)

| Kolom                                            | Tipe               | Catatan                                                                       |
| ------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------- |
| `id`                                             | uuid PK            |                                                                               |
| `tenant_id`                                      | uuid               | RLS `ENABLE` + `FORCE`; `UNIQUE (tenant_id, id)`                              |
| `profile_code`                                   | text               | `^[a-z0-9][a-z0-9_.-]{0,62}$`; `UNIQUE (tenant_id, profile_code, version_no)` |
| `version_no`                                     | integer            | ditetapkan server di bawah lock profil                                        |
| `status`                                         | text               | `draft` · `published`                                                         |
| `name`                                           | text               |                                                                               |
| `jurisdiction_code`                              | text               | buram, ditentukan tenant; tak ada daftar negara yang dikirim                  |
| `country_code`                                   | char(2)            | opsional                                                                      |
| `region_code`                                    | text               | opsional                                                                      |
| `currency_code`                                  | char(3)            |                                                                               |
| `pricing_mode`                                   | text               | CHECK                                                                         |
| `rounding_mode`                                  | text               | CHECK, tujuh nilai                                                            |
| `rounding_scale`                                 | smallint           | CHECK 0–6                                                                     |
| `rounding_level`                                 | text               | CHECK `line` · `document`                                                     |
| `effective_from`                                 | date               | inklusif                                                                      |
| `effective_to`                                   | date               | eksklusif; null = terbuka; CHECK `> effective_from`                           |
| `definition`                                     | jsonb              | `{categories, rules}`; CHECK objek, ≤ 256 KiB                                 |
| `notes`                                          | text               |                                                                               |
| `created_at/by`, `updated_at`, `published_at/by` | timestamptz / uuid | `published_at` wajib saat terbit                                              |

Trigger: `awcms_tax_rule_versions_guard` (baris terbit tak berubah; satu perubahan
yang diizinkan adalah menutup jendela terbuka maju, sekali) dan
`awcms_tax_rule_versions_no_overlap` (advisory lock pada `(tenant, profil)`, lalu
tolak jendela terbit yang tumpang tindih).

Bentuk `definition`:

```jsonc
{
  "categories": [
    { "code": "books", "name": "Books", "description": "opsional" }
  ],
  "rules": [
    {
      "categoryCode": null,
      "treatment": "taxable",
      "components": [
        { "code": "vat", "name": "VAT", "rate": "11", "basis": "net" }
      ]
    },
    { "categoryCode": "books", "treatment": "exempt", "components": [] }
  ]
}
```

Paling banyak 200 kategori, 201 aturan (satu per kategori plus satu fallback), 8
komponen per aturan. Kategori setiap aturan harus dideklarasikan; satu kategori satu
aturan; paling banyak satu fallback; kode komponen unik dalam satu aturan.

### `awcms_tax_snapshots` (`sql/172`)

| Kolom                                                                                                                          | Tipe              | Catatan                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------ |
| `id`                                                                                                                           | uuid PK           |                                                                                      |
| `tenant_id`                                                                                                                    | uuid              | RLS `ENABLE` + `FORCE`                                                               |
| `kind`                                                                                                                         | text              | `sale` · `reversal`                                                                  |
| `document_type`, `document_id`                                                                                                 | text              | rujukan buram milik konsumen; `UNIQUE (tenant_id, kind, document_type, document_id)` |
| `original_snapshot_id`                                                                                                         | uuid              | hanya reversal; **bukan** FK (retensi boleh menghapus asli yang sudah tua)           |
| `rule_version_id`                                                                                                              | uuid              | FK komposit `(tenant_id, rule_version_id)` → versi                                   |
| `profile_code`, `version_no`, `tax_date`, `currency_code`, `pricing_mode`, `rounding_mode`, `rounding_scale`, `rounding_level` |                   | disalin dari versi saat penulisan                                                    |
| `rule_definition`                                                                                                              | jsonb             | **salinan** definisi versi — baris berdiri sendiri                                   |
| `lines`                                                                                                                        | jsonb             | hasil per baris dengan komponen (bentuk: `TaxLineResult`)                            |
| `component_totals`, `treatment_totals`                                                                                         | jsonb             |                                                                                      |
| `net_total`, `tax_total`, `gross_total`                                                                                        | numeric(24,6)     | bertanda: ≥ 0 untuk penjualan, ≤ 0 untuk reversal; CHECK `bruto = neto + pajak`      |
| `input_hash`                                                                                                                   | text              | sha256 permintaan ternormalisasi                                                     |
| `reason`                                                                                                                       | text              | reversal                                                                             |
| `created_at`, `created_by`                                                                                                     | timestamptz, uuid |                                                                                      |

Trigger: `awcms_tax_snapshots_immutable` (tanpa update; tanpa delete yang lebih muda
dari 1826 hari), `awcms_tax_snapshots_guard` (reversal harus menamai penjualan nyata
di tenant ini, dengan tipe dokumen dan versi aturannya, dan tak boleh menurunkan
total neto atau pajak ter-reverse di bawah nol; ia mengunci yang asli).

## 8. Matriks izin dan RLS

Semua rute memakai `defineTenantRoute` → `authorizeInTransaction` (default-deny,
ABAC, modul-aktif, log keputusan). Setiap tabel `FORCE ROW LEVEL SECURITY` pada
`tenant_id = current_setting('app.current_tenant_id')`.

| Operasi                                                                    | Izin                              | Berisiko-tinggi | `Idempotency-Key`   | Audit                            | Event                              |
| -------------------------------------------------------------------------- | --------------------------------- | --------------- | ------------------- | -------------------------------- | ---------------------------------- |
| `GET  /tax/rule-versions`, `GET …/{id}`                                    | `tax.rules.read`                  | tidak           | —                   | log keputusan                    | —                                  |
| `POST /tax/rule-versions` (draf)                                           | `tax.rules.configure`             | ya              | wajib               | `info`                           | —                                  |
| `POST /tax/rule-versions/{id}/publish`                                     | `tax.rules.publish`               | ya              | wajib               | `critical`                       | `awcms.tax.rule_version.published` |
| `POST /tax/quote`                                                          | `tax.calculations.analyze`        | tidak           | — (tanpa efek)      | log keputusan                    | —                                  |
| `POST /tax/snapshots` (finalisasi)                                         | `tax.snapshots.create`            | tidak           | wajib + kunci alami | `info`                           | `awcms.tax.snapshot.finalised`     |
| `GET  /tax/snapshots`, `GET …/{id}`                                        | `tax.snapshots.read`              | tidak           | —                   | log keputusan                    | —                                  |
| `POST /tax/snapshots/{id}/reverse`                                         | `tax.snapshots.reverse`           | ya (`reverse`)  | wajib + kunci alami | `critical`                       | `awcms.tax.snapshot.reversed`      |
| `taxDate` di luar jendela tanggal-server, pada salah satu dari dua di atas | **juga** `tax.snapshots.backdate` | ya (`backdate`) | seperti di atas     | `backdated: true` di baris audit | —                                  |
| `GET  /tax/reports/reconciliation`                                         | `tax.reports.read`                | tidak           | —                   | log keputusan                    | —                                  |

Replay (kunci sama, atau dokumen dan permintaan sama) tidak menulis baris audit dan
tidak menerbitkan event. Izin dibenihkan `sql/173` hanya ke katalog; peran `owner`
tenant yang sudah ada menerimanya dari job backfill izin-owner.

## 9. Ringkasan API dan kode error

| Status | Kode                               | Kapan                                                                                                  |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`                 | body cacat, kunci tak dikenal, angka di tempat yang butuh string                                       |
| 400    | `TAX_AMOUNT_NOT_ACCEPTED`          | kunci yang menamai field uang terhitung (`taxAmount`, `vat`, `total`…)                                 |
| 400    | `IDEMPOTENCY_REQUIRED`             | panggilan mutasi tanpa header                                                                          |
| 403    | `ACCESS_DENIED`                    | default-deny                                                                                           |
| 404    | `RESOURCE_NOT_FOUND`               | versi, snapshot, atau asli yang tak dikenal (atau milik tenant lain)                                   |
| 409    | `IDEMPOTENCY_CONFLICT`             | kunci dipakai ulang dengan permintaan berbeda                                                          |
| 409    | `TAX_VERSION_OUT_OF_ORDER`         | terbit pada atau sebelum `effectiveFrom` terbit terbaru                                                |
| 409    | `TAX_VERSION_BACKDATED`            | terbit sebelum tanggal server, atau pada/sebelum tanggal pajak yang sudah difinalisasi di bawah profil |
| 403    | `TAX_BACKDATE_PERMISSION_REQUIRED` | `taxDate` di luar jendela tanggal-server tanpa `tax.snapshots.backdate`                                |
| 409    | `TAX_VERSION_ALREADY_PUBLISHED`    |                                                                                                        |
| 409    | `TAX_DOCUMENT_ALREADY_FINALISED`   | dokumen sama, permintaan berbeda (juga id dokumen reversal yang dipakai ulang)                         |
| 422    | `TAX_RULE_VERSION_NOT_FOUND`       | tak ada versi terbit yang mencakup `taxDate`                                                           |
| 422    | `TAX_RULE_NOT_FOUND`               | kategori tak punya aturan dan tak ada fallback                                                         |
| 422    | `TAX_INPUT_INVALID`                | jumlah buruk, diskon > baris, kuantitas nol, jumlah terlalu kecil                                      |
| 422    | `TAX_REVERSAL_INVALID`             | baris tak dikenal, pengembalian berlebih, tak ada yang tersisa                                         |

## 10. Rekonsiliasi dan pelaporan

- **Proyeksi** `tax.snapshot_activity` pada engine `reporting`: menghitung
  `snapshots_total`, `sales_finalised`, `reversals_recorded`. Kesegaran 5 menit /
  basi 30 menit. `cursor_table` atas `awcms_tax_snapshots` yang append-only. Aturan
  metrik engine hanya bisa menghitung.
- **Laporan** `GET /api/v1/tax/reports/reconciliation?from=&to=[&profileCode=]`:
  per versi, per komponen, per perlakuan (masing-masing dipisah sale / reversal),
  dinetkan per mata uang, dan `integrity` — `documentsChecked`, `lineSumMismatches`,
  `componentSumMismatches`. Kalkulator tak bisa menghasilkan selisih tak-nol, jadi
  hitungan tak-nol berarti sebuah baris ditulis dengan cara lain. Rentang ≤ 366 hari;
  jumlah adalah penjumlahan `numeric` yang dirender sebagai desimal eksak dengan nol
  di ujung dipangkas.

## 11. Kontrak adapter migrasi — meninggalkan persentase datar tingkat-toko

Untuk konsumen (`awcms-one#293`, `awcms-astro`, etalase atau POS mana pun) yang hari
ini memegang `storeTaxPercent` dan menghitung `pajak = subtotal × persen`.

**A. Setup satu kali (per tenant).** Buat satu profil dan terbitkan satu versi:

| Field                    | Dari perilaku konsumen saat ini                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profileCode`            | `store-default`                                                                                                                                                           |
| `definition.rules`       | satu aturan fallback: `taxable`, satu komponen `{code: "tax", rate: storeTaxPercent, basis: "net"}`                                                                       |
| `pricingMode`            | `inclusive` bila harga toko sudah termasuk pajak, selain itu `exclusive`                                                                                                  |
| `roundingMode` / `Level` | yang dilakukan konsumen hari ini: biasanya `half_up`; `line` bila membulatkan per baris, `document` bila sekali atas total                                                |
| `roundingScale`          | digit unit-minor mata uang                                                                                                                                                |
| `effectiveFrom`          | hari ini atau setelahnya — sebuah versi tak bisa berlaku sebelum tanggal server, jadi tanggal cutover adalah `taxDate` paling awal yang bisa ditanyakan **lewat API ini** |

**B. Runtime.** Ganti perkalian persentase dengan panggilan, tidak lebih: ubah
keranjang → `POST /tax/quote`; buat pesanan → `POST /tax/snapshots` dengan
`documentType = "order"`, `documentId = <id pesanan>`; simpan `id` snapshot yang
dikembalikan pada pesanan; retur/refund → `POST /tax/snapshots/{id}/reverse` dengan
id refund itu sendiri. **Jangan pernah mengirim jumlah pajak** — ditolak. Jangan
pernah menghitung ulang pajak dari baris pesanan secara lokal: snapshot adalah
angkanya.

**C. Kategori.** Petakan tiap kelas pajak produk/jasa ke `code` kategori; biarkan
`categoryCode` null untuk "standar". Tambahkan aturan dibebaskan atau tarif-nol per
kategori yang membutuhkannya. Produk dengan kategori yang tak punya aturan di versi
gagal dengan `TAX_RULE_NOT_FOUND` kecuali ada fallback — yang dimiliki
`store-default`.

**D. Pengaturan menjadi sebuah peristiwa.** Mengubah persentase bukan lagi sunting:
susun draf baru dengan tarif baru dan `effectiveFrom` di masa depan (atau tanggal
perubahan), terbitkan (izin yang diberikan terpisah), dan jendela pendahulunya
tertutup otomatis. Dokumen lama tak tersentuh secara konstruksi.

**E. Sejarah tidak dihitung ulang.** Dokumen yang terbit sebelum cutover mempertahankan
jumlah saat ia terbit. API ini menghitung; ia tak pernah mengimpor jumlah, jadi tak
ada endpoint backfill dan tak direncanakan. Konsumen yang butuh snapshot untuk
pesanan historis memfinalisasinya dengan `taxDate` asli pesanan — yang menuntut versi
yang mencakup tanggal itu, dan karena itu `effectiveFrom` yang cukup awal.

**F. Rollout dan paritas.** Jalankan jalur baru secara bayangan lebih dulu: untuk
sampel keranjang nyata bandingkan `quote.taxTotal` dengan angka lama. Dengan
persentase, mode harga, mode pembulatan, skala, dan level yang sama, selisihnya
tepat nol; selisih apa pun adalah ketidakcocokan konfigurasi di langkah A, bukan
toleransi pembulatan. Cutover per tenant di balik flag sisi-konsumen; rollback
adalah flag itu.

**G. POS offline.** POS harus tetap berjualan tanpa jaringan. Dua bentuk yang
didukung, tak satu pun dikirim di sini: (1) antrekan penjualan secara lokal dan
panggil `POST /tax/snapshots` saat sync (id dokumen membuat replay idempoten di
bawah kunci apa pun); (2) tanamkan kalkulator murni dan cache
`GET /tax/rule-versions/{id}`, yang adalah semua yang ia butuhkan. Pada (2) angka
lokal adalah angka **tampilan** — snapshot server yang otoritatif, dan struk tak
boleh mengklaim sebaliknya sampai ia ada.

## 12. Batas dan celah yang diketahui

- Permukaan operator: `/admin/tax` (Issue #894, tindak lanjut 1 ADR-0127) — profil dan versi aturan (draf, terbitkan dengan konfirmasi), daftar dan detail snapshot, serta laporan rekonsiliasi. Definisi aturan ditulis di editor baris terstruktur (Issue #901: kategori, aturan, komponen bertumpuk, tarif sebagai string desimal eksak) yang diserialisasi ke textarea JSON yang dikirim formulir — textarea tetap sebagai cadangan lanjutan/tanpa skrip dan server tetap otoritatif. Quote, finalise, reverse, dan backdate tetap aksi konsumen tanpa layar.
- Tanpa profil negara (tindak lanjut 2). Tanpa ekspor Coretax/e-faktur (tindak lanjut 6).
- Tanpa penghapusan draf; draf terbengkalai tetap ada (tak pernah di-resolve).
- Versi ditambahkan berurutan waktu; tak ada penerbitan ke masa lalu.
- 500 baris per dokumen; 200 kategori dan 8 komponen per aturan; 256 KiB per definisi.
- Sunting bergaya `PATCH` atas draf tidak ditawarkan: buat draf baru.
- Reversal tanpa `taxDate` bertanggal **server** (bukan tanggal aslinya); yang dinyatakan
  dibatasi jendela yang sama dengan finalisasi. Sebuah versi tak bisa diterbitkan sebelum
  tanggal server, maupun pada atau sebelum tanggal pajak yang sudah difinalisasi di bawah profilnya.
- `/quote` tidak dijendelakan (tak mencatat apa pun); `/snapshots` dan tanggal reversal yang dinyatakan, ya.
- Daftar mengembalikan ringkasan (tanpa `lines`, tanpa `definition`); detail snapshot menamai
  versi aturannya tetapi tidak menanamkan definisinya (`tax.rules.read`).
- Setiap jumlah harus di bawah 10^18 (harus muat di `numeric(24,6)`): `TAX_INPUT_INVALID`.

## 13. Rollout

1. **Terapkan migrasi** (`sql/171`–`sql/173`). `sql/173` hanya memperluas katalog izin.
2. **Tenant yang sudah ada harus di-backfill.** Tenant yang dibuat sebelum `sql/173`
   berjalan punya peran `owner` tanpa sembilan izin `tax.*`, sehingga setiap rute pajak
   menjawab `403 ACCESS_DENIED` untuknya — diam-diam, dengan kode yang tampak benar.
   Jalankan sekali per deployment setelah migrasi:

   ```bash
   bun run identity-access:permissions:backfill            # dry run: melaporkan yang akan diberikan
   bun run identity-access:permissions:backfill --commit   # memberikan izin yang lebih baru dari peran owner
   ```

   Ia hanya memberikan izin yang baris katalognya lebih baru dari peran (tidak
   menghidupkan kembali grant yang sengaja dicabut administrator). Tenant yang dibuat
   setelah migrasi tidak butuh apa pun.

3. **Pengaturan** (opsional): `TAX_TAXDATE_PAST_DAYS` (default 7) dan
   `TAX_TAXDATE_FORWARD_DAYS` (default 1) membatasi jendela tanggal pajak; lihat
   `.env.example`. Berikan `tax.snapshots.backdate` hanya pada peran yang memang
   memposting ke periode tertutup.
4. **Susun dan terbitkan versi aturan pertama** (`effectiveFrom` hari ini atau setelahnya)
   sebelum konsumen mana pun memanggil `/quote` atau `/snapshots`; sebelum itu keduanya
   menjawab `422 TAX_RULE_VERSION_NOT_FOUND`.
