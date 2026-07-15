---
name: awcms-profile-identity
description: Kerjakan bagian mana pun dari modul profile_identity AWCMS (Issue 2.2 fondasi, dilengkapi penuh Issue #748 epic platform-evolution #738 Wave 2 — party CRUD, identifier/alamat/channel effective-dated, relasi party-to-party generik, deteksi duplikat, workflow merge approval-gated). Gunakan saat mengubah profile CRUD, merge workflow, cross-tenant guard, atau capability port PartyDirectoryPort. PR #777 punya kesalahan review yang sempat lolos draft — merangkum invariant supaya tidak diregresi.
---

# AWCMS — Profile Identity Module

`profile_identity` (`src/modules/profile-identity`, fondasi Issue 2.2,
dilengkapi penuh Issue #748 epic `platform-evolution` #738 Wave 2) adalah
siklus hidup party (person/organization) KANONIK: CRUD lengkap,
identifier/alamat/channel effective-dated, relasi generik party-to-party,
deteksi duplikat, dan workflow merge approval-gated. Baca
`src/modules/profile-identity/README.md` untuk detail lengkap tiap tabel;
skill ini merangkum invariant keamanan (cross-tenant guard, self-approval,
field-conflict snapshot) yang WAJIB dipertahankan.

## Kapan pakai skill ini vs skill generik

Melengkapi `awcms-sensitive-data` (normalize/hash/mask identifier —
`domain/identifier.ts` di modul ini adalah CONTOH implementasi pola itu),
`awcms-abac-guard` (self-approval guard dipakai ulang di sini),
`awcms-idempotency`. Skill ini menyediakan konteks merge-workflow dan
cross-tenant guard spesifik modul ini.

## Tabel (`sql/003` fondasi, `sql/059` Issue #748)

- `awcms_profiles` — profile kanonik, soft delete,
  `merged_into_profile_id` untuk hasil merge, `status`
  (`active`/`inactive`/`merged` — `merged` HANYA di-set oleh eksekusi
  merge, tidak bisa lewat `PATCH`).
- `awcms_profile_identifiers` — identifier sensitif (email/phone/
  whatsapp/national_id/tax_id/external_code), dedup lewat `value_hash`
  (unique parsial per tenant+type selama belum soft-deleted),
  `masked_value` untuk tampilan aman, plus `provenance`/`verified_at`/
  `verified_by`/`valid_from`/`valid_until` (Issue #748).
- `awcms_profile_channels` — preferensi channel, mengacu ke
  `profile_identifiers` (TIDAK menduplikasi nilai sensitif); `is_default`
  = flag "preferred channel per type".
- `awcms_profile_addresses` — alamat per profile, effective-dated.
- `awcms_profile_entity_links` — tautan profile ke entity modul
  lain (`module_key`/`entity_type`/`entity_id`), unique per entity — SET
  REFERENSI yang direpoint saat merge dieksekusi.
- `awcms_profile_relationships` (Issue #748) — relasi party-to-party
  effective-dated, GENERIK: `relationship_type` teks bebas snake_case,
  TIDAK ADA CHECK enum peran bisnis (customer/supplier/employee). Authorized
  representative hanyalah baris relasi `is_authorized_representative = true`.
- `awcms_profile_duplicate_candidates` (Issue #748) — kandidat
  duplikat: `match_basis`/`match_score`/`match_reasons` (jsonb, SELALU
  explainable), `status` (`pending`/`confirmed_duplicate`/`not_duplicate`).
  Pasangan disimpan terurut (`profile_id_a < profile_id_b`).
- `awcms_profile_merge_requests` — `source`(loser)/`target`(survivor),
  `source_profile_id <> target_profile_id` (constraint DB + `domain/merge.ts`),
  `requires_approval`, `field_conflict_snapshot`, `reference_impact_snapshot`.
- `awcms_profile_merge_history` (Issue #748) — **append-only,
  immutable**, TERPISAH dari `merge_requests` yang statusnya mutable.
  Dasar untuk operator menalar/memulihkan efek merge yang keliru.
- `awcms_profile_audit_logs` — dead schema, dideklarasikan migration
  003 tapi TIDAK PERNAH ditulis kode aplikasi; audit high-risk
  sesungguhnya lewat `logging` module's `recordAuditEvent`. Jangan tulis
  ke tabel ini, jangan asumsikan itu sumber audit trail modul ini.

Semua tabel tenant-scoped `ENABLE`+`FORCE ROW LEVEL SECURITY` — 7 tabel
migration 003 mendapat `FORCE` sejak migration `013_awcms_enforce_rls_least_privilege.sql`
(PR #777 review correction — **draft awal PR #777 salah mengklaim migration
059 yang menutup gap ini**; statement `FORCE` yang diulang di 059 sebenarnya
no-op aman, sekadar keterbacaan mandiri file itu — kalau menyelidiki
"kapan RLS FORCE mulai berlaku untuk tabel profile", jawabannya migration
013, BUKAN 059, meski 059 juga menyebut `FORCE` di statement-nya).

## Merge workflow (Issue #748) — 3 langkah, approval WAJIB di setiap merge

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

## CRITICAL — cross-tenant guard, DUA lapis, keduanya wajib

Cross-tenant matching/merge DILARANG KERAS. Ditegakkan di dua lapis
independen:

1. **RLS** (`FORCE ROW LEVEL SECURITY`) — koneksi role aplikasi biasa
   tidak akan pernah melihat baris tenant lain sama sekali.
2. **`domain/merge.ts`'s `assertSameTenant`/`CrossTenantMergeError`** —
   dipanggil ULANG di `application/merge-workflow.ts`'s
   `createMergeRequest` DAN `executeMergeRequest`, terhadap baris yang
   di-fetch ULANG di dalam transaksi yang sama, tidak pernah mempercayai
   tenant id yang dibawa objek lama. `fetchPartyForMerge` SENGAJA TIDAK
   memfilter `tenant_id` di `WHERE`-nya (mengandalkan RLS untuk jalur
   normal) justru supaya lapis kedua ini GENUINELY teruji lewat test
   terhadap koneksi privileged (bypass RLS) — lihat
   `tests/integration/profile-identity.integration.test.ts`'s test
   "application-layer guard: assertSameTenant/CrossTenantMergeError fires
   even when RLS is bypassed". **Endpoint merge/match baru wajib
   memanggil `assertSameTenant` di titik eksekusi, jangan andalkan RLS
   saja** — RLS adalah lapis pertama, bukan satu-satunya.

`duplicate-candidate-directory.ts`'s scan juga selalu ter-scope `tenant_id`
yang sama pada kedua sisi query — tidak ada jalur yang membandingkan
profile lintas tenant.

## Business role BUKAN hardcoded (persyaratan eksplisit Issue #748)

Tidak ada tabel/kolom/enum di modul ini yang mengenkode peran bisnis
kontekstual (customer/supplier/employee/donor/merchant/student/patient).
`relationship_type` teks bebas tervalidasi FORMAT saja;
`domain/relationship.ts` bahkan MENOLAK eksplisit beberapa kata peran
bisnis sebagai guard defensif terhadap regresi. Aplikasi turunan bebas
membangun semantik domain-spesifik DI ATAS relasi generik ini — **jangan
tambah CHECK constraint/enum peran bisnis apa pun ke modul base ini.**

## Tiga kontrak proyeksi eksplisit (`domain/projection.ts`)

`PartyFullDTO` (internal), `PartyMaskedAdminDTO` (API admin — TANPA
`tenantId`/actor id), `PartyPublicSafeDTO` (3 field saja: `id`/
`profileType`/`displayName`, `null` untuk profile soft-deleted/merged/
inactive). **Endpoint/response baru wajib pilih SATU dari tiga kontrak
ini secara eksplisit** — jangan bikin bentuk DTO ad-hoc baru yang
membocorkan field internal.

## Capability port

`_shared/ports/party-directory-port.ts` (`PartyDirectoryPort`) —
`exists`/`resolveSummary`/`resolveMergeSurvivor` (mengikuti rantai
`merged_into_profile_id`)/`resolvePublicSafeSummary`. Implementasi:
`application/party-directory-port-adapter.ts`. Belum ada consumer
in-repo (didaftarkan lebih dulu sebelum consumer nyata, pola sama
`legal-hold-guard-port.ts`).

## Pitfall umum

1. Jangan set `status: merged` lewat `PATCH` — hanya eksekusi merge yang
   boleh set field itu (`domain/party-validation.ts` menolaknya).
2. Jangan tambah endpoint reveal identifier mentah — belum ada di scope
   manapun, `masked_value` adalah satu-satunya bentuk baca yang diizinkan
   hari ini.
3. Jangan asumsikan `awcms_profile_audit_logs` adalah sumber audit
   trail — itu dead schema, gunakan `recordAuditEvent`/`awcms_audit_events`.
4. Jangan bikin merge/match tanpa memanggil `assertSameTenant` ulang di
   titik eksekusi, meski RLS "seharusnya" sudah mencegahnya.
5. Jangan tambah CHECK enum peran bisnis ke `relationship_type` atau
   tabel lain di modul ini.
6. Kalau menelusuri sejarah "kapan RLS FORCE mulai berlaku" untuk tabel
   migration 003, jawabannya migration 013 — bukan 059 (kesalahan draft
   PR #777, sudah dikoreksi di README, jangan diulang di dokumen lain).

## Verifikasi

`tests/integration/profile-identity.integration.test.ts` — termasuk test
cross-tenant guard yang sengaja bypass RLS (koneksi privileged) untuk
membuktikan lapis kedua (`assertSameTenant`) benar-benar independen dari
RLS, bukan cuma "seharusnya tidak pernah terjadi". Jalankan `bun test`
dengan `DATABASE_URL` — `bun run check` tanpa `DATABASE_URL` melewatkan
test integration secara diam-diam.

## Belum tersedia (di luar scope Issue #748)

Endpoint reveal identifier mentah (raw value), un-merge otomatis,
pencarian full-text (masih substring `ILIKE`), dan business role/entitas
domain (customer/supplier/dll.) — semuanya sengaja di luar scope.
