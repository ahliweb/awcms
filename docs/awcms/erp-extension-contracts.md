# Kontrak Kesiapan Ekstensi ERP

Issue #755, epic #738 (`platform-evolution`), Wave 4 — issue TERAKHIR
epic ini. `docs/adr/0020-erp-extension-readiness-contracts.md` adalah
keputusan arsitektural yang mengikat; dokumen ini adalah referensi
teknis lengkap untuk setiap kontrak yang keputusan itu definisikan —
ownership, versioning, failure semantics, klasifikasi privasi, dan
contoh, untuk siapa pun yang membangun **ekstensi ERP** (repository
TERPISAH dari base ini) yang perlu berinteraksi dengan tenant/party/
scope/dokumen/event/reporting milik AWCMS.

**Base ini bukan ERP.** Tidak ada chart of accounts, jurnal, general
ledger, valuasi inventori, sales/purchase order, AR/AP, kas-bank, fixed
asset, payroll, atau perhitungan pajak di repository ini — dan tidak
akan pernah ada (ADR-0013 §1, doc ini §Eksklusi eksplisit). Yang
disediakan hanyalah **kontrak netral**: bentuk data, satu capability
port, dan skema payload event yang sebuah ekstensi ERP eksternal
implementasikan/konsumsi.

## Untuk siapa dokumen ini

