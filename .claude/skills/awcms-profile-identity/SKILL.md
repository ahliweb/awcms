---
name: awcms-profile-identity
description: "SEBAGIAN BACAAN SAJA — hanya fondasi (Issue 2.2: profile CRUD, identifier, entity link, `sql/003`) yang ada di repo ini; seluruh lapis Issue #748 yang dijelaskan di bawah (merge workflow, relasi party-to-party, deteksi duplikat, merge history) ADA DI awcms-mini dan BELUM di-port ke sini. Gunakan saat mengubah profile CRUD/identifier/masking/cross-tenant guard, ATAU saat mem-port lapis #748 dari mini — bagian #748 di skill ini adalah spesifikasi target, bukan deskripsi kode yang bisa dipanggil hari ini."
---

# AWCMS — Profile Identity Module

`profile_identity` (`src/modules/profile-identity`) adalah siklus hidup
party (person/organization) KANONIK. Baca
`src/modules/profile-identity/README.md` untuk keadaan repo ini yang
sebenarnya; skill ini merangkum invariant keamanan (cross-tenant guard,
self-approval, field-conflict snapshot) yang WAJIB dipertahankan.

## STATUS — baca duluan, dua lapis dengan realitas BERBEDA

| Lapis                                                                                                                                                                                                 | Di repo ini                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fondasi (Issue 2.2, `sql/003`)** — `awcms_profiles`, `awcms_profile_identifiers`, `awcms_profile_entity_links`, masking, resolve                                                                    | **ADA** — kode nyata, boleh dijadikan acuan implementasi.                                                                                                                                  |
| **Issue #748** (epic `platform-evolution` #738 Wave 2) — merge workflow, `profile_relationships`, `profile_duplicate_candidates`, `profile_merge_requests`/`_history`, channel/alamat effective-dated | **TIDAK ADA** — ada di awcms-mini (migrasi 059 di sana), belum di-port. Tabel, endpoint, `domain/merge.ts`, `domain/relationship.ts` yang disebut di bawah **tidak ada file-nya di sini**. |

