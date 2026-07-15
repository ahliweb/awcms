---
name: awcms-document-infrastructure
description: Kerjakan bagian mana pun dari modul document_infrastructure AWCMS (Issue #751, epic platform-evolution #738 Wave 3; fast-follow #780/#787/#795/#798). Gunakan saat menambah endpoint/logic ke src/modules/document-infrastructure, menautkan dokumen ke resource modul lain lewat capability port document_resource_relations, mengubah numbering sequence/reservation, atau mengubah confidentiality-tier gating. Merangkum invariant konkurensi dan idempotency-hash-binding yang sudah diperbaiki supaya tidak diregresi.
---

# AWCMS — Document Infrastructure Module

`document_infrastructure` (`src/modules/document-infrastructure`, Issue #751,
epic `platform-evolution` #738 Wave 3, admission decision
`docs/adr/0017-document-infrastructure-module-admission.md`) adalah
**Official Optional Module** — infrastruktur metadata dokumen generik,
tenant-scoped, opt-in per tenant, dipakai ulang oleh modul/aplikasi turunan
mana pun. Baca `src/modules/document-infrastructure/README.md` untuk detail
lengkap tiap tabel/endpoint; skill ini merangkum invariant yang **tidak
jelas dari membaca satu file** — konkurensi numbering, confidentiality-tier
gating, dan idempotency-hash binding (bug class yang sempat lolos 2 ronde
security-review berbeda di modul ini sendiri).

## Kapan pakai skill ini vs skill generik

Skill ini melengkapi (bukan menggantikan) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-idempotency`, `awcms-abac-guard`.
Pakai skill ini untuk konteks domain `document_infrastructure` spesifik:
kapan pakai capability port vs kapan bikin tabel relasi baru, invariant
numbering, dan daftar endpoint yang WAJIB idempotency-hash resource binding.

## Tujuan & batas scope — apa yang TIDAK pernah dibangun modul ini

- **Tidak** mengimplementasikan skema dokumen domain (surat, invoice,
  purchase order, journal batch, rekam medis, kontrak) — itu tetap milik
  modul domainnya masing-masing.
- **Tidak** menyimpan byte biner konten dokumen di kolom PostgreSQL —
  `content_reference`/`content_reference_kind` hanya menunjuk ke kontrak
  managed-object storage yang sudah disetujui (mis. `sync_storage`'s object
  queue key, atau URL/system reference eksternal).
- **Tidak** mengimplementasikan tanda tangan elektronik/TTE, sertifikasi
  records-management, atau satu jadwal retensi universal (`retention_reference`
  adalah teks bebas dipetakan manual ke `data_lifecycle`, ADR-0017 §4 — bukan
  FK/capability call).
- **Tidak** mengimpor/menulis tabel modul lain secara langsung — kolaborasi
  lintas modul HANYA lewat capability port `document_resource_relations`
  (lihat di bawah). Tidak ada `consumes` — lihat ADR-0017 §4/§10 untuk
  alasan tidak ada hard-dependency ke `data_lifecycle`/`workflow_approval`/
  `sync_storage`.

## Tabel (`sql/066`–`068`)

1. `awcms_document_classifications` — katalog klasifikasi tenant-scoped
   (`code`/`name`/`confidentiality_level`/`retention_reference`).
2. `awcms_documents` — registry dokumen: `owner_module_key`/`document_type`
   (string opaque, modul ini TIDAK PERNAH membaca tabel modul lain), status
   (`active`/`superseded`/`archived`/`void`), confidentiality level,
   referensi resource generik PRIMER (`resource_type`+`resource_id`).
   `current_version_number` adalah cache denormalisasi yang HANYA diperbarui
   `application/document-version-service.ts`.
3. `awcms_document_versions` — **IMMUTABLE, APPEND-ONLY** (tidak ada
   kolom `updated_at`/`deleted_at`, tidak ada `UPDATE`/`DELETE` terhadap
   tabel ini di seluruh modul). Koreksi = versi baru dengan
   `previous_version_id` menunjuk mundur.
4. `awcms_document_resource_relations` — relasi typed TAMBAHAN dari
   dokumen ke resource modul lain, di LUAR referensi primer di atas.
   Ditulis HANYA lewat capability port.
5. `awcms_document_number_sequences` — definisi sequence penomoran,
   effective-dated (SCD Type 2, pola sama `awcms_organization_unit_hierarchies`)
   — merevisi format TIDAK PERNAH mereset/menggunakan-ulang counter.
6. `awcms_document_number_reservations` — satu baris per nomor yang
   pernah dialokasikan (reserved -> committed ATAU canceled).
   `UNIQUE (tenant_id, sequence_id, reserved_number)` menjamin "tidak
   pernah reuse nomor" secara struktural.
7. `awcms_document_evidence` — jejak evidence APPEND-ONLY untuk event
   numbering/versi/lifecycle dokumen.

Ketujuh tabel: `tenant_id` + `ENABLE`+`FORCE ROW LEVEL SECURITY` + index
tenant-first + grant `awcms_worker` read-only.

## Concurrency-safe numbering — invariant yang wajib dipertahankan

`application/document-number-reservation-service.ts`'s `reserveNumber`
mengunci baris definisi sequence yang SEDANG TERBUKA
(`SELECT ... FOR UPDATE ... WHERE effective_to IS NULL`) sebelum
membaca/menaikkan `current_value`. Dua pemanggil konkuren pada sequence
YANG SAMA otomatis diserialisasi oleh row lock Postgres — pemanggil kedua
baru bisa membaca setelah transaksi pertama commit/rollback.
`UNIQUE (tenant_id, sequence_id, reserved_number)` adalah backstop level
database: bahkan jika lock entah bagaimana terlewati, duplikat akan gagal
dengan unique-violation, bukan diam-diam mengalokasikan dua kali.
Dibuktikan lewat test konkurensi NYATA (bukan cuma didokumentasikan) di
`tests/integration/document-infrastructure.integration.test.ts` — beberapa
request paralel benar-benar dikirim ke handler API yang sama, hasilnya
diverifikasi tidak ada nomor duplikat. **Jangan** ganti `SELECT ... FOR
UPDATE` dengan optimistic locking (`version` column check) untuk
"performa" — serialisasi pesimistik di sini disengaja, sequence numbering
adalah kasus di mana kehilangan satu update berarti nomor dokumen
duplikat/hilang, bukan sekadar stale read.

Format nomor (`format_template`, mis. `INV/{YYYY}/{SEQ:6}`) divalidasi
lewat grammar token TERBATAS (`domain/number-format-template.ts`) — parser
scan karakter tunggal manual, bukan `eval`/regex bebas/dynamic code. Token
yang didukung: `{SEQ}`/`{SEQ:n}` (n=1-12), `{YYYY}`, `{YY}`, `{MM}`, `{DD}`.

## Capability port — `document_resource_relations`

`application/document-resource-relation-port.ts` mengekspor
`linkDocumentToResource`/`unlinkDocumentFromResource`/
`listRelationsForResource`/`listRelationsForDocument` — modul LAIN
meng-IMPOR dan MEMANGGIL fungsi ini langsung (in-process, pola ADR-0011
yang sama dengan `blog_content`↔`news_portal`) untuk menautkan dokumen ke
resource milik mereka sendiri. Modul ini tidak pernah membaca/menulis
tabel modul pemanggil, dan modul pemanggil tidak pernah menulis langsung
ke `awcms_document_resource_relations` (ADR-0013 §6
no-shared-table-write). `ownerModuleKey`/`resourceType`/`resourceId`
adalah string OPAQUE bagi modul ini — modul PEMANGGIL bertanggung jawab
hanya pernah mengoper id yang sudah divalidasi milik tenant-nya sendiri.

Terbukti reusable: `tests/integration/document-infrastructure.integration.test.ts`
mendemonstrasikan modul ini dipakai ulang untuk LIMA skenario domain
BERBEDA (correspondence evidence, contract attachment, invoice reference,
approval evidence, asset-disposal evidence) tanpa modul ini pernah
mengetahui/mengimpor aturan domain apa pun — hanya string
`ownerModuleKey`/`documentType`/`resourceType` yang berbeda, bukan
skema/tabel berbeda.

## Confidentiality-tier gating (security-review Critical, PR #780; diperluas Issue #787)

`GET /documents`, `GET /documents/{id}`, `GET /documents/{id}/versions`,
`GET /documents/{id}/relations`, `GET /evidence`, `GET /reservations`
semuanya menegakkan `confidentiality_level` — permission dasar
(`documents.read`/dst.) hanya memberi akses ke baris `public`/`internal`;
membaca `confidential`/`restricted` butuh permission tambahan ADDITIF
`documents_confidential.read`/`documents_restricted.read`
(`068_awcms_document_infrastructure_confidentiality_permissions.sql`,
pola sama `visitor_analytics.raw_detail.read`). Baris di luar clearance
caller mengembalikan hasil IDENTIK dengan "tidak ditemukan" (dihilangkan
dari list, `404` untuk fetch tunggal) — tidak pernah mengonfirmasi
keberadaannya. Sejak Issue #787, endpoint MUTASI (`void`/`restore`/
`reclassify`/`versions.create`/`relations.assign`/`relations.revoke`) JUGA
mensyaratkan clearance tier terhadap confidentiality level SAAT INI
dokumen SEBAGAI PRECONDITION (bukan permission write-tier baru — ADR-0017
§7) sebelum permission action-spesifik dievaluasi lebih lanjut. Endpoint
baru yang membaca/memutasi dokumen **wajib** mengikuti pola tier-check ini
— jangan hanya cek permission action tanpa cek tier.

## CRITICAL — idempotency-hash resource binding (Issue #795, PR #798)

Bug class recurring (lihat juga skill `awcms-idempotency` §CRITICAL):
`computeRequestHash` untuk 11 endpoint di modul ini — `documents/{id}/restore`,
`classifications/{id}/restore`, `documents/{id}` DELETE, `classifications/{id}`
DELETE, `documents/{id}/relations/{relationId}` DELETE,
`reservations/{id}/cancel`, `reservations/{id}/commit`, `documents/{id}/void`,
`documents/{id}/reclassify`, `documents/{id}/versions` POST, dan
`documents/{id}/relations` POST — awalnya di-hash TANPA menyertakan path
param identitas resource (`id`/`relationId`) DAN literal `action` eksplisit.
Karena `request_scope` idempotency dibagi lintas SEMUA resource bertipe
sama dalam satu tenant, ini memungkinkan reuse `Idempotency-Key` lintas DUA
dokumen berbeda mereplay respons dokumen pertama untuk request yang
seharusnya memutasi dokumen kedua. 4 dari 11 endpoint (`void`/`reclassify`/
`versions.create`/`relations.assign`) BARU ditemukan oleh independent
security-auditor pass lewat re-grep wajib SELURUH modul setelah pass
pertama hanya menyasar 7 endpoint — pelajaran: jangan percaya daftar
endpoint "yang kelihatan mencurigakan" sebagai lengkap.

`sequences/revise`/`restore`/`deactivate` DIPERIKSA dan TIDAK rentan —
endpoint index-level ini mengidentifikasi resource lewat
`scopeType`+`scopeId`+`sequenceKey` yang sudah bagian dari body mentah
yang di-hash; endpoint create murni (`documents`/`classifications`/
`sequences` POST, `reservations/reserve`) juga TIDAK rentan (tidak ada
resource pra-eksisting untuk diikat). Diuji adversarial di
`tests/integration/document-infrastructure.integration.test.ts` untuk
seluruh 11 endpoint yang diperbaiki. **Endpoint baru di modul ini yang
punya path param `[id]`/`[relationId]` wajib mengikuti pola yang sama:**

```ts
const requestHash = computeRequestHash({
  ...body,
  id: documentId,
  action: "void"
});
```

## Endpoint idempotency (ringkasan — lihat README untuk tabel lengkap)

`documents.create`/`versions.create` sengaja idempotency-gated MESKI
`create`/`update` tidak ada di `HIGH_RISK_ACTIONS` — Issue #751 sendiri
memperingatkan eksplisit bahwa PR sibling di epic ini butuh ronde
perbaikan tambahan karena pass idempotency pertamanya melewatkan endpoint
`create`. Empat action baru ditambahkan ke `AccessAction`/`HIGH_RISK_ACTIONS`
untuk modul ini: `void`, `reclassify`, `reserve`, `commit` — `cancel`
(reservation) reuse literal yang sudah ada TANPA ditambahkan ke
`HIGH_RISK_ACTIONS` (menghindari mengubah blast radius `cancel` di modul
lain); endpoint cancel reservasi tetap mewajibkan `Idempotency-Key` di
level route secara independen.

## Domain event (AsyncAPI)

`document.created`, `document.voided`, `document.restored`,
`document.reclassified`, `version.created`, `number.reserved`,
`number.committed`, `number.canceled` — semua diterbitkan di transaksi
yang sama dengan perubahan state (`appendDomainEvent`, `domain_event_runtime`).

## Admin UI

`/admin/document-infrastructure/classifications`,
`/admin/document-infrastructure/documents` (+ detail: versi/relasi/
reclassify/evidence), `/admin/document-infrastructure/sequences` (definisi
sequence + reservasi: reserve/commit/cancel reachable dari layar ini —
`commit` prompt id dokumen bebas teks, tidak ada picker lintas modul).

## Pitfall umum

1. Jangan menautkan dokumen ke resource modul lain lewat `INSERT` langsung
   ke `awcms_document_resource_relations` — selalu lewat capability
   port `linkDocumentToResource`.
2. Jangan tambah endpoint mutasi baru tanpa idempotency-hash resource
   binding (lihat §CRITICAL di atas) — ini SATU-SATUNYA modul di repo yang
   sudah kena bug ini dua kali secara berurutan.
3. Jangan tambah endpoint baca/mutasi dokumen baru tanpa confidentiality-tier
   check — lihat §Confidentiality-tier gating.
4. Jangan `UPDATE`/`DELETE` baris `awcms_document_versions` — append-only,
   koreksi selalu versi baru.
5. Jangan ganti row-lock numbering dengan optimistic locking.

## Verifikasi

`tests/integration/document-infrastructure.integration.test.ts` — negative
test confidentiality-tier untuk KEEMPAT jalur baca asli, test konkurensi
numbering nyata, DAN (Issue #787) dua test tambahan: satu meng-cover keenam
endpoint mutasi (deny dengan action-permission saja, allow setelah tier
permission ditambahkan), satu lagi meng-cover `GET /evidence`/
`GET /reservations`. Jalankan `bun test` dengan `DATABASE_URL` — `bun run
check` tanpa `DATABASE_URL` melewatkan semua test integration secara diam-diam.

## Belum tersedia

Capability edge nyata ke `data_lifecycle` untuk retensi (kolom
`retention_reference` tetap teks bebas sampai ada admission decision
terpisah).