Anda membangun (atau berencana membangun) sebuah aplikasi turunan
ERP/akuntansi/inventori di atas AWCMS, di repository Anda sendiri
(lihat `docs/awcms/derived-application-guide.md` untuk pola umum
aplikasi turunan, dan `docs/adr/0013-extension-layers-and-boundary-
model.md` §"ERP Extension" untuk penempatan layernya). Dokumen ini
menjelaskan kontrak yang tersedia untuk Anda pakai, TANPA mengharuskan
Anda mengedit registry modul base (Issue #740/#741, ADR-0014/0015).

## Ringkasan sebelas keluarga kontrak

| #   | Kontrak                                          | Lokasi (base)                                                       | Jenis                                   | Sudah ada sejak                 |
| --- | ------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------- | ------------------------------- |
| 1   | Business transaction reference & lifecycle       | `src/modules/_shared/business-transaction-contract.ts`              | Tipe data pasif                         | Issue #755 (baru)               |
| 2   | Document/reference/numbering integration         | `document_infrastructure`'s API publik + `DocumentReferenceLink`    | Tipe data pasif + layanan modul pemilik | Issue #751 (dipakai ulang)      |
| 3   | Tenant/legal-entity/organization scope reference | `_shared/ports/business-scope-hierarchy-port.ts`                    | Port + tipe data                        | Issue #746/#749 (dipakai ulang) |
| 4   | Party kanonik + peran kontekstual                | `_shared/ports/party-directory-port.ts`                             | Port                                    | Issue #748 (dipakai ulang)      |
| 5   | Posting request/result event envelope            | `_shared/business-transaction-contract.ts`                          | Tipe payload event                      | Issue #755 (baru)               |
| 6   | Period-lock query/check                          | `_shared/ports/period-lock-port.ts`                                 | Port berperilaku, fail-closed           | Issue #755 (baru)               |
| 7   | Item/service reference                           | `_shared/erp-reference-data-contract.ts`                            | Tipe data pasif                         | Issue #755 (baru)               |
| 8   | Currency & unit-of-measure reference             | `_shared/erp-reference-data-contract.ts`                            | Tipe data pasif                         | Issue #755 (baru)               |
| 9   | Inventory movement reference                     | `_shared/erp-reference-data-contract.ts`                            | Tipe data pasif                         | Issue #755 (baru)               |
| 10  | Reconciliation reference/control totals          | `_shared/erp-reference-data-contract.ts`                            | Tipe data pasif                         | Issue #755 (baru)               |
| 11  | Reporting projection contribution                | `reporting`'s `ProjectionDescriptor` (`_shared/module-contract.ts`) | Descriptor                              | Issue #753 (dipakai ulang)      |

## 1. Business transaction reference & lifecycle

**Pemilik:** ekstensi ERP (base tidak menyimpan transaksi apa pun).
**Bentuk:** `BusinessTransactionReference` (`_shared/business-transaction-
contract.ts`) — `tenantId`, `legalEntityScope` (nullable, lihat #3),
`transactionType` (string namespaced `<extension_key>.<domain>.<jenis>`),
`externalTransactionId` (opaque milik ekstensi), `status`
(`BusinessTransactionLifecycleStatus`: `draft`/`submitted`/`posted`/
`reversed`/`rejected`), `documentReference?` (lihat #2).
**Versioning:** bagian dari `MODULE_CONTRACT_VERSION` scheme TIDAK
berlaku di sini (ini bukan `ModuleDescriptor`) — perubahan bentuk file
ini sendiri diberi tahu lewat changelog rilis paket (scheme #1 doc
`extension-compatibility-policy.md`), sama seperti file `_shared/*`
lain yang bukan port/module-contract.
**Failure semantics:** tidak ada — ini murni tipe data, tidak
"gagal". Validasi keberadaan/kepemilikan `legalEntityScope` didelegasikan
ke kontrak #3.
**Klasifikasi privasi:** tidak ada PII langsung; `externalTransactionId`
opaque bagi base.
**Invariant mengikat:** lihat ADR-0020 §4 (posted immutable, koreksi via
reversal, dst.) — SEMUA nomor invariant di situ berlaku untuk kontrak
ini.

## 2. Document/reference/numbering integration

**Pemilik:** `document_infrastructure` (Issue #751, modul base yang
sudah ada — bukan kontrak baru issue ini). Sebuah ekstensi ERP yang
ingin nomor dokumen terformat (mis. nomor invoice/PO) memanggil
`document_infrastructure`'s layanan alokasi numbering-nya SENDIRI
(`domain/document-number-sequence.ts`, diakses lewat API publik modul
itu) — bukan lewat sebuah `_shared/ports/*.ts` baru.
**Bentuk referensi yang di-embed:** `DocumentReferenceLink`
(`_shared/business-transaction-contract.ts`) — `sequenceKey`,
`documentNumber`, `documentId?`. Bentuk ini SESUAI STRUKTUR dengan
`document_infrastructure`'s alokasi nyata tapi TIDAK meng-import
tipenya (setiap file `_shared/*-contract.ts` tetap nol-import, sesuai
konvensi seluruh file `_shared` lain).
**Failure semantics:** kegagalan alokasi nomor adalah tanggung jawab
`document_infrastructure` sendiri (lihat modul itu untuk concurrency-
safety-nya) — kontrak ini hanya mendefinisikan apa yang di-embed
SETELAH alokasi berhasil.
**Klasifikasi privasi:** nomor dokumen bukan data sensitif per se, tapi
tunduk pada `confidentiality_level` `document_infrastructure` sendiri
bila `documentId` menunjuk dokumen berklasifikasi.

## 3. Tenant/legal-entity/organization scope reference

**Pemilik:** `_shared/ports/business-scope-hierarchy-port.ts` (Issue
#746, diimplementasikan nyata oleh `organization_structure` — Issue
#749 — untuk `scopeType: "legal_entity"`/`"organization_unit"`, dan oleh
`identity_access`'s adapter default untuk `scopeType: "office"`).
**Bentuk:** `BusinessScopeReference` (`{scopeType, scopeId}`, opaque,
BUKAN foreign key) dan `BusinessScopeResolution` (`resolved`,
`ancestorScopes`, `descendantScopes`).
**Dipakai ulang, tidak diduplikasi** oleh kontrak baru issue ini —
`BusinessTransactionReference.legalEntityScope` dan
`ReconciliationReference.legalEntityScope` (§10) keduanya bertipe
`BusinessScopeReference | null` langsung, tanpa membungkusnya lagi.
**Failure semantics:** `resolved: false` (bukan array kosong) berarti
scope TIDAK valid untuk tenant tersebut — pemanggil (di sini, mesin
posting ekstensi ERP) WAJIB default-deny, tidak pernah menganggap
"tidak ada hierarki" sebagai "diperbolehkan".
**Klasifikasi privasi:** tidak ada PII; scope adalah identifier
struktur organisasi, bukan data personal.

## 4. Party kanonik + peran kontekstual

**Pemilik:** `_shared/ports/party-directory-port.ts` (Issue #748,
diimplementasikan `profile_identity`).
**Pola untuk ekstensi ERP:** tabel "customer"/"supplier"/"employee"
milik ekstensi Anda menyimpan REFERENSI (`profileId`) ke party
kanonik lewat port ini — TIDAK PERNAH menduplikasi nama/kontak/data
identitas party ke tabel ekstensi Anda sendiri. Gunakan
`resolveSummary`/`resolvePublicSafeSummary` untuk menampilkan
nama/status tanpa menyalinnya secara permanen.
**Failure semantics:** `null` berarti party tidak ada/soft-deleted/
merged-away untuk tenant tersebut — ekstensi WAJIB memperlakukan
sebagai "tidak ditemukan", tidak pernah menampilkan data basi.
**Klasifikasi privasi:** `PartyDirectorySummaryDTO`/
`PartyDirectoryPublicSafeDTO` adalah allow-list eksplisit — field apa
pun DI LUAR daftar itu (email/telepon mentah, dst.) tidak pernah
terekspos lewat port ini; ekstensi yang butuh data lebih detail
memanggil endpoint `profile_identity` sendiri, yang menerapkan masking
sesuai skill `awcms-sensitive-data`.

## 5. Posting request/result event envelope

**Pemilik:** ekstensi ERP mendefinisikan tipe event-nya sendiri (mis.
`"<extension_key>.posting.requested"`/`"...posting.result_recorded"`)
yang payload-nya berbentuk `AccountingPostingRequestPayload`/
`AccountingPostingResultPayload` (`_shared/business-transaction-
contract.ts`). Event itu sendiri naik di atas `domain_event_runtime`
(Issue #742) — ekstensi meregistrasi event type/consumer-nya sendiri
di build turunannya sendiri (`domain-event-runtime/infrastructure/
consumer-registry.ts` versi fork-nya), TIDAK di base.
**Bentuk:**

- Request: `requestId` (idempotency key), `transaction`
  (`BusinessTransactionReference`), `periodKey`, `currencyCode`,
  `totalDebit`/`totalCredit` (decimal-as-string, opaque bagi base),
  `requestedAt`, `reversalOfExternalTransactionId?`.
- Result: `requestId` (WAJIB sama dengan request), `transaction`,
  `status` (`accepted`/`posted`/`rejected`/`reversed`), `postedAt?`,
  `rejectionReason?`, `ledgerReference?` (opaque).
  **Failure semantics:** lihat invariant #3 (uniqueness posted-state per
  `(tenantId, transactionType, externalTransactionId)`, independen
  `requestId`), #4 (idempotent per `requestId`), #5 (`"accepted"` BUKAN
  bukti posting berhasil), dan #7 (`reversalOfExternalTransactionId`
  me-resolve `externalTransactionId` — BUKAN PERNAH `requestId` — ter-scope
  tenant/legal-entity request reversal) di ADR-0020 §4.
  **Klasifikasi privasi:** `totalDebit`/`totalCredit`/`ledgerReference`
  adalah data finansial sensitif tenant — payload event WAJIB lulus
  `domain_event_runtime`'s `validateDomainEventPayload` (menolak nilai
  berbentuk-credential/secret, membatasi ukuran payload) sebelum
  dipublikasikan, sama seperti event modul manapun.
  **Contoh:** lihat `tests/fixtures/derived-application-example/modules/
example-erp-extension/posting-engine.ts` untuk implementasi referensi
  lengkap (idempotent per `requestId`, penolakan duplikat per identitas
  bisnis, fail-closed period lock, resolusi target reversal ter-scope
  tenant/legal-entity, reversal-sebagai-transaksi-baru), diverifikasi
  `tests/unit/erp-extension-contracts.test.ts` — termasuk dua test
  adversarial khusus sisi target reversal (reversal tenant lain tidak
  bisa me-resolve transaksi tenant yang benar; reversal tenant yang sama
  dengan legal-entity scope berbeda tetap ditolak).

## 6. Period-lock query/check

**Pemilik:** `_shared/ports/period-lock-port.ts` — **satu-satunya port
BERPERILAKU baru** issue ini (sepuluh kontrak lain adalah tipe data
pasif atau memakai ulang port yang sudah ada). Base TIDAK menyediakan
adapter nyata (bukan sekadar "adapter default" seperti port lain) —
konsep periode akuntansi murni milik domain ERP.
**Bentuk:** `checkPeriodLock(tx, tenantId, legalEntityScope, periodKey,
operation)` mengembalikan `PeriodLockCheckResult`:
`{checked:true, locked:false}` | `{checked:true, locked:true, reason}` |
`{checked:false, reason}`.
**Failure semantics (WAJIB fail-closed):** `checked: false` HARUS
diperlakukan identik dengan `locked: true` untuk operasi `"post"`.
`noPeriodLockAdapterConfigured` (satu-satunya "adapter" yang base
sediakan) SELALU mengembalikan `checked: false` — sebuah composition
root yang belum meng-compose ekstensi ERP apa pun mendapat port yang
selalu menolak posting, bukan yang diam-diam mengizinkannya.
**Bukan batas identitas/RLS** — port ini menjawab pertanyaan bisnis
"periode ini terbuka atau tidak", bukan pengganti RLS/ABAC tenant, yang
tetap wajib diperiksa terpisah oleh setiap endpoint/job ekstensi ERP.
**Klasifikasi privasi:** `periodKey` opaque, tidak ada PII.

## 7. Item/service reference

**Pemilik:** ekstensi ERP (base tidak punya katalog item). **Bentuk:**
`ItemReference` (`_shared/erp-reference-data-contract.ts`) —
`itemId` (opaque), `itemKind` (`good`/`service`), `defaultUnit`
(`UnitOfMeasureReference`, §8).
**Sumber data yang sah:** tabel katalog milik ekstensi Anda sendiri,
ATAU (opsional, begitu Issue #750 `reference_data` benar-benar merge
dan stabil — lihat ADR-0020 §Status untuk peringatan pin saat ini)
`reference_data`'s effective-dated value sets. Kontrak ini TIDAK
mengasumsikan salah satu — keduanya valid selama bentuknya sesuai.
**Failure semantics:** tidak ada — tipe data pasif.
**Klasifikasi privasi:** tidak ada PII.

## 8. Currency & unit-of-measure reference

**Pemilik:** ekstensi ERP. **Bentuk:** `CurrencyReference`
(`currencyCode` ISO 4217, `minorUnitDigits`) dan
`UnitOfMeasureReference` (`unitCode`, `description`) — keduanya di
`_shared/erp-reference-data-contract.ts`. Base tidak memvalidasi kode
mata uang/satuan terhadap tabel referensi mana pun — murni string
opaque yang diteruskan.
**Failure semantics:** tidak ada. **Klasifikasi privasi:** tidak ada
PII.

## 9. Inventory movement reference

**Pemilik:** ekstensi ERP (base tidak punya konsep valuasi/costing
inventori — ADR-0020 eksklusi eksplisit). **Bentuk:**
`InventoryMovementReference` — `tenantId`, `movementId` (opaque),
`direction` (`receipt`/`issue`/`transfer`/`adjustment`), `item`
(`ItemReference`), `quantity` (decimal-as-string, opaque),
`businessTransactionReference?` (link opsional ke §1).
**Failure semantics:** tidak ada — murni referensi, validasi stok
(negative-stock, dst.) sepenuhnya tanggung jawab ekstensi.
**Klasifikasi privasi:** tidak ada PII.

## 10. Reconciliation reference/control totals

**Pemilik:** ekstensi ERP (atau sebuah `reporting` projection yang
ekstensi kontribusikan, §11). **Bentuk:** `ReconciliationReference` —
`tenantId`, `legalEntityScope?`, `periodKey`, `reconciledAt`,
`controlTotals` (array `ReconciliationControlTotal`: `label`,
`expectedValue`, `actualValue`, `matched`), `fullyReconciled`.
**Failure semantics:** `matched`/`fullyReconciled` adalah perbandingan
STRING-EXACT yang disiapkan pemanggil — kontrak ini TIDAK melakukan
parsing/normalisasi numerik apa pun; ekstensi bertanggung jawab
menormalkan kedua sisi sebelum membandingkan.
**Klasifikasi privasi:** total kontrol adalah data finansial agregat
tenant — sama sensitifnya dengan §5, tunduk pada permission ekstensi
sendiri saat diekspos lewat API/projection.

## 11. Reporting projection contribution

**Pemilik:** `reporting`'s `ProjectionDescriptor` (`_shared/module-
contract.ts`, Issue #753 — modul base yang sudah ada, bukan kontrak
baru issue ini). Sebuah ekstensi ERP mengontribusikan SATU descriptor
per read-model yang ingin di-maintain inkremental (mis. ringkasan
posting per tenant), didorong oleh event miliknya sendiri (§5) lewat
strategy `"domain_event"` — engine `reporting` TIDAK PERNAH membaca
tabel ledger ekstensi secara langsung (ADR-0013 §6).
**Failure semantics:** `requiredPermission` pada descriptor WAJIB
diperiksa oleh caller — lihat batasan ini sudah ditegakkan
`reporting/domain/projection-permission-filter.ts` untuk descriptor
BASE; sebuah ekstensi yang mendaftarkan descriptor-nya sendiri di
build turunannya bertanggung jawab memastikan penegakan yang sama
berlaku untuk descriptor-nya (lihat catatan Wave 3 tentang pola
"descriptor field terdokumentasi tapi tidak ditegakkan" — jangan
ulangi kesalahan itu di ekstensi Anda).
**Bukti machine-verifiable:** `tests/fixtures/derived-application-
example/modules/example-erp-extension/module.ts`'s
`reportingProjections` entry lulus `reporting`'s `validateProjectionRegistry`
nyata — lihat `tests/unit/erp-extension-contracts.test.ts`.
**Klasifikasi privasi:** mengikuti klasifikasi data yang diagregasi
(di sini, data finansial — lihat §5/§10).

## Eksklusi eksplisit (tidak akan pernah ada di base ini)

Chart of accounts & tabel jurnal; mesin posting double-entry; valuasi/
costing inventori; sales order, purchase order, AR/AP, kas/bank,
alokasi pembayaran; fixed asset, depresiasi, payroll, perhitungan/
pelaporan pajak; manufacturing, project costing, budget control,
konsolidasi; klaim apa pun bahwa AWCMS sendiri adalah ERP yang
lengkap atau patuh regulasi. Lihat ADR-0020 §Konteks untuk daftar
lengkap dan alasannya.

## Pemetaan kepatuhan (praktik, bukan klaim sertifikasi)

Kontrak di dokumen ini adalah lapisan STRUKTURAL (bentuk data, arah
dependensi, invariant idempotency/immutability) — kepatuhan
akuntansi/pajak substantif (mis. PSAK, PPN/PPh, standar audit) tetap
sepenuhnya tanggung jawab pemilik ekstensi ERP, tidak diklaim atau
divalidasi oleh base ini. Kontrol teknis yang RELEVAN dan memang
disediakan base: isolasi tenant (RLS, ADR-0003), default-deny ABAC
(ADR-0004), audit log high-risk action (skill `awcms-audit-log`),
masking data sensitif (skill `awcms-sensitive-data`), dan payload
event yang bebas credential/secret (`domain_event_runtime`'s
`validateDomainEventPayload`) — masing-masing memetakan ke kontrol umum
UU PDP/ISO 27001 Annex A/OWASP ASVS yang sudah didokumentasikan
`docs/awcms/20_threat_model_security_architecture.md`, tidak
diulang di sini.

## Fixture referensi & test

`tests/fixtures/derived-application-example/modules/
example-erp-extension/` — module descriptor + mesin posting in-memory +
adapter period-lock fixture, TIDAK PERNAH dikomposisi ke registry base
nyata (`src/modules/index.ts` tidak berubah). Diverifikasi
`tests/unit/erp-extension-contracts.test.ts` (idempotency per
`requestId`, penolakan duplikat-posting per identitas bisnis
`(tenantId, transactionType, externalTransactionId)` bahkan dengan
`requestId` baru, fail-closed period lock, penolakan cross-tenant/
legal-entity-mismatch pada request forward, DUA test adversarial khusus
sisi target reversal — reversal ter-autentikasi sebagai tenant lain
tidak bisa me-resolve transaksi tenant yang benar meski tahu persis
`externalTransactionId`-nya, dan reversal tenant yang sama dengan
legal-entity scope berbeda tetap ditolak — reversal-sebagai-transaksi-
baru, kontribusi reporting projection) dan
`tests/unit/module-composition-fixture.test.ts` (komposisi DAG/
capability/migration-namespace). Lihat kedua file test itu untuk contoh
pemakaian nyata setiap kontrak di atas.

**Catatan revisi:** sebuah review keamanan independen pada PR ini
menemukan revisi pertama fixture mengindeks target reversal lewat
`requestId` (ruang ID yang salah — lihat `business-transaction-
contract.ts`'s invariant #7) dan tidak memverifikasi ulang tenant/
legal-entity transaksi asli yang ter-resolve — keduanya diperbaiki
sebelum PR ini merge; lihat ADR-0020 §5 untuk detail lengkap. Jangan
mengutip fixture ini sebagai "terbukti aman" tanpa membaca catatan itu.