Konsekuensinya, jangan: (1) memanggil/mengimpor `domain/merge.ts`,
`domain/relationship.ts`, `application/merge-workflow.ts`,
`duplicate-candidate-directory.ts`, atau
`_shared/ports/party-directory-port.ts` — tidak ada di repo ini;
(2) `SELECT` dari tabel merge/relationship/duplicate-candidate;
(3) mengklaim ke user bahwa merge workflow "sudah ada". `README.md` modul
ini menyebut mereka di §"Belum tersedia" — itulah yang akurat. Bagian
sisa skill ini berguna sebagai **spesifikasi target port** (invariant apa
yang WAJIB ikut saat lapis #748 di-port dari mini) — bukan peta kode.

## Kapan pakai skill ini vs skill generik

Melengkapi `awcms-sensitive-data` (normalize/hash/mask identifier —
`domain/identifier.ts` di modul ini adalah CONTOH implementasi pola itu),
`awcms-abac-guard` (self-approval guard dipakai ulang di sini),
`awcms-idempotency`. Skill ini menyediakan konteks merge-workflow dan
cross-tenant guard spesifik modul ini.

## Tabel (`sql/003` fondasi = ADA; tabel bertanda **[#748 — mini]** = BELUM ADA di sini)

- `awcms_profiles` — profile kanonik, soft delete,
  `merged_into_profile_id` untuk hasil merge, `status`
  (`active`/`inactive`/`merged` — `merged` HANYA di-set oleh eksekusi
  merge, tidak bisa lewat `PATCH`).
- `awcms_profile_identifiers` — identifier sensitif (email/phone/
  whatsapp/national_id/tax_id/external_code), dedup lewat `value_hash`
  (unique parsial per tenant+type selama belum soft-deleted),
  `masked_value` untuk tampilan aman. Kolom `provenance`/`verified_at`/
  `verified_by`/`valid_from`/`valid_until` = **[#748 — mini]**, tidak ada
  di `sql/003` repo ini.
- **[#748 — mini]** `awcms_profile_channels` — preferensi channel, mengacu
  ke `profile_identifiers` (TIDAK menduplikasi nilai sensitif);
  `is_default` = flag "preferred channel per type".
- **[#748 — mini]** `awcms_profile_addresses` — alamat per profile,
  effective-dated.
- `awcms_profile_entity_links` — tautan profile ke entity modul
  lain (`module_key`/`entity_type`/`entity_id`), unique per entity — SET
  REFERENSI yang direpoint saat merge dieksekusi.
- **[#748 — mini]** `awcms_profile_relationships` — relasi party-to-party
  effective-dated, GENERIK: `relationship_type` teks bebas snake_case,
  TIDAK ADA CHECK enum peran bisnis (customer/supplier/employee). Authorized
  representative hanyalah baris relasi `is_authorized_representative = true`.
- **[#748 — mini]** `awcms_profile_duplicate_candidates` — kandidat
  duplikat: `match_basis`/`match_score`/`match_reasons` (jsonb, SELALU
  explainable), `status` (`pending`/`confirmed_duplicate`/`not_duplicate`).
  Pasangan disimpan terurut (`profile_id_a < profile_id_b`).
- **[#748 — mini]** `awcms_profile_merge_requests` — `source`(loser)/`target`(survivor),
  `source_profile_id <> target_profile_id` (constraint DB + `domain/merge.ts`),
  `requires_approval`, `field_conflict_snapshot`, `reference_impact_snapshot`.
  Permission `profile_identity.profile_management.restore` sudah diseed
  `sql/005` di sini tapi belum punya konsumen — jangan simpulkan dari
  keberadaan permission bahwa endpoint/tabelnya ada.
- **[#748 — mini]** `awcms_profile_merge_history` — **append-only,
  immutable**, TERPISAH dari `merge_requests` yang statusnya mutable.
  Dasar untuk operator menalar/memulihkan efek merge yang keliru.
- `awcms_profile_audit_logs` — **tidak ada di repo ini sama sekali** (di
  mini ia dead schema: dideklarasikan tapi tak pernah ditulis kode; di
  sini `sql/003` tidak mendeklarasikannya). Audit high-risk lewat `logging`
  module's `recordAuditEvent`/`awcms_audit_events`. Jangan buat ulang tabel
  ini "karena skill menyebutnya".

Tabel tenant-scoped `sql/003` mendapat `ENABLE`+`FORCE ROW LEVEL SECURITY`
lewat `sql/017_awcms_enforce_rls_force.sql` (Issue #139 — sebelum itu hanya
`ENABLE`, yang **inert** selama app connect sebagai owner tabel). Kalau
menyelidiki "kapan RLS FORCE mulai berlaku untuk tabel profile" di repo
INI, jawabannya `sql/017` — bukan migration 013 (nomor itu penomoran mini
untuk `enforce_rls_least_privilege`; di sini 013 adalah workflow approval).
Catatan `FORCE` saja belum cukup: superuser/BYPASSRLS tetap melewatinya —
lihat header `sql/019_awcms_db_role_separation.sql` (Issue #141) untuk role
`awcms_app` yang membuat policy ini benar-benar dievaluasi.

## [#748 — mini] Merge workflow — 3 langkah, approval WAJIB di setiap merge

> Seluruh §ini mendeskripsikan kode di **awcms-mini**. Di repo ini belum ada
> satu pun endpoint/fungsi merge. Baca sebagai kontrak yang WAJIB
> dipertahankan saat mem-port, bukan sebagai API yang bisa dipanggil.

1. **Create** (`profile_merge.create`) — `sourceProfileId` (loser) +
   `targetProfileId` (survivor) + `reason`. Menghitung dan menyimpan
   snapshot `field_conflict_snapshot` (field yang berbeda antar profile —
   HANYA untuk review, base ini TIDAK punya UI pick-and-choose per field;
   nilai SURVIVOR yang selalu bertahan) dan `reference_impact_snapshot`
   (jumlah `profile_entity_links` per module/entity type yang akan
   direpoint).
2. **Approval** (`profile_merge.approve`) — **SETIAP** merge di base ini
   wajib approval (`computeRequiresApproval()` SELALU `true` — superset
   ketat "hanya merge high-risk butuh approval", menghindari heuristik
   risiko yang bisa keliru). Guard self-approval generik
   (`identity-access/domain/access-control.ts`) mencegah requester
   menyetujui request-nya sendiri.
3. **Execute** (`profile_merge.merge`, action ABAC terpisah dari
   `.approve`) — high-risk: `Idempotency-Key` wajib, PLUS row lock
   (`SELECT ... FOR UPDATE`) pada `merge_requests` yang menyerialisasi
   eksekusi konkuren KEDUA (idempotency key BEDA sekalipun) sehingga
   panggilan kedua melihat `status = 'completed'` dan mengembalikan hasil
   yang sudah ada, bukan mengeksekusi ulang. **Tenant loser & survivor
   divalidasi ULANG tepat di titik eksekusi** (`assertSameTenant`), tidak
   pernah mempercayai apa pun yang tersimpan di request — lihat
   §Cross-tenant guard di bawah.

Efek eksekusi: `profile_entity_links` milik loser direpoint ke survivor
(baris yang bentrok dengan link survivor yang sudah ada dihapus sebagai
duplikat murni), loser di-soft-delete dengan `status = 'merged'` +
`merged_into_profile_id`, baris `profile_merge_history` immutable ditulis,
event domain `awcms.profile-identity.profile.merged` dipublikasikan.

### Strategi pemulihan merge — TIDAK ADA tombol "undo"

Merge **tidak hard-delete** — loser tetap ada sebagai baris soft-deleted
dengan `merged_into_profile_id`. Un-merge OTOMATIS penuh **tidak
disediakan** — pemulihan butuh: (1) baca `profile_merge_history` untuk
survivor/loser + snapshot; (2) `profile_entity_links` yang direpoint masih
teridentifikasi lewat `module_key`/`entity_type`/`entity_id` yang sama
(profile_id-nya sudah berubah); (3) menulis ulang link + memulihkan loser
secara MANUAL/terarah — jejak audit di atas adalah yang dibutuhkan
operator, bukan mekanisme otomatis. **Jangan janjikan/bangun tombol
"undo merge" satu-klik tanpa issue baru eksplisit.**

## [#748 — mini] CRITICAL — cross-tenant guard, DUA lapis, keduanya wajib

Cross-tenant matching/merge DILARANG KERAS. Ditegakkan di mini lewat dua
lapis independen — **kontrak WAJIB yang harus ikut saat lapis #748 di-port
ke sini**, bukan kode yang sudah berjalan di repo ini:

1. **RLS** (`FORCE ROW LEVEL SECURITY`) — koneksi role aplikasi biasa
   tidak akan pernah melihat baris tenant lain sama sekali.
2. **`domain/merge.ts`'s `assertSameTenant`/`CrossTenantMergeError`** —
   dipanggil ULANG di `application/merge-workflow.ts`'s
   `createMergeRequest` DAN `executeMergeRequest`, terhadap baris yang
   di-fetch ULANG di dalam transaksi yang sama, tidak pernah mempercayai
   tenant id yang dibawa objek lama. `fetchPartyForMerge` SENGAJA TIDAK
   memfilter `tenant_id` di `WHERE`-nya (mengandalkan RLS untuk jalur
   normal) justru supaya lapis kedua ini GENUINELY teruji lewat test
   terhadap koneksi privileged (bypass RLS) — di mini:
   `tests/integration/profile-identity.integration.test.ts`'s test
   "application-layer guard: assertSameTenant/CrossTenantMergeError fires
   even when RLS is bypassed". **Repo ini belum punya `tests/integration/`
   sama sekali (Issue #154)** — port lapis #748 tanpa mem-port test itu
   berarti guard kedua tidak terverifikasi. **Endpoint merge/match baru wajib
   memanggil `assertSameTenant` di titik eksekusi, jangan andalkan RLS
   saja** — RLS adalah lapis pertama, bukan satu-satunya.

`duplicate-candidate-directory.ts`'s scan juga selalu ter-scope `tenant_id`
yang sama pada kedua sisi query — tidak ada jalur yang membandingkan
profile lintas tenant.

## Business role BUKAN hardcoded (persyaratan eksplisit Issue #748)

Berlaku untuk KEDUA lapis. Tidak ada tabel/kolom/enum di modul ini yang
mengenkode peran bisnis kontekstual (customer/supplier/employee/donor/
merchant/student/patient). **[#748 — mini]** `relationship_type` teks bebas
tervalidasi FORMAT saja; `domain/relationship.ts` (mini) bahkan MENOLAK
eksplisit beberapa kata peran bisnis sebagai guard defensif terhadap
regresi. Aplikasi turunan bebas
membangun semantik domain-spesifik DI ATAS relasi generik ini — **jangan
tambah CHECK constraint/enum peran bisnis apa pun ke modul base ini.**

## Kontrak proyeksi (`domain/projection.ts`)

Di repo ini `domain/projection.ts` mengekspor **satu** kontrak:
`PartyMaskedAdminDTO` (API admin — TANPA `tenantId`/actor id) +
`toPartyMaskedAdminDTO`. **Endpoint/response baru wajib memakainya secara
eksplisit** — jangan bikin bentuk DTO ad-hoc baru yang membocorkan field
internal.

**[#748 — mini]** `PartyFullDTO` (internal) dan `PartyPublicSafeDTO` (3
field saja: `id`/`profileType`/`displayName`, `null` untuk profile
soft-deleted/merged/inactive) **belum ada di sini** — kalau butuh proyeksi
public-safe, port `PartyPublicSafeDTO` dari mini apa adanya, jangan bikin
varian baru.

## [#748 — mini] Capability port — BELUM ADA di repo ini

`_shared/ports/` di sini hanya berisi `workflow-condition-port.ts` dan
`workflow-notification-port.ts`. `party-directory-port.ts`
(`PartyDirectoryPort` — `exists`/`resolveSummary`/`resolveMergeSurvivor`
mengikuti rantai `merged_into_profile_id`/`resolvePublicSafeSummary`),
adapter-nya, dan `legal-hold-guard-port.ts` yang disebut sebagai preseden
semuanya ada di mini saja. **Jangan `import` salah satunya di repo ini** —
port dulu kalau memang dibutuhkan.

## Pitfall umum

1. Jangan set `status: merged` lewat `PATCH` — hanya eksekusi merge yang
   boleh set field itu (`domain/party-validation.ts` menolaknya).
2. Jangan tambah endpoint reveal identifier mentah — belum ada di scope
   manapun, `masked_value` adalah satu-satunya bentuk baca yang diizinkan
   hari ini.
3. Jangan asumsikan `awcms_profile_audit_logs` adalah sumber audit
   trail — tabelnya tidak ada di sini sama sekali; gunakan
   `recordAuditEvent`/`awcms_audit_events`.
4. Jangan bikin merge/match tanpa memanggil `assertSameTenant` ulang di
   titik eksekusi, meski RLS "seharusnya" sudah mencegahnya.
5. Jangan tambah CHECK enum peran bisnis ke `relationship_type` atau
   tabel lain di modul ini.
6. Kalau menelusuri "kapan RLS FORCE mulai berlaku" untuk tabel `sql/003`
   **di repo ini**, jawabannya `sql/017` (Issue #139). Nomor 013/059 yang
   beredar di dokumen warisan adalah penomoran awcms-mini.
7. **Jangan perlakukan §bertanda [#748 — mini] sebagai kode yang ada.**
   Verifikasi ke `src/modules/profile-identity/` + `sql/003` dulu sebelum
   memanggil/mengklaim apa pun dari sana.

## Verifikasi

Repo ini **belum punya `tests/integration/` sama sekali** (Issue #154) —
termasuk `profile-identity.integration.test.ts` yang disebut di atas; itu
milik mini. Yang ada di sini: unit test `tests/*.test.ts` (jalankan
`bun test`). Saat mem-port lapis #748, test cross-tenant guard yang sengaja
bypass RLS (koneksi privileged) adalah bagian WAJIB dari port — bukan
opsional — karena itulah satu-satunya yang membuktikan lapis kedua
independen dari RLS.

## Belum tersedia di repo ini

Seluruh lapis #748 (lihat §STATUS), plus — di mini pun sengaja di luar
scope — endpoint reveal identifier mentah (raw value), un-merge otomatis,
pencarian full-text (masih substring `ILIKE`), dan business role/entitas
domain (customer/supplier/dll.).
