# ADR-0020 — Kontrak kesiapan ekstensi ERP (business transaction, posting, period-lock, item, report-projection)

- **Status:** Accepted
- **Tanggal:** 2026-07-15
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #755 (epic #738 `platform-evolution`, Wave 4), ADR-0013 (extension layers & boundary model), ADR-0011 (capability ports), ADR-0014 (deterministic build-time module composition), ADR-0015 (derived-application compatibility manifest), Issue #746 (business-scope assignments), Issue #748 (canonical party/`party_directory`), Issue #749 (organization-structure/`organization_hierarchy_resolution`), Issue #742 (domain-event-runtime outbox), Issue #751 (document-infrastructure numbering), Issue #753 (reporting projections), Issue #750 (`reference_data` — **belum merge**, lihat §Status di bawah), `docs/awcms/erp-extension-contracts.md`, `docs/awcms/21_module_admission_governance.md`, `docs/awcms/derived-application-guide.md`

## Konteks

Epic #738 `platform-evolution` menjadikan AWCMS sebuah **kernel aplikasi teknis** yang bisa dipakai ulang oleh banyak repository turunan independen — termasuk kemungkinan aplikasi turunan berbasis ERP (akuntansi, inventori, penjualan/pembelian, payroll, pajak). ADR-0013 §1 sudah menetapkan bahwa modul vertikal seperti itu **tidak pernah** masuk ke base repository ini. Issue #755 (Wave 4, issue terakhir epic ini) meminta langkah selanjutnya: bukan membangun ERP, melainkan **mendefinisikan kontrak netral** — referensi data, capability port, dan event bervensi — yang memungkinkan sebuah ERP extension (dibangun di REPOSITORY TERPISAH, bukan di sini) berinteraksi dengan aplikasi turunan berbasis AWCMS tanpa base ini pernah:

- menyimpan chart of accounts/jurnal/general ledger;
- menyimpan valuasi/costing inventori;
- menyimpan sales order/purchase order/AR-AP/kas-bank/alokasi pembayaran;
- menyimpan fixed asset/depresiasi/payroll/perhitungan-pelaporan pajak;
- menyimpan manufacturing/project costing/budget control/konsolidasi;
- ATAU mengklaim dirinya sendiri sebuah ERP yang lengkap/patuh regulasi.

