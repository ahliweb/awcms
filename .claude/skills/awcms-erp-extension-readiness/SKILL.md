---
name: awcms-erp-extension-readiness
description: BACAAN SAJA / HISTORIS (ADR-0034) — kontrak kesiapan ekstensi ERP base (`_shared/business-transaction-contract.ts`/`_shared/erp-reference-data-contract.ts`/`_shared/ports/period-lock-port.ts`) DAN jalur aplikasi-turunan yang skill ini asumsikan SUDAH DIHAPUS. ERP kini dibangun sebagai modul `domain` LANGSUNG di `src/modules/` (pola sama modul base lain), bukan repo turunan; file kontrak & fixture `example-erp-extension` yang dirujuk tidak lagi ada. Rujukan historis dari Issue #755, epic #738 platform-evolution Wave 4, ADR-0020 — men-supersede oleh ADR-0034.
---

# AWCMS — Kesiapan Ekstensi ERP

> **BACAAN SAJA / HISTORIS — premis skill ini sudah dicabut oleh ADR-0034
> (2026-07-21).** ADR-0034 (`docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md`)
> **menghapus jalur aplikasi-turunan** dan, bersamanya, **kontrak kesiapan
> ekstensi ERP base** yang skill ini mengajarkan cara memakai/mengevolusikan.
> Yang sudah tidak ada lagi di repo ini (verifikasi: file-file di bawah tidak
> ditemukan di `src/`):
>
> - `src/modules/_shared/business-transaction-contract.ts`
> - `src/modules/_shared/erp-reference-data-contract.ts`
> - `src/modules/_shared/ports/period-lock-port.ts`
> - fixture `tests/fixtures/derived-application-example/modules/example-erp-extension/`
>   (seluruh direktori `derived-application-example/` diganti
>   `tests/fixtures/example-domain-modules/`, dan `example-erp-extension` dihapus)
> - `src/modules/application-registry.ts` dan command `bun run extension:check`
>   (dihapus bersama jalur turunan)
>
> **Arahan baru.** ERP tidak lagi dibangun di repo turunan. Keluarga AWCMS =
> TIGA template SEJAJAR dipakai LANGSUNG ("template dipakai-langsung"). Sebuah
> modul ERP kini dibangun sebagai modul `type: "domain"` LANGSUNG di
> `src/modules/` repo ini — pola yang sama dengan modul base lain (contoh nyata
> modul website pertama yang di-port langsung: `theming`, skill `awcms-theming`).
> Untuk scaffold modul domain baru pakai skill `awcms-new-module`; untuk
> governance komposisi pakai `awcms-module-management`. ADR-0034 men-supersede
> ADR-0013/0020 pada titik ini (kontrak kesiapan ekstensi ERP base) dan
> ADR-0014/0015/0025 (jalur turunan).
>
> Isi di bawah dipertahankan **hanya sebagai rujukan historis** atas invariant
> ERP (posted immutable, fail-closed period-lock, tenant-sebagai-batas) yang
> tetap relevan konseptual saat membangun modul ERP domain — tetapi nama file,
> fixture, dan command yang dirujuk sudah TIDAK BERLAKU. Jangan pakai sebagai
> panduan implementasi yang bisa dieksekusi hari ini.

Sumber kebenaran: `docs/adr/0020-erp-extension-readiness-contracts.md`
(keputusan arsitektural mengikat), `docs/awcms/erp-extension-
contracts.md` (referensi teknis sebelas keluarga kontrak — ownership/
versi/failure-semantics/privasi/contoh per kontrak),
`src/modules/_shared/business-transaction-contract.ts`,
`src/modules/_shared/erp-reference-data-contract.ts`,
`src/modules/_shared/ports/period-lock-port.ts`,
`tests/fixtures/derived-application-example/modules/
example-erp-extension/` (fixture referensi lengkap).

**Base ini bukan ERP.** Tidak ada chart of accounts/jurnal/general
ledger/valuasi inventori/sales-purchase-order/AR-AP/payroll/pajak di
sini, dan tidak akan pernah ada (ADR-0013 §1). Skill ini TIDAK
mengajarkan cara membangun logika akuntansi — ia mengajarkan cara
memakai (atau, bila Anda mengerjakan issue base sendiri, cara
mengevolusikan) kontrak NETRAL yang sebuah ekstensi ERP eksternal
implementasikan.

## Kapan pakai skill ini

1. **Membangun ekstensi ERP** di repository turunan Anda sendiri — baca
   §Playbook konsumsi di bawah.
