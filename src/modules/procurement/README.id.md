🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:0467cd45aeb9d06d077bcfaf82b0dffb265609d56d3c7d242ea2195c227915ba -->

<!-- i18n-source-hash: sha256:pending -->

# `procurement`

**Pemasok, penerimaan, retur pemasok, permintaan stok, dan transfer antarlokasi**
generik di atas buku besar inventori (Issue #888,
[ADR-0128](../../../docs/adr/0128-generic-procurement-supplier-receiving-transfer-module-admission.id.md)).
Paket desain lengkap (PRD-lite, state machine, ERD, matriks izin/RLS, kontrak
ledger, rekonsiliasi, rollback) ada di
[`docs/awcms/procurement.md`](../../../docs/awcms/procurement.id.md); berkas ini
adalah peta kodenya.

## Satu aturan

Procurement memiliki **dokumen**, tidak pernah **stok**. Finalise memposting
movement lewat `InventoryLedgerPort` (semua baris atau tidak sama sekali, satu
savepoint) dan reversal memposting movement kompensasi; tidak ada penulisan ke
tabel `awcms_inventory_*` di modul ini. State machine
(draft → submitted → finalised | cancelled, finalised → reversed) adalah trigger
database, sehingga dokumen finalised immutable dan tak ada yang pernah dihapus.

## Tata letak

| Path                                            | Isi                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `module.ts`                                     | Deskriptor: 17 izin, 2 event, 2 proyeksi reporting, `dataLifecycle` + `subjectData` untuk 8 tabel |
| `domain/procurement-types.ts`                   | Mode, status, tipe sumber ledger milik server — murni                                             |
| `domain/procurement-validation.ts`              | Validator request ketat (desimal eksak, tanpa status/total yang dinyatakan klien) — murni         |
| `domain/procurement-identifier.ts`              | Normalisasi dan klasifikasi identifier — murni                                                    |
| `domain/procurement-permissions.ts`             | Objek guard literal untuk `authorizeInTransaction`                                                |
| `domain/procurement-events.ts`                  | Konstanta tipe/versi event                                                                        |
| `application/procurement-posting.ts`            | Finalise dan reverse: satu-satunya kode yang menggerakkan stok (lewat port)                       |
| `application/procurement-document-directory.ts` | CRUD dokumen, submit, cancel, ambang persetujuan, `workflow_approval` opsional                    |
| `application/procurement-supplier-directory.ts` | Pemasok, label, identifier, reveal beraudit                                                       |
| `application/procurement-reporting.ts`          | Laporan live dan rekonsiliasi dokumen/ledger                                                      |
| `application/procurement-route-support.ts`      | Idempotensi, validasi body, dan pemetaan error bersama untuk route                                |
| `src/pages/api/v1/procurement/**`               | 16 berkas route tipis; masing-masing mengotorisasi lewat `defineTenantRoute`                      |

Status `experimental` sampai layar admin pertama mendarat (ADR-0128 §10).

**Ambang persetujuan:** berbasis biaya; hanya mencakup `receive` dan `supplier_return` (keduanya wajib `unitCost` per baris). `requisition` dan `transfer` tidak dibatasi biaya (gerbang berbasis mode/kuantitas adalah tindak lanjut tercatat).
