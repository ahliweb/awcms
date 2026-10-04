🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:cdf231468e02b2cdbbc80f11be27279f4b0ee5783635492f18e2edcc8e94f62a -->

# `inventory`

**Buku besar stok** multi-lokasi generik yang dapat diaudit (Issue #887,
[ADR-0126](../../../docs/adr/0126-generic-multi-location-stock-ledger-module-admission.id.md)).

OTORITAS inventori bagi modul domain mana pun — commerce, POS, storefront — yang
hari ini menyimpan counter stoknya sendiri pada baris produk. Paket desain
lengkap (PRD-lite, ERD, kamus data, matriks izin/RLS, kontrak adapter konsumen,
jalur migrasi, rollback) ada di
[`docs/awcms/inventory-ledger.md`](../../../docs/awcms/inventory-ledger.id.md);
berkas ini adalah peta kodenya.

## Satu aturan

`awcms_inventory_movements` adalah kebenaran dan bersifat **append-only**.
`awcms_inventory_balances` adalah read model yang selalu sama dengan jumlahnya.
Tidak ada yang menulis `on_hand` selain `postLegs` di
`application/inventory-ledger.ts`, dalam transaksi yang sama dengan movement
yang mengubahnya. **Klien tidak pernah bisa menegaskan saldo**: tak ada endpoint
yang menerimanya, setiap body request divalidasi ketat, dan body yang menyebut
`onHand`/`balanceAfter` adalah `400`.

## Tata letak

| Path                                           | Isinya                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `module.ts`                                    | Deskriptor: 12 izin, 2 event, proyeksi `inventory.low_stock`, `dataLifecycle` + `subjectData` untuk setiap tabel                 |
| `domain/inventory-types.ts`                    | Tipe movement, tanda yang dimiliki masing-masing, kebijakan — murni                                                              |
| `domain/inventory-quantity.ts`                 | Parsing/format desimal eksak di atas `BigInt` sejuta-an — tanpa float sama sekali                                                |
| `domain/inventory-validation.ts`               | Validator request ketat, fingerprint replay, penjaga bentuk-kredensial pada id buram                                             |
| `domain/inventory-permissions.ts`              | `INVENTORY_GUARDS` — objek guard literal (gerbang cakupan-penegakan hanya mengenalinya sebagai literal)                          |
| `domain/inventory-events.ts`                   | Konstanta tipe/versi event                                                                                                       |
| `application/inventory-ledger.ts`              | **Inti posting.** Identitas sumber idempoten, kunci baris urutan tetap, UPDATE terjaga, transfer, pembalikan, sinyal stok rendah |
| `application/inventory-location-directory.ts`  | Lokasi dan kebijakan stok negatif                                                                                                |
| `application/inventory-balance-directory.ts`   | Baca saldo, ambang, rekonsiliasi, rebuild                                                                                        |
| `application/inventory-movement-directory.ts`  | Pembacaan buku besar dengan paginasi keyset                                                                                      |
| `application/inventory-route-support.ts`       | Pipa body/idempotensi dan pemetaan penolakan -> HTTP yang dipakai bersama 14 berkas route                                        |
| `application/inventory-ledger-port-adapter.ts` | `InventoryLedgerPort` konkret untuk konsumen in-process                                                                          |
| `../_shared/ports/inventory-ledger-port.ts`    | Kontrak adapter konsumen — yang menjadi tumpuan konsumen, tidak pernah internal modul ini                                        |
| `../../pages/api/v1/inventory/**`              | 14 berkas route tipis; setiap satunya `defineTenantRoute` dan mengotorisasi lewat chokepoint ADR-0063                            |
| `sql/169_awcms_inventory_schema.sql`           | Lima tabel, RLS FORCE, FK komposit, trigger immutabilitas, constraint trigger tertunda untuk transfer seimbang                   |
| `sql/170_awcms_inventory_permissions.sql`      | Seed katalog izin (tidak memberi apa pun ke role mana pun)                                                                       |

## Invarian dan di mana masing-masing ditegakkan

| Invarian                                                | Ditegakkan oleh                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Movement append-only                                    | Trigger baris (`55000`) **dan** `REVOKE UPDATE, DELETE, TRUNCATE FROM awcms_app`                               |
| Tak ada referensi melintasi tenant/lokasi               | RLS FORCE **dan** foreign key komposit `(tenant_id, id)` pada setiap referensi                                 |
| Transfer adalah pasangan seimbang                       | `postLegs` memvalidasi kedua leg sebelum menulis **dan** constraint trigger tertunda menolak COMMIT selain itu |
| Tipe memiliki tanda                                     | `CHECK` pada `quantity_delta` per `movement_type`                                                              |
| Stok tidak bisa negatif diam-diam                       | Baris terkunci + `UPDATE … WHERE on_hand + delta >= 0` terjaga + kebijakan lokasi/tenant                       |
| Dua percobaan pada unit terakhir: satu menang           | Kunci baris; dibuktikan dengan 12 penjualan serentak atas satu unit                                            |
| Replay mengembalikan yang asli                          | Unique `(tenant, source_type, source_id, source_line, operation)` + advisory lock yang menserialkan identitas  |
| `balance == SUM(movements)`                             | `GET …/balances/reconciliation` membuktikannya; `POST …/balances/rebuild` memperbaikinya dari buku besar       |
| Satu opening per kunci; pembalikan paling banyak sekali | Partial unique index                                                                                           |

## Status: `active`

Didaftarkan `experimental` selama masih hanya-API (seperti `push_delivery`,
ADR-0074), karena ADR-0021 kriteria 1 mewajibkan setiap modul `active` punya
layar admin. `/admin/inventory` (Issue #894) adalah layar itu — saldo dengan
sinyal stok rendah, riwayat pergerakan, penyesuaian dengan pembalikan (panel
alasan), transfer, lokasi, kebijakan stok negatif dan ambang, serta rekonsiliasi
baca-saja — dan hadir bersama entri `navigation`-nya, sehingga modul ini
`active`. Layar tidak pernah menegaskan saldo: setiap perubahan di dalamnya
adalah sebuah pergerakan.

## Yang TIDAK ada di sini

Layar untuk `inventory.movements.create` (aksi konsumen; `balances.rebuild`
punya aksi layar berpagar sejak Issue #901); reservasi/hold; konversi satuan;
costing/valuasi; posting atomik multi-baris; archive-lalu-purge dan partisi
(tidak ada yang mem-purge buku besar, dan deskriptor menyatakannya —
ADR-0126 §7).

## Tes

- `tests/inventory-validation.test.ts` — validator, aritmetika kuantitas, aturan
  "tak ada saldo yang ditegaskan klien", bentuk deskriptor modul (tanpa DB).
- `tests/integration/inventory-ledger.integration.test.ts` — inti posting
  terhadap PostgreSQL nyata sebagai `awcms_app` dengan RLS FORCE: konkurensi
  pada unit terakhir, atomisitas dan replay transfer, penyesuaian + pembalikan,
  append-only dari role runtime maupun pemilik tabel, isolasi lintas-tenant,
  rekonsiliasi/rebuild, sinyal stok rendah + proyeksi, event/outbox, port
  konsumen, query plan, dan uji beban.
- `tests/integration/inventory-api.integration.test.ts` — handler route nyata:
  default-deny, `Idempotency-Key`, penolakan, audit.