2. **Menambah keluarga kontrak baru** ke base ini sendiri (jarang —
   hanya bila ada issue base baru yang eksplisit memintanya) — baca
   §Playbook evolusi kontrak base.
3. **Mengubah `PeriodLockPort`/`business-transaction-contract.ts`/
   `erp-reference-data-contract.ts`** — baca §Invariant yang tidak boleh
   dilonggarkan dulu.

## Playbook konsumsi (membangun ekstensi ERP di repository turunan)

1. Baca `docs/awcms/erp-extension-contracts.md` — tabel sebelas
   kontrak, mana yang BARU (business transaction, posting event,
   period-lock, item/currency/UoM/inventory/reconciliation) vs mana
   yang MEMAKAI ULANG mekanisme Wave 2/3 yang sudah ada (party
   directory, business-scope hierarchy, document numbering, reporting
   projection) — jangan menduplikasi yang sudah ada.
2. Susun `ApplicationModuleRegistry` Anda sendiri (Issue #740/#741, doc
   `derived-application-guide.md`) — modul ERP Anda `dependencies` ke
   Core base (`tenant_admin`, `identity_access`) seperti modul turunan
   biasa, LALU `capabilities.consumes` opsional ke `party_directory`
   (`profile_identity`) dan/atau `organization_hierarchy_resolution`
   (`organization_structure`) bila Anda butuh referensi party/scope —
   lihat `tests/fixtures/derived-application-example/modules/
example-erp-extension/module.ts` untuk contoh persis.
3. Implementasikan `PeriodLockPort` Anda sendiri (base tidak
   menyediakan satu pun adapter berperilaku nyata — hanya
   `noPeriodLockAdapterConfigured`, yang SELALU `checked: false`). Mesin
   posting Anda WAJIB memperlakukan `checked: false` identik dengan
   `locked: true` untuk operasi `"post"` — lihat `tests/fixtures/
derived-application-example/modules/example-erp-extension/
posting-engine.ts` untuk pola fail-closed yang benar.
4. Registrasikan tipe event Anda sendiri (`"<extension_key>.posting.
requested"`/`"...result_recorded"`) di atas `domain_event_runtime`
   (Issue #742) di build Anda sendiri — payload berbentuk
   `AccountingPostingRequestPayload`/`AccountingPostingResultPayload`.
   Base TIDAK PERNAH menginterpretasi `totalDebit`/`totalCredit`/
   `ledgerReference` — semuanya decimal-as-string/opaque.
5. Tegakkan idempotency per `requestId` (invariant #4 ADR-0020) —
   request yang sama dikirim ulang harus mengembalikan hasil yang
   identik, tidak pernah posting ganda. **Tidak cukup sendirian** —
   tegakkan JUGA uniqueness posted-state per `(tenantId, transactionType,
externalTransactionId)` (invariant #3), independen `requestId`:
   sebuah `requestId` BARU untuk transaksi bisnis yang SAMA tetap harus
   ditolak sebagai duplikat, bukan diterima sebagai posting kedua yang
   independen (temuan security-auditor Medium pada PR #789 — fixture
   awal hanya deduplikasi per `requestId`).
6. Tegakkan reversal-sebagai-transaksi-baru (invariant #2) — JANGAN
   PERNAH mengubah/menimpa baris transaksi yang sudah `"posted"`; sebuah
   koreksi selalu request baru dengan `reversalOfExternalTransactionId`
   yang mereferensikan `externalTransactionId` transaksi asli — BUKAN
   PERNAH `requestId` (ruang ID yang berbeda). Resolusi target reversal
   WAJIB ter-scope tenant/legal-entity TERAUTENTIKASI request reversal
   (invariant #7) — verifikasi ulang `tenantId`/`legalEntityScope`
   transaksi asli yang ter-resolve secara eksplisit, jangan hanya
   mengandalkan struktur key index (temuan security-auditor High pada PR
   #789 — fixture awal mengindeks lewat `requestId`, ruang ID yang
   salah, dan tidak memverifikasi ulang tenant/legal-entity sama sekali
   — lihat `posting-engine.ts`'s implementasi yang sudah diperbaiki untuk
   pola yang benar).
7. Jika Anda ingin kontribusi `reporting` projection (Issue #753):
   descriptor Anda WAJIB menegakkan `requiredPermission`-nya sendiri di
   endpoint pembacaan Anda — jangan hanya mendeklarasikan field ini
   (lihat catatan "descriptor field terdokumentasi tapi tidak
   ditegakkan" di `erp-extension-contracts.md` §11, pola yang berulang
   di Wave 3 epic ini).
8. `bun run extension:check` dari repository turunan Anda (skema sama
   dengan base ini) untuk memvalidasi manifest kompatibilitas Anda.

## Playbook evolusi kontrak base (menambah keluarga kontrak baru di sini)

Hanya lakukan ini bila ada issue base baru yang eksplisit meminta
kontrak tambahan (jangan menambah kontrak "untuk jaga-jaga").

1. Tentukan apakah kontrak baru itu **tipe data pasif** (taruh di
   `_shared/erp-reference-data-contract.ts` atau
   `_shared/business-transaction-contract.ts`, tanpa method/behavior)
   atau **port berperilaku** (file baru `_shared/ports/<nama>-port.ts`,
   HARUS: nol import dari modul manapun, method `async` menerima
   `tx: Bun.SQL` eksplisit sebagai parameter pertama, dan — bila
   relevan — sebuah adapter default fail-closed seperti
   `noPeriodLockAdapterConfigured`).
2. **Jangan duplikasi kontrak yang sudah dimiliki modul lain** — cek
   dulu apakah `party-directory-port.ts`/`business-scope-hierarchy-
port.ts`/`document_infrastructure`'s numbering/`ProjectionDescriptor`
   sudah mencakup kebutuhan Anda sebelum menulis kontrak baru (empat
   dari sebelas kontrak issue #755 memakai ulang mekanisme yang sudah
   ada, bukan kebetulan — periksa dulu sebelum membuat baru).
3. Update `docs/awcms/erp-extension-contracts.md`'s tabel + section
   per-kontrak (ownership/versioning/failure-semantics/privasi/contoh)
   — jangan biarkan kontrak baru tanpa entri di dokumen ini.
4. Tambah/luaskan `tests/fixtures/derived-application-example/modules/
example-erp-extension/` untuk membuktikan kontrak baru bisa
   diimplementasikan nyata (bukan hanya tipe TypeScript yang belum
   pernah dipakai) — pola yang sama `posting-engine.ts`/
   `period-lock-adapter.ts` sudah tetapkan.
5. `bun run typecheck && bun test tests/unit/erp-extension-contracts.test.ts
tests/unit/module-composition-fixture.test.ts` sebelum PR.
6. Bila keputusannya mengikat lintas dokumen (arah dependensi baru,
   invariant baru), update ADR-0020 — JANGAN hanya menambah kode tanpa
   memperbarui keputusan arsitekturalnya (doc 21 §9 punya catatan
   eksplisit: kontrak murni tanpa modul baru tetap butuh ADR, bukan
   proposal template modul).

## Invariant yang tidak boleh dilonggarkan

- **Posted immutable** — tidak ada fungsi apa pun di base yang boleh
  "membantu" memperbarui field `status: "posted"` sebuah
  `BusinessTransactionReference` secara in-place.
- **Fail-closed period-lock** — `checked: false` HARUS sama beratnya
  dengan `locked: true` untuk `"post"`. Jangan pernah menambah jalur
  yang memperlakukan "tidak bisa memeriksa" sebagai "izinkan saja".
- **Tenant tetap batas keamanan** — `legalEntityScope`/`periodKey`/dsb.
  TIDAK PERNAH menjadi pengganti RLS/ABAC; period-lock dan business-
  scope keduanya eksplisit didokumentasikan sebagai "bukan batas
  identitas".
- **Tidak ada hard-dependency ke `reference_data`** — historis, Issue #750
  masih OPEN dengan temuan Critical yang belum diperbaiki saat kontrak ini
  pertama ditulis (per ADR-0020 §Status saat itu); Issue #750 sudah CLOSED
  dan `reference_data/module.ts`'s `status` sekarang `"active"`. Keputusan
  desainnya tetap berlaku terlepas dari status historis itu:
  `ItemReference`/`CurrencyReference`/`UnitOfMeasureReference` sengaja
  independen dari sumber datanya. Jangan tambahkan import ke
  `reference_data` dari `_shared/erp-reference-data-contract.ts` tanpa
  memverifikasi ulang status keamanan modul itu terlebih dahulu.

## Verifikasi

- `bun run typecheck`
- `bun test tests/unit/erp-extension-contracts.test.ts
tests/unit/module-composition-fixture.test.ts
tests/unit/extension-check-fixtures.test.ts`
- `bun run repo:inventory:check` (bila jumlah test/file berubah)
- `bun run check` penuh sebelum PR (docs-only + kontrak TypeScript +
  fixture, tanpa migration/endpoint baru — jangan asumsikan
  `db:migrate`/`api:spec:check` perlu berubah kecuali Anda benar-benar
  menambah tabel/rute baru di base).
