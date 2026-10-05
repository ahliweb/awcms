🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](procurement.md)

<!-- i18n-source-hash: sha256:f222233bcd9d00eec4781edd7c2fbb58b18cc6df0b0f25276a9306e1540feb36 -->

<!-- i18n-source-hash: sha256:pending -->

# Procurement — pemasok, penerimaan, dan transfer (paket dokumen modul)

> **Status:** diterima lewat [ADR-0128](../adr/0128-generic-procurement-supplier-receiving-transfer-module-admission.id.md)
> (Issue #888). PRD-lite, state machine penerimaan, ERD, matriks izin/RLS,
> kontrak dengan buku besar inventori, rekonsiliasi, dan rollback di satu tempat.
> Keputusan dan alternatif yang ditolak ada di ADR; peta kode di
> [`src/modules/procurement/README.md`](../../src/modules/procurement/README.id.md);
> kontrak HTTP di
> [`openapi/modules/procurement.openapi.yaml`](../../openapi/modules/procurement.openapi.yaml)
> dan kontrak event adalah dua kanal `awcms.procurement.*` di
> [`asyncapi/awcms-domain-events.asyncapi.yaml`](../../asyncapi/awcms-domain-events.asyncapi.yaml).
> Modul ini bertumpu pada buku besar stok di [`inventory-ledger.md`](inventory-ledger.id.md).

## 1. PRD-lite

**Masalah.** Modul domain yang membeli atau memindahkan barang butuh pihak lawan
(pemasok dengan data pajak dan pembayaran), dokumen yang dapat dibuat, ditinjau,
disetujui, dan dikoreksi, serta siklus hidup yang membuat saat stok berubah
tak ambigu. Dibangun per konsumen, masing-masing berbeda dalam cara membuat stok salah.

**Tujuan.** Satu modul generik: pemasok sebagai peran bisnis di atas pihak
kanonik, empat mode dokumen, siklus hidup yang ditegakkan, dan efek stok yang
hanya ada sebagai movement ledger.

**Pengguna.** Staf pembelian (menyusun draft), kepala gudang (submit dan finalise),
penyetuju (workflow), pembaca keuangan (laporan, reveal NPWP), auditor (rekonsiliasi).

**Kriteria penerimaan (dari issue) dan di mana dipenuhi**

| Kriteria                                                                                 | Di mana                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Peran pemasok yang mereferensi pihak kanonik; kode, status, kategori, tag                | `awcms_procurement_suppliers` (+ `_labels`), `profile_id` FK komposit opsional; ADR §2           |
| Identifier pajak/bisnis ber-klasifikasi sensitivitas; referensi bayar/kontak             | `awcms_procurement_supplier_identifiers`; `tax_id`/`business_id` dipaksa `sensitive`; di-mask    |
| Dokumen penerimaan: pemasok, lokasi, referensi eksternal, tanggal, catatan, baris, aktor | `awcms_procurement_documents` + `_lines`; stempel aktor per transisi                             |
| Mode: receive, retur pemasok, requisition, transfer lokasi (movement berpasangan)        | CHECK `mode`; ledger `receive`/`supplier_return`/pasangan transfer                               |
| Snapshot baris SKU, nama, satuan, biaya                                                  | `sku`, `item_name`, `unit_code`, `unit_cost` pada baris; snapshot kode/nama pemasok pada dokumen |
| draft → submitted/finalised/cancelled/reversed, finalise idempoten                       | state machine ditegakkan trigger; §2                                                             |
| Finalise membuat movement dan tak pernah menulis saldo                                   | tak ada penulisan `awcms_inventory_*` di modul (hanya membaca); hanya `InventoryLedgerPort`      |
| Persetujuan opsional lewat `workflow_approval`                                           | `approval_threshold`; lunak, fail-closed; ADR §9                                                 |
| Proyeksi pelaporan                                                                       | `procurement.receiving`, `procurement.suppliers`; laporan live di `/procurement/reports/*`       |

**Ambang persetujuan.** `approval_threshold` **berbasis biaya dan hanya mencakup `receive` dan `supplier_return`** (keduanya mewajibkan `unitCost` pada setiap baris). `requisition` dan `transfer` tak membawa biaya dan **tidak** dibatasi; gerbang berbasis mode/kuantitas adalah tindak lanjut.

**Non-goal.** Buku besar hutang usaha penuh; panggilan jaringan/provider dalam
transaksi database; purchase order; penerimaan parsial satu dokumen; costing/valuasi;
portal pemasok. (Layar admin mendarat di Issue #905; lihat §9.)

## 2. State machine penerimaan

```
draft ──submit──> submitted ──finalise──> finalised ──reverse──> reversed
  │                   │
  └────cancel─────────┴───────cancel────> cancelled
```

| Transisi                    | Izin                 | Stok                                                | Idem. | Audit    |
| --------------------------- | -------------------- | --------------------------------------------------- | ----- | -------- |
| (buat) → draft              | `documents.create`   | tidak ada                                           | ya    | info     |
| edit draft                  | `documents.update`   | tidak ada                                           | tidak | info     |
| draft → submitted           | `documents.submit`   | tidak ada (memulai persetujuan bila di atas ambang) | ya    | info     |
| submitted → finalised       | `documents.finalise` | **memposting** movement ledger, semua atau tidak    | ya    | warning  |
| draft/submitted → cancelled | `documents.cancel`   | tidak ada; menarik persetujuan yang menunggu        | ya    | warning  |
| finalised → reversed        | `documents.reverse`  | **memposting** movement kompensasi                  | ya    | critical |

Aturan yang ditegakkan database (trigger `awcms_procurement_documents_update_guard`),
bukan hanya handler: hanya transisi ini; per transisi hanya kolom yang boleh
diubahnya; `cancelled` dan `reversed` terminal; baris hanya dapat ditulis selama
induknya `draft`; dokumen finalised/reversed hanya berstatus approval `not_required`/`approved`, approval bergerak `pending → approved|rejected` sekali dan instance-nya tak pernah berubah; dokumen finalised tak dapat diedit, dialihkan, atau dihapus,
bahkan oleh pemilik tabel; `finalised`/`cancelled`/`reversed` masing-masing
dicapai paling banyak sekali.

Penolakan dan kodenya: `INVALID_STATE` (409), `APPROVAL_PENDING` /
`APPROVAL_REJECTED` (409), `APPROVAL_WORKFLOW_NOT_CONFIGURED` /
`APPROVAL_WORKFLOW_MISCONFIGURED` (409, fail closed), `SUPPLIER_UNAVAILABLE` (409),
`LOCATION_INACTIVE`, `INSUFFICIENT_STOCK`, `UNIT_MISMATCH`, `QUANTITY_OUT_OF_RANGE`
(penolakan ledger; seluruh dokumen tidak memposting apa pun),
`DUPLICATE_EXTERNAL_REFERENCE`, `IDEMPOTENCY_REQUIRED` (400), `IDEMPOTENCY_CONFLICT` (409).

## 3. ERD dan kamus data

| Tabel                                    | Isi                                                                                                                                                                  | Hak `awcms_app`                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `awcms_procurement_settings`             | `approval_threshold` (`NULL` = mati)                                                                                                                                 | SELECT, INSERT, UPDATE                    |
| `awcms_procurement_suppliers`            | kode vendor, status, nama, `profile_id` opsional, stempel soft-delete                                                                                                | SELECT, INSERT, UPDATE (tanpa DELETE)     |
| `awcms_procurement_supplier_labels`      | kategori dan tag (≤ 20 masing-masing), diganti utuh saat edit                                                                                                        | SELECT, INSERT, DELETE                    |
| `awcms_procurement_supplier_identifiers` | tipe, klasifikasi, nilai ternormalisasi (**plaintext di bawah RLS**, tidak dienkripsi), hash SHA-256 **tanpa kunci** bersama `profile_identity`, mask — **sensitif** | SELECT, INSERT, DELETE                    |
| `awcms_procurement_documents`            | mode, status, referensi dan snapshot pemasok/lokasi, referensi eksternal, total, persetujuan                                                                         | SELECT, INSERT, UPDATE (**tanpa DELETE**) |
| `awcms_procurement_document_lines`       | referensi item, snapshot SKU/nama/satuan, kuantitas, biaya satuan, `line_total` dihitung DB                                                                          | tulis hanya saat draft (trigger)          |
| `awcms_procurement_document_movements`   | baris dokumen ↔ movement ledger, `operation` `post`/`reversal`                                                                                                       | SELECT, INSERT (**tanpa UPDATE/DELETE**)  |
| `awcms_procurement_document_events`      | log `submitted`/`finalised`/`cancelled`/`reversed`; `kind_mode`, `supplier_event_kind` generated                                                                     | SELECT, INSERT (**tanpa UPDATE/DELETE**)  |

Uang dan kuantitas adalah `numeric` dan **string** desimal di wire. Setiap
referensi adalah foreign key komposit `(tenant_id, id)`, termasuk ke
`awcms_profiles`, `awcms_inventory_locations`, dan `awcms_inventory_movements`.
`awcms_worker` hanya memegang `SELECT` pada `awcms_procurement_document_events`.

## 4. Matriks izin dan RLS

Semua route adalah `defineTenantRoute`, mengotorisasi lewat
`authorizeInTransaction` (ADR-0063), dan default-deny. `sql/175` men-seed katalog
dan **tidak memberi** apa pun ke role mana pun; tenant lama memakai
`bun run identity-access:permissions:backfill`.

| Metode dan path                                    | Izin                                                                    | Risiko      |
| -------------------------------------------------- | ----------------------------------------------------------------------- | ----------- |
| `GET /procurement/suppliers`, `/{id}`              | `suppliers.read` (`includeDeleted=true` juga butuh `suppliers.restore`) |             |
| `POST /procurement/suppliers`                      | `suppliers.create`                                                      |             |
| `PATCH /procurement/suppliers/{id}`                | `suppliers.update`                                                      |             |
| `DELETE /procurement/suppliers/{id}`               | `suppliers.delete`                                                      |             |
| `POST /procurement/suppliers/{id}/restore`         | `suppliers.restore`                                                     |             |
| `GET/POST …/identifiers`                           | `suppliers.read` / `.update`                                            |             |
| `DELETE …/identifiers/{identifierId}`              | `suppliers.update`                                                      |             |
| `POST …/identifiers/{identifierId}/reveal`         | `suppliers.reveal`                                                      | **tinggi**  |
| `GET /procurement/documents`, `/{id}`              | `documents.read`                                                        |             |
| `POST /procurement/documents`                      | `documents.create`                                                      |             |
| `PATCH /procurement/documents/{id}`                | `documents.update`                                                      |             |
| `POST …/{id}/submit`                               | `documents.submit`                                                      |             |
| `POST …/{id}/finalise`                             | `documents.finalise`                                                    | **tinggi**  |
| `POST …/{id}/cancel`                               | `documents.cancel`                                                      |             |
| `POST …/{id}/reversal`                             | `documents.reverse`                                                     | **tinggi**  |
| `GET /procurement/documents/reconciliation`        | `documents.reconcile`                                                   |             |
| `GET/PUT /procurement/policy`                      | `policy.read` / `policy.configure`                                      | high-impact |
| `GET /procurement/reports/receiving`, `/suppliers` | `reports.read`                                                          |             |

Tabel: semuanya punya `tenant_id`, RLS `ENABLE`+`FORCE`, policy dengan `USING`
dan `WITH CHECK`; diverifikasi suite integrasi sebagai role runtime (`awcms_app`),
termasuk bahwa ia tak dapat membaca atau menulis baris tenant lain.

## 5. Kontrak dengan buku besar inventori

Procurement adalah **konsumen** `InventoryLedgerPort` dan memikul kewajiban
konsumen yang tertulis di `_shared/ports/inventory-ledger-port.ts`:

- **Verifikasi sumber.** Baris hanya diposting dari dokumen yang baru dibaca
  dengan `FOR UPDATE`, di tenant pemanggil, pada satu-satunya status yang boleh memposting.
- **Otorisasi sebelum posting.** Route mengotorisasi (`finalise`/`reverse`)
  sebelum fungsi aplikasi berjalan; fungsi itu mengaudit dan meneruskan
  correlation id ke setiap baris ledger.
- **Tak pernah menulis saldo.** Tidak ada penulisan `awcms_inventory_*` di sini.

| Mode              | Finalise memposting                   | Reverse memposting                 |
| ----------------- | ------------------------------------- | ---------------------------------- |
| `receive`         | `postReceipt` di `location_id`        | `postSupplierReturn` (lokasi sama) |
| `supplier_return` | `postSupplierReturn` di `location_id` | `postReceipt`                      |
| `requisition`     | `postTransfer` sumber → `location_id` | `postTransfer` kembali             |
| `transfer`        | `postTransfer` sumber → `location_id` | `postTransfer` kembali             |

Tipe sumber: `procurement_receipt`, `procurement_supplier_return`,
`procurement_requisition`, `procurement_transfer`, masing-masing dengan
`…_reversal` tersendiri. Posting semua-baris-atau-tidak dalam satu savepoint,
berurutan `(item_type, item_ref, line_no)`.

## 6. Event

| Event                                  | Kapan                                        |
| -------------------------------------- | -------------------------------------------- |
| `awcms.procurement.document.finalised` | Sekali per dokumen finalised, transaksi sama |
| `awcms.procurement.document.reversed`  | Sekali per dokumen reversed, transaksi sama  |

Keduanya lewat outbox domain-event; panggilan yang ditolak atau di-replay tidak
menerbitkan apa pun. Payload: id opak, mode, jumlah baris, dan total string
desimal — tidak pernah nama pemasok, identifier, catatan, atau alasan.

## 7. Rekonsiliasi, pelaporan, dan verifikasi

- **Rekonsiliasi** (`GET /procurement/documents/reconciliation`): per baris
  finalised/reversed, ledger memuat persis movement tertaut; mendaftar tautan
  hilang, movement beridentitas procurement yang diposting dari luar modul, dan
  kuantitas/lokasi yang berbeda. Read-only; dibatasi tenant.
- **Proyeksi** `procurement.receiving` (6 counter) dan `procurement.suppliers`
  (3 counter) di atas tabel event append-only; setiap metrik monotonik.
- **Tes:** `tests/procurement-validation.test.ts` (murni),
  `tests/integration/procurement-database.integration.test.ts` (RLS, FK komposit
  lintas tenant, state machine trigger, immutability, hak, rekonsiliasi, proyeksi)
  dan `tests/integration/procurement-api.integration.test.ts` (setiap guard
  high-risk dua arah, replay dan konkurensi finalise, semua-atau-tidak, transfer,
  reversal, masking dan reveal, persetujuan) terhadap database nyata.

## 8. Rollback dan operasi

Forward-only seperti setiap migrasi di sini. Berhenti memakai modul: berhenti
memanggilnya dan (opsional) nonaktifkan per tenant; tabel inert dan ledger tetap
valid sendiri. Menghapusnya adalah keputusan kelas restore. Setelah restore apa pun
jalankan rekonsiliasi procurement **dan** inventory: dokumen dan ledger harus
kembali dari titik waktu yang sama. Tak ada yang mem-purge tabel ini (ADR §7).
Untuk memberi tenant lama izin baru jalankan `bun run identity-access:permissions:backfill`.

## 9. Batasan dan tindak lanjut

Batasan yang dinyatakan eksplisit (ADR-0128):

- **Reveal tanpa step-up dan tanpa rate limit.** Tak ada reveal saudara yang bisa ditiru (`profile_identity` tak punya reveal teks-polos; tak ada reveal lain yang membawa perlindungan itu), dan `requireStepUp` tanpa syarat adalah jebakan ADR-0058 §E. Reveal hanya diaudit, `no-store`, dan berizin sendiri.
- **Ambang persetujuan berbasis biaya.** Dokumen berbiaya nol atau tak diisi, serta semua requisition dan transfer, melewatinya.
- **Tanpa ABAC per-lokasi dan tanpa maker/checker bawaan.** Memisahkan `documents.submit` dari `documents.finalise` adalah kewajiban operator: tulis aturan SoD atas kedua aksi high-risk itu.
- Saat anonimisasi, tautan `profile_id` pemasok **dipertahankan** (menunjuk profil teranonimkan); nama dagang dipertahankan di bawah kewajiban financial_tax.
- Menambah identifier yang sudah dimiliki pemasok bersifat idempoten (`201` pengakuan seragam berisi tipe, label, nilai ter-mask, dan klasifikasi — tanpa id, tanpa timestamp — identik untuk nilai baru maupun yang sudah dimiliki, sehingga bukan oracle kesamaan); identifier pemasok soft-deleted tak terjangkau sampai dipulihkan; laporan pemasok memuat pemasok soft-deleted dengan `deleted: true`.

- **Batas tingkat-DB aturan approval.** Basis data menolak `finalised`/`reversed` kecuali approval `not_required|approved` dan mengunci instance setelah submit, tetapi mempercayai aplikasi pada `draft → submitted`: ia tak dapat memastikan status `approved` yang ditulis saat submit berasal dari keputusan workflow sungguhan.

Tindak lanjut tercatat:

Dicatat oleh audit keamanan: step-up dan rate limit pada reveal; izin lebih ketat untuk referensi pembayaran/kontak dan soft-delete identifier; hash berkunci dan enkripsi at-rest untuk `normalized_value`; gerbang persetujuan berbasis mode/kuantitas untuk requisition dan transfer; idempotensi terikat aktor di `inventory`.

Layar admin **mendarat di Issue #905** (`/admin/procurement`, modul `active`,
navigasi dijaga `procurement.documents.read`): pemasok (buat/ubah, soft-delete/
pulihkan, identifier ter-mask, tambah/hapus, dan reveal ber-audit yang tampil
sekali dan tak pernah di-cache), dokumen semua mode (draf dengan baris, submit,
finalise, cancel dan reverse dengan alasan wajib, masing-masing ber-`Idempotency-Key`),
ambang persetujuan, laporan penerimaan dan pemasok, serta rekonsiliasi. Tidak
ada di layar: menyunting draf di tempat (`documents.update`; batalkan lalu
masukkan ulang) dan celah sisa di atas (step-up reveal, ambang hanya-biaya, ABAC
berlingkup lokasi). Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill`
sebelum peran mereka melihat layar ini. Masih terbuka: purchase
order dan penerimaan terhadap order; penerimaan parsial; costing; archive-then-purge.