Base HARUS tetap memisahkan secara eksplisit: tenant vs legal entity/organization scope (sudah ada, Issue #749); katalog/langganan SaaS vs katalog item/akuntansi ERP; ledger alokasi operasional/pembayaran vs general ledger double-entry; profil/party kanonik vs peran kontekstual customer/supplier/employee milik modul ERP (sudah ada, Issue #748).

**Status per 2026-07-15 (dicatat eksplisit sebagai riwayat):** Issue #755 secara formal bergantung pada #739/#742/#746/#749/#750/#751/#753. Seluruh tujuh dependency sudah merge, termasuk **Issue #750 (`reference_data`)** yang sempat OPEN dengan dua temuan Critical (precedence-enforcement pada `tenant_override`/`tenant_extend`, dan nilai berbentuk-secret yang lolos tanpa terdeteksi) — keduanya sudah diperbaiki dan PR #783 sudah MERGED, `reference_data` kini `status: "active"` di registry. Kontrak di ADR ini tetap **tidak melakukan hard-dependency** ke kode nyata `reference_data`: `ItemReference`/`CurrencyReference`/`UnitOfMeasureReference` (`_shared/erp-reference-data-contract.ts`) adalah bentuk data murni yang independen dari sumber datanya — kini `reference_data` sudah stabil, ia MAY (bukan MUST) menjadi salah satu sumber yang sah untuk bentuk-bentuk ini, tanpa perubahan kontrak.

## Keputusan

### 1. AWCMS adalah kernel teknis, bukan ERP fungsional

Base ini menyediakan kontrak (tipe, port, skema event) yang SEBUAH ekstensi ERP eksternal mengimplementasikan/konsumsi. Base tidak pernah mengimplementasikan logika akuntansi/pajak/payroll apa pun. Tidak ada modul baru terdaftar di `src/modules/index.ts` oleh issue ini — seluruh deliverable adalah kontrak (`src/modules/_shared/*`), dokumentasi, dan sebuah fixture ilustrasi (`tests/fixtures/derived-application-example/modules/example-erp-extension/`) yang TIDAK PERNAH dikomposisi ke registry nyata.

### 2. Arah kepemilikan & dependensi

- **Base mendefinisikan kontrak** (tipe TypeScript pasif + satu capability port berperilaku). **Ekstensi ERP mengimplementasikan/mengkonsumsi kontrak itu**, di repository-nya sendiri.
- **Core/System TIDAK PERNAH bergantung pada implementasi ERP** — tidak ada file di `src/modules/**` (base) yang meng-import apa pun dari sebuah ekstensi ERP. Diverifikasi otomatis oleh `tests/unit/erp-extension-contracts.test.ts`'s pemindaian sumber-teks (pola yang sama `tests/unit/module-boundary.test.ts` sudah pakai untuk `blog_content`↔`news_portal`).
- **Modul sumber (base/System/Optional Business Foundation) tidak pernah menulis tabel ERP secara langsung** (ADR-0013 §6 no-shared-table-write) — satu-satunya jalur adalah kontrak event/port di bawah, atau API publik modul pemilik (mis. `document_infrastructure`'s numbering).

### 3. Keluarga kontrak (lihat `docs/awcms/erp-extension-contracts.md` untuk tabel lengkap ownership/versi/failure-semantics/privasi/contoh)

| #   | Kontrak                                          | Lokasi                                                                                  | Bentuk                                                               |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Business transaction reference & lifecycle       | `_shared/business-transaction-contract.ts`                                              | Tipe data pasif                                                      |
| 2   | Document/reference/numbering integration         | `document_infrastructure` (Issue #751, sudah ada) + `DocumentReferenceLink`             | Tipe data pasif + API modul pemilik                                  |
| 3   | Tenant/legal-entity/organization scope reference | `_shared/ports/business-scope-hierarchy-port.ts` (Issue #746/#749, sudah ada)           | Port + tipe data (dipakai ulang, tidak diduplikasi)                  |
| 4   | Party kanonik + peran kontekstual                | `_shared/ports/party-directory-port.ts` (Issue #748, sudah ada)                         | Port (dipakai ulang, tidak diduplikasi)                              |
| 5   | Posting request/result event envelope            | `_shared/business-transaction-contract.ts` (`AccountingPostingRequestPayload`/`Result`) | Tipe payload event (naik di atas `domain_event_runtime`, Issue #742) |
| 6   | Period-lock query/check                          | `_shared/ports/period-lock-port.ts`                                                     | Port berperilaku, fail-closed                                        |
| 7   | Item/service reference                           | `_shared/erp-reference-data-contract.ts` (`ItemReference`)                              | Tipe data pasif                                                      |
| 8   | Currency & unit-of-measure reference             | `_shared/erp-reference-data-contract.ts`                                                | Tipe data pasif                                                      |
| 9   | Inventory movement reference                     | `_shared/erp-reference-data-contract.ts` (`InventoryMovementReference`)                 | Tipe data pasif                                                      |
| 10  | Reconciliation reference/control totals          | `_shared/erp-reference-data-contract.ts` (`ReconciliationReference`)                    | Tipe data pasif                                                      |
| 11  | Reporting projection contribution                | `reporting`'s `ProjectionDescriptor` (Issue #753, sudah ada)                            | Descriptor (dipakai ulang, tidak diduplikasi)                        |

Empat dari sebelas keluarga (#2/#3/#4/#11) **memakai ulang mekanisme yang SUDAH ADA** dari Wave 2/3 (`BusinessScopeHierarchyPort`, `PartyDirectoryPort`, `document_infrastructure`'s numbering, `ProjectionDescriptor`) — issue ini tidak menduplikasi kontrak yang sudah punya pemilik modul yang jelas, hanya mendokumentasikan bagaimana sebuah ekstensi ERP memakainya. Sisanya (#1/#5/#6/#7/#8/#9/#10) adalah kontrak BARU murni-data (kecuali #6, satu-satunya port berperilaku baru) karena base sebelumnya tidak punya konsep transaksi bisnis/posting/period/item/inventori/rekonsiliasi sama sekali.

### 4. Invariant mengikat (wajib dipatuhi setiap ekstensi ERP yang mengimplementasikan kontrak ini)

1. **Transaksi yang sudah posted bersifat immutable.**
2. **Koreksi memakai reversal/compensation, bukan mutasi** — reversal adalah transaksi BARU yang menunjuk balik ke transaksi asli lewat `reversalOfExternalTransactionId`, bukan menimpa baris transaksi asli.
3. **Uniqueness posted-state berbasis identitas bisnis, bukan `requestId`** — implementasi WAJIB menegakkan uniqueness status `"posted"`/`"reversed"` per `(tenantId, transactionType, externalTransactionId)`, independen dari `requestId` — idempotency `requestId` (poin 4) SENDIRI TIDAK CUKUP: caller yang membuat `requestId` baru untuk transaksi bisnis yang SAMA (sengaja atau tidak) tetap harus ditolak sebagai duplikat, tidak pernah diterima sebagai posting kedua yang independen.
4. **Posting bersifat idempotent dan berkorelasi eksternal** — `requestId` yang sama, dikirim ulang, mengembalikan hasil yang identik, tidak pernah posting ganda. Melengkapi, bukan menggantikan, uniqueness identitas-bisnis poin 3.
5. **Penerimaan request bukan berarti posting berhasil** — `status: "accepted"`/`"submitted"` berbeda dari `status: "posted"`/`"reversed"`; caller tidak boleh menganggap penerimaan sebagai bukti posting.
6. **Modul sumber tidak pernah menulis tabel ERP secara langsung** — lihat §2 di atas.
7. **Resolusi target reversal ter-scope tenant/legal-entity, di ruang ID yang benar** — `reversalOfExternalTransactionId` me-resolve transaksi ASLI lewat `externalTransactionId`-nya sendiri (BUKAN PERNAH `requestId` — ruang ID yang berbeda), ter-scope ke tenant TERAUTENTIKASI request reversal. Transaksi asli yang ter-resolve tapi `tenantId`/`legalEntityScope`-nya tidak cocok dengan request reversal WAJIB ditolak — sebuah reversal tidak pernah bisa "menemukan" dan mereferensikan transaksi milik tenant lain (atau legal entity lain).

### 5. Bukti machine-verifiable

`tests/fixtures/derived-application-example/modules/example-erp-extension/` (module descriptor + `posting-engine.ts` + `period-lock-adapter.ts`, murni in-memory, tanpa database) mendemonstrasikan ketujuh invariant di atas end-to-end, diverifikasi oleh `tests/unit/erp-extension-contracts.test.ts` — idempotency per `requestId`, penolakan duplikat-posting per identitas-bisnis (poin 3, `requestId` baru tidak lolos), fail-closed period lock (baik "tidak ada adapter" maupun "period terkunci"), penolakan cross-tenant/legal-entity-mismatch pada request forward, DAN dua test adversarial terpisah untuk sisi TARGET REVERSAL secara spesifik (poin 7) — reversal yang ter-autentikasi sebagai tenant lain tidak bisa me-resolve transaksi tenant yang benar meski tahu persis `externalTransactionId`-nya, dan reversal yang me-resolve transaksi tenant yang sama tapi legal-entity scope berbeda tetap ditolak. Fixture ini juga mengonsumsi `party_directory`/`organization_hierarchy_resolution` sebagai capability opsional dan berkontribusi satu `reportingProjections` descriptor yang lulus `reporting`'s `validateProjectionRegistry` nyata — TANPA PERNAH dikomposisi ke registry base yang sesungguhnya (`src/modules/index.ts` tetap tidak berubah, sama seperti fixture-fixture Wave 1 sebelumnya).

**Catatan revisi (security-auditor, pasca-PR awal):** revisi pertama fixture ini meng-index target reversal lewat `requestId` (ruang ID yang SALAH — `reversalOfExternalTransactionId` mereferensikan `externalTransactionId`, bukan pernah `requestId`) dan tidak melakukan verifikasi ulang tenant/legal-entity sama sekali terhadap transaksi asli yang ter-resolve — cacat ini diperbaiki di commit yang sama sebelum PR merge, sebelum klaim "terbukti end-to-end" di atas menjadi benar. Dicatat eksplisit di sini (bukan hanya diperbaiki diam-diam di kode) karena dokumen inilah yang sebelumnya membuat klaim yang keliru — pola yang sama dengan beberapa temuan "false claim of compliance" epic ini di Wave 3 (lihat memori sesi terkait #780/#782/#783): sebuah klaim keamanan di ADR/dokumen bukan bukti klaim itu benar, hanya penelusuran jalur nyata yang membuktikannya.

## Konsekuensi

- **Positif:** ekstensi ERP masa depan (mis. cabang ERP dari AWPOS) punya bentuk kontrak yang jelas, tervalidasi, dan sudah terbukti bisa diimplementasikan (fixture) — tanpa menambah satu baris pun logika akuntansi ke base.
- **Positif:** empat kontrak (#2/#3/#4/#11) memakai ulang mekanisme Wave 2/3 yang sudah diaudit keamanannya, mengurangi permukaan baru yang perlu direview.
- **Negatif/trade-off:** kontrak item/currency/UoM (#7/#8) SENGAJA tidak terikat ke `reference_data` (#750) karena modul itu belum merge dan masih punya temuan Critical terbuka — pengambil keputusan masa depan yang MENGIKAT kontrak ini ke `reference_data` harus melakukannya lewat perubahan terpisah, setelah #750 benar-benar stabil, bukan mengasumsikan kompatibilitas hari ini.
- **Netral:** `PeriodLockPort` tidak memiliki adapter default berperilaku nyata di base (hanya `noPeriodLockAdapterConfigured`, yang SELALU fail-closed) — ini disengaja; konsep "periode akuntansi" murni milik domain ERP, base tidak boleh berpura-pura punya definisi periode yang netral-domain.

## Alternatif yang dipertimbangkan

- **Menunda seluruh issue sampai #750 merge** — ditolak: kontrak #7/#8/#9/#10 tidak butuh `reference_data` untuk didefinisikan sebagai BENTUK (shape); mereka hanya butuh `reference_data` sebagai salah satu SUMBER opsional di masa depan. Menunda kontrak murni-data ke belakang sebuah PR yang sedang diperbaiki keamanannya tidak proporsional untuk isu terpisah ini.
- **Mengimplementasikan sebuah mesin posting/ledger minimal nyata di base "sebagai referensi"** — ditolak secara eksplisit oleh issue #755 sendiri ("Explicitly out of scope for the base") dan oleh ADR-0013 §1; fixture di `tests/fixtures/` sudah cukup untuk membuktikan kontrak dapat diimplementasikan tanpa menciptakan sebuah "ERP bayangan" di dalam base.
- **Menjadikan `PeriodLockPort`/`business-transaction-contract.ts` sebuah modul terdaftar (`src/modules/index.ts`) alih-alih kontrak `_shared/`** — ditolak: tidak ada tabel/endpoint/lifecycle nyata yang dimiliki base untuk konsep ini, sehingga tidak lolos §3 doc 21 ("modul harus memiliki state/lifecycle sendiri") — kontrak murni tetap `_shared/`, konsisten dengan `module-contract.ts`/`business-scope-hierarchy-port.ts` yang juga bukan modul.
