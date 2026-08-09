# Program model keanggotaan — menyelaraskan user/role/RBAC/ABAC dengan model Cloudflare

> **Status: RENCANA.** Dokumen ini menjadwalkan pekerjaan, bukan mendeskripsikan
> kode yang sudah ada. Setiap tabel, endpoint, gerbang, dan `bun run` yang
> disebut di bawah **belum ada** kecuali disebut eksplisit sebagai "hari ini".
> Ditulis 9 Agustus 2026. Titik-lanjut resmi tetap
> [`docs/PROJECT_STATE.md`](../PROJECT_STATE.md) §4.

## 1. Kenapa program ini ada

Pertanyaan awalnya: pelajari dokumentasi Cloudflare
[_Manage members_](https://developers.cloudflare.com/fundamentals/manage-members/)
dan [_Tenant API_](https://developers.cloudflare.com/tenant/), lalu sesuaikan
manajemen user/role/RBAC/ABAC AWCMS supaya lebih proper, siap integrasi
Cloudflare multi-tenant, dan siap menjadi pengelola SaaS / IaaS / EaaS.

Hasil pemetaan dua sisi memberi jawaban yang tidak diduga: **mesin otorisasi
AWCMS lebih kuat daripada milik Cloudflare.** Cloudflare tidak punya evaluator
kebijakan dinamis ber-_deny-overrides_, tidak punya _Segregation of Duties_,
tidak punya Row Level Security per-tenant di lapisan basis data, dan tidak
memublikasikan decision log per-keputusan. AWCMS punya keempatnya —
[ADR-0033](../adr/0033-abac-dynamic-policy-evaluator.md),
[ADR-0031](../adr/0031-segregation-of-duties-conflict-enforcement.md),
`sql/017`, dan `awcms_abac_decision_logs` — dijaga 36 gerbang di rantai
`bun run check`.

Yang hilang bukan mesinnya. Yang hilang **bentuk keanggotaannya**: lapisan yang
membuat sebuah sistem bisa dijual sebagai layanan.

| Kemampuan                          | Cloudflare                                 | AWCMS hari ini                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Satu manusia, banyak akun          | ya — member global                         | **tidak** — `awcms_identities.tenant_id NOT NULL`, `UNIQUE (tenant_id, login_identifier)` (`sql/004`)                                                                                                                                      |
| Grant membawa scope-nya sendiri    | ya — Policy = actor + role + resourceGroup | **tidak** — `awcms_access_assignments` tanpa scope (`sql/005`); `awcms_business_scope_assignments` (`sql/027`) terpisah dan **belum dipakai rute mana pun** ([ADR-0060](../adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md)) |
| Role menyatakan level attach-nya   | ya — account/domain/resource-scoped        | **tidak** (= PROJECT_STATE §4 **R8**)                                                                                                                                                                                                      |
| User Groups                        | ya, SCIM-syncable                          | **tidak ada sama sekali**                                                                                                                                                                                                                  |
| Undangan by email + status pending | ya                                         | **tidak ada** — hanya self-registration + approval (`sql/074`)                                                                                                                                                                             |
| Daftar & cabut sesi                | ya                                         | **tidak ada permukaan**                                                                                                                                                                                                                    |
| Plan / subscription / entitlement  | ya                                         | **nol**                                                                                                                                                                                                                                    |
| Suspend pelanggan                  | ya                                         | enum `suspended` ada sejak `sql/002`, **tidak pernah ditegakkan di luar login**                                                                                                                                                            |

## 2. Empat keputusan yang mengunci cakupan

1. **Target: principal global.** Satu manusia, satu kredensial, banyak tenant.
   Dieksekusi paling akhir, sebagai pengangkatan otoritas yang tidak memindahkan
   satu foreign key pun.
2. **Cloudflare dipakai sebagai MODEL, bukan target integrasi.** Tenant API
   partner **tidak dibangun** — ia menuntut perjanjian Channel/Alliance yang
   ditandatangani dan entitlement yang diberikan Cloudflare. Yang dikejar:
   model keanggotaan AWCMS **isomorfik** dengan Cloudflare, sehingga bila
   perjanjian itu ada nanti, integrasinya menjadi pemetaan tabel — bukan
   perancangan ulang.
3. **Lapisan komersial penuh**, termasuk partner/EaaS: entitlement, metering,
   kuota, partner, akses terdelegasi.
4. **Mulai dari Gelombang 0** — delapan PR yang hanya mengetatkan.

## 3. Peta isomorfisme

Kontrak yang tidak boleh dilanggar gelombang mana pun.

| Cloudflare                                                 | AWCMS setelah program ini                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| User (global, satu email)                                  | `awcms_principals`                                                                        |
| Account                                                    | `awcms_tenants`                                                                           |
| Member                                                     | `awcms_tenant_users` (tetap; kini bermakna keanggotaan)                                   |
| Policy `(actor, permission_groups[], resource_groups[])`   | satu baris `awcms_access_policies`                                                        |
| PermissionGroup                                            | `awcms_roles` + `awcms_role_permissions`                                                  |
| ResourceGroup / scope                                      | `(scope_type, scope_id)`; `'tenant'` = account-wide (sudah ada: `TENANT_WIDE_SCOPE_TYPE`) |
| account/domain/resource-scoped role                        | `awcms_roles.attachable_scope_types text[]`                                               |
| User Group                                                 | `awcms_user_groups` + `awcms_user_group_members`                                          |
| Invite / "Invite Pending"                                  | `awcms_invitations` + `awcms_invitation_policies`                                         |
| API token + policy `effect`/`resources`/`condition`/expiry | `awcms_machine_credentials` (`sql/082`), diperluas: kelas aksi, kondisi IP, ikatan scope  |
| Tenant → Account (partner)                                 | `awcms_partners` + `awcms_partner_managed_tenants`                                        |
| Subscription `rate_plan` + `component_values`              | `awcms_tenant_subscriptions` + `awcms_tenant_entitlements`                                |
| _(ditangguhkan)_ `POST /accounts` + `unit_tag` + KYC       | `awcms_provider_accounts` — **tidak dibangun**                                            |

Satu perbedaan **disengaja dan tidak diadopsi**: efektif-permission Cloudflare
murni aditif (union, tanpa deny). AWCMS mempertahankan **deny-overrides**
ABAC-nya. Union hanya berlaku di sisi _grant_ (role ∪ group ∪ delegasi);
kebijakan deny tetap menang.

## 4. Sembilan temuan terverifikasi yang membentuk rancangan

Semua diperiksa langsung terhadap kode pada 9 Agustus 2026.

1. **184 berkas rute memanggil `authorizeInTransaction` langsung** (255 total
   rute; hanya 16 lewat `defineTenantRoute`). Setiap input baru **wajib** lewat
   bag `options?`, tidak pernah parameter posisional.
2. **`scripts/access-chokepoint-check.ts` mengunci literal
   `fetchGrantedPermissionKeys(`** sebagai sinyal "handler ini memutuskan
   permission". Mengganti nama fungsi itu membuat gerbang **hijau sambil buta**
   — kelas cacat yang sudah dicatat PROJECT_STATE §4 R9. Nama dipertahankan;
   **tipe kembaliannya** yang berubah.
3. **31 layar `src/pages/admin/*.astro` memutuskan dengan `permissions.has()`
   saja** (R3) — melewati `evaluateAccess`, `resolveModuleEnabled`, dan
   `recordDecisionLog`. **Dua** gerbang buta terhadapnya, bukan satu:
   `access:chokepoint:check` (`ROUTES_ROOT` = `src/pages/api/v1`) dan
   `api:tenant-route:check` (`ROUTES_ROOT` = `src/pages/api`).
4. **`awcms_tenants.status='suspended'` tidak ditegakkan di chokepoint.** Ia
   dibaca hanya di jalur login/reset/registrasi/SSO-start dan di resolver host
   publik. Akibatnya: situs publik tenant langsung mati, sementara sesi admin
   yang sudah terbit tetap penuh akses sampai kedaluwarsa sendiri, dan machine
   credential tidak tersentuh sama sekali.
5. **`awcms_abac_decision_logs` tanpa retensi apa pun** (~8,6 juta baris/hari
   pada 100 rps) **dan** menjadi sumber cursor proyeksi `reporting`, yang
   deskripsinya menyebut tabel itu "append-only — never deleted". Retensi dan
   otoritas proyeksi adalah **satu** keputusan, bukan dua.
6. **`awcms_business_scope_assignments` (`sql/027`) sudah memiliki setiap kolom
   yang dibutuhkan sebuah Policy Cloudflare** — effective dating, expiry,
   revocation, grantor/approver, event log append-only, composite FK. Ia tabel
   Policy yang kebetulan hanya pernah diarahkan ke satu jenis subjek.
7. **Cakupan business-scope hari ini permission-agnostic.** `evaluateAccess`
   bertanya "apakah subjek punya scope fact yang mencakup scope ini?", tidak
   pernah "untuk permission INI". Itulah celah sesungguhnya versus Cloudflare,
   dan menutupnya adalah perubahan satu klausa yang **hanya bisa menolak lebih
   banyak**.
8. **Lockout login per-`(tenant, email)`.** Penyerang yang merotasi header
   `x-awcms-tenant-id` mendapat N × `AUTH_LOGIN_MAX_ATTEMPTS` terhadap manusia
   yang sama. Principal global **memperbaiki** ini, bukan membebaninya.
9. **`policy-cache.ts` memanggil `parseAbacCondition(row.conditions)` tanpa
   argumen versi**, jadi baris ber-`dsl_version: 1` yang memakai atribut versi
   berikutnya akan lolos validasi. Ini wajib diperbaiki **sebelum** daftar
   atribut ABAC tumbuh sama sekali.

## 5. Sembilan gelombang

±43 PR atomic. Setiap PR = satu issue: migrasi + OpenAPI + test + changeset +
docs + regenerasi inventory, `bun run check` penuh hijau. **[R]** = gerbang yang
akan memerah dan wajib diperbaiki di PR yang sama.

### Gelombang 0 — ratchet & kejujuran (1 + 8 PR)

Tidak ada yang melebar; semuanya mengetatkan. Tiap PR bernilai sendiri.

| PR  | Issue       | Isi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [R]                                                                                        |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0.0 | #423 (epic) | Dokumen ini + entri PROJECT_STATE §4 + 9 issue GitHub. Docs-only, bebas changeset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `check:docs`                                                                               |
| 0.1 | #424        | `api:tenant-route:check` `ROUTES_ROOT` mencakup `src/pages/admin`; seed 31 layar ke `NOT_YET_MIGRATED`. **Satu baris** — sejak itu layar admin baru tidak bisa membuka transaksinya sendiri                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                          |
| 0.2 | #425        | `tests/access-chokepoint.test.ts` dibuat **rename-proof**: ganti dua `not.toMatch` berbasis literal nama variabel dengan asersi struktural — tepat **satu** `return { allowed: true }` di badan `authorizeInTransaction`, indeksnya > indeks `evaluateAccess(`. Tambah `deciding.length > 0` di `main()` gerbang                                                                                                                                                                                                                                                                             | —                                                                                          |
| 0.3 | #426        | Gerbang baru `access:decision-log:coverage:check` — setiap `return` terminal di `access-guard.ts` didahului `recordDecisionLog(` di cabang leksikal yang sama. Hijau hari ini, melindungi seluruh gelombang berikutnya                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                          |
| 0.4 | #427        | ADR retensi `awcms_abac_decision_logs` + penyelesaian sengketa otoritas proyeksi `reporting`. Migrasi: index `(tenant_id, created_at)` menaik + `GRANT DELETE … TO awcms_worker` (`sql/022` baru memberi SELECT, jadi job purge hari ini **tidak bisa** menghapus). Deskriptor `dataLifecycle` `identity_access.abac_decision_logs`, `retentionClass: audit_security`, default 90 hari, legal-hold `overrides_retention`. Gerbang baru `data-lifecycle:high-volume-coverage:check`                                                                                                           | `data-lifecycle:registry:check`, `repo:inventory:check`                                    |
| 0.5 | #428        | Pindahkan `resolveClientIp` dari `visitor-analytics/domain/client-ip.ts` ke `src/lib/security/` — pemindahan murni, badan byte-identik, 9 call site berubah baris import saja. Impor lintas-modul dari `identity_access` dilarang [ADR-0011](../adr/0011-capability-ports-for-cross-module-collaboration.md)                                                                                                                                                                                                                                                                                 | `modules:*:check`                                                                          |
| 0.6 | #429        | ADR: `suspended` menjadi status **layanan**, bukan status login. `resolveTenantContext` ikut mengembalikan status tenant (ia sudah membaca baris tenant-user — satu kolom tambahan, bukan query baru); cabang deny baru `403 TENANT_SUSPENDED`, `matchedPolicy: "tenant_suspended"`, **sebelum** permission dicari. Allow-list aksi yang tetap hidup saat suspend ditulis sebagai konstanta ber-komentar "melebarkan ini butuh ADR" — meniru `MACHINE_CREDENTIAL_ALLOWED_ACTIONS`. Endpoint suspend/restore ber-`scope: 'platform'` ([ADR-0053](../adr/0053-platform-scoped-permissions.md)) | `access:permissions:enforcement:check`, `admin:screen-coverage:check`, `db:fk-index:check` |
| 0.7 | #430        | `bun run identity:principals:preflight` — skrip **read-only**, nol migrasi: sensus tabrakan `lower(btrim(login_identifier))` **di dalam** satu tenant (legal hari ini, mustahil setelah principal), identifier non-email, identitas tanpa alamat yang bisa dikirimi surat. Prasyarat Gelombang 7, dijalankan berbulan-bulan sebelumnya                                                                                                                                                                                                                                                       | `scripts:inventory:check`                                                                  |
| 0.8 | #431        | ADR: role menyatakan scope-nya (**menutup R8**). Migrasi: `awcms_roles.attachable_scope_types text[] DEFAULT '{tenant}'` + `permission_scope text DEFAULT 'tenant' CHECK IN ('tenant','platform')`. `listPermissionCatalog` mendapat predikat `scope`; `grantPermissionToRole` memeriksa ulang di server — picker adalah UI, cek adalah kontrolnya                                                                                                                                                                                                                                           | `tests/platform-scoped-permissions.test.ts`, `api:*:check`                                 |

### Gelombang 1 — R3: 31 layar admin lewat chokepoint (1 + 7 PR)

**Wajib selesai sebelum Gelombang 3.** Setelah grant ber-scope,
`ssr.permissions.has()` membaca union lintas-scope — R3 berubah dari "tanpa ABAC
dan tanpa log" menjadi _over-disclosure_ sisi baca yang nyata.

**PR 1.0** — helper `defineAdminScreen({ workClass, authorize, load })` di
`src/lib/auth/`. Direktori itu sudah mengimpor `identity-access/application` dan
sudah masuk `SCAN_ROOTS` `logging:lint:check`, jadi tidak ada batas baru yang
dilintasi. Helper **wajib** meniru `defineTenantRoute`: satu `withTenant`,
`authorizeInTransaction`, dan `load` **di dalam transaksi yang sama** — kalau
helper kembali lalu layar membuka transaksi kedua, keputusan dan pembacaan tidak
atomik dan filter scope terlewat, yaitu lubang yang justru hendak ditutup.

Deny me-render state ditolak, **bukan** redirect: 20+ berkas
`tests/admin-*-page-contract.test.ts` meng-assert id seperti `#users-denied`.

Gerbangnya **memperluas** `access-chokepoint-check.ts` dengan root kedua, bukan
skrip baru — dua skrip berarti dua daftar pengecualian yang menyimpang. Untuk
`.astro` pengirisan **per-berkas**, karena satu berkas `.astro` adalah satu jalur
render; alasan itu ditulis di header skrip supaya tidak dikira pengulangan
kesalahan yang dicatat [ADR-0063](../adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md) §3.
Ledger `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` hanya boleh menyusut, plus cek entri
basi.

**[R] wajib se-PR:** `extractScreenClaims` di
`scripts/admin-screen-coverage-ledger.ts` harus mengenali bentuk objek-literal
`defineAdminScreen({ authorize: { moduleKey: … } })`. Tanpa itu, 133 klaim
permission runtuh dan gerbang memerah karena alasan yang salah.

**PR 1.1–1.7** — ±5 layar per PR, tiap PR menghapus barisnya dari ledger, berkas
`admin-*-page-contract` **tidak** diubah.

### Gelombang 2 — permukaan sesi & kredensial (2 PR)

`awcms_sessions` tidak bisa didaftar hari ini — tidak ada kolom sidik jari.

**PR 2.1** — migrasi menambah `client_ip_hash`, `user_agent_summary`,
`origin_auth CHECK IN ('password','sso','handoff','switch')`, dan
`switchable boolean DEFAULT true`. Diisi oleh `hashClientIp`/`summarizeUserAgent`
yang **sudah** diimpor `login.ts`. **Tanpa `last_seen_at`** — tulis per-request di
jalur baca otorisasi adalah amplifikasi tulis demi kolom kosmetik.

Endpoint: `GET /auth/sessions`, `DELETE /auth/sessions/{id}`,
`POST /auth/sessions/revoke-all?exceptCurrent=true`,
`POST /auth/password/change` (step-up aal2 + password lama),
`GET|POST /users/{id}/sessions[/revoke-all]`.

`read` dan `revoke` adalah **dua permission terpisah**, mengikuti alasan yang
sudah ditulis `identity-access/module.ts` untuk `machine_credentials`: saat
insiden Anda ingin orang yang bisa membunuh kredensial bocor tanpa bisa
mencetaknya.

`POST /auth/password/change` menutup celah nyata — hari ini satu-satunya cara
mengganti password adalah putaran forgot/reset lewat email.

**PR 2.2** — `revokeAllSessionsForIdentity` mendapat saudara per-principal
(dipakai Gelombang 7); `origin_auth` diisi di ketiga penerbit sesi.

### Gelombang 3 — bentuk Policy Cloudflare (5 PR) — risiko tertinggi

**PR 3.1** — ADR _satu grant membawa scope-nya sendiri_. Tabel
`awcms_access_policies`: `subject_type CHECK IN ('tenant_user','user_group')`
plus XOR dua kolom subjek, `role_id`, `scope_type`, `scope_id`, effective dating
lengkap, status `active|expired|revoked`, **enam composite FK ber-`tenant_id`**,
`UNIQUE (tenant_id, id)`, unique parsial aktif, ENABLE + FORCE RLS. Plus
`awcms_access_policy_events` append-only.

Composite FK itu wajib, bukan gaya: PostgreSQL menjalankan pemeriksaan
referential integrity sebagai **pemilik tabel** dan **melewati RLS**, jadi
`REFERENCES awcms_tenant_users (id)` polos bisa menunjuk baris tenant lain
sekalipun FORCE RLS aktif. Alasan lengkapnya ada di header `sql/027`.

**Tabel baru, bukan perluasan** — tiga alasan, urut bobot:

1. `UNIQUE (tenant_id, tenant_user_id, role_id)` di `awcms_access_assignments`
   justru yang harus mati (satu role di tiga scope = tiga baris). Menjatuhkan
   unique index di tabel otorisasi hidup juga diam-diam menghapus `23505` yang
   dipetakan `assignRole` menjadi 409.
2. Memperluas `awcms_business_scope_assignments` di tempat berarti menulis ulang
   dua pembaca SoD di PR yang sama — dan SoD adalah satu-satunya subsistem yang
   jawaban salahnya tak terlihat sampai ada auditor bertanya.
3. Tabel ketiga memungkinkan _expand / migrate / contract_ **tanpa dual-write**.

`fetchGrantedPermissionKeys` **mempertahankan namanya** (temuan #2); tipe
kembalinya menjadi `{ keys: Set<string>; scopes: Map<string, …> }`. Isinya
`UNION ALL` tiga tabel — dengan tabel baru kosong, hasilnya **persis** data hari
ini. 11 call site menjadi `.keys`, dicek kompiler.

Bukti: oracle diferensial terhadap query lama untuk korpus subjek acak,
dijalankan selama kedua sumber masih hidup.

**PR 3.2** — semua penulis grant menulis Policy. Endpoint
`POST /api/v1/access/policies`; `/access/assignments` lama tetap ada dan
mendelegasi. **[R]** `tests/access-assignment-writers.test.ts` `WRITE_MARKER`
pindah ke `awcms_access_policies`.

**PR 3.3** — backfill dua tabel lama ke Policy dengan **mempertahankan `id`**
agar referensi audit selamat, lalu `REVOKE INSERT, UPDATE, DELETE` dari
`awcms_app` sehingga keduanya menjadi sejarah read-only. Oracle dijalankan sekali
lagi **setelah** backfill.

**PR 3.4** — **kualifikasi scope.** `BusinessScopeFact` mendapat
`permissionKeys?: ReadonlySet<string>`; di dalam predikat cakupan satu klausa
ditambahkan:

```ts
if (fact.permissionKeys !== undefined && !fact.permissionKeys.has(key))
  return false;
```

Dengan `undefined` — yang dibawa setiap fact turunan-legacy — ekspresinya
identik dengan hari ini; setelah diisi, satu-satunya perubahan yang mungkin
adalah `true → false`. **Tidak ada input, dalam urutan apa pun, yang bisa
diubahnya dari deny menjadi allow.** Itu seluruh argumen keamanannya, dan bisa
diperiksa dengan membaca empat baris.

Kill switch: konstanta **build-time** `SCOPE_NARROWING_ENABLED`, bukan env var —
dua instance dalam satu deployment bisa berbeda pendapat, dan cache policy sudah
per-proses. Permukaan admin yang **menulis** grant ber-scope wajib PR
**setelah** resolver: selama belum ada grant non-tenant-wide, rollback adalah
"balik konstanta, redeploy".

**Catatan reviewer:** setiap test business-scope yang ada harus lulus **tanpa
diubah**. Kalau ada yang perlu diedit, perubahannya salah.

**PR 3.5** — ADR User Groups. `awcms_user_groups` (dengan
`source CHECK IN ('local','scim')` dan `external_id` sebagai kunci sinkron —
**jangan** `group_code`, karena rename grup di IdP tidak boleh mengorphankannya)
plus `awcms_user_group_members`. Subjek diselesaikan lewat satu CTE `UNION ALL`,
sehingga **jumlah query tetap satu** dan jalur panas tidak melambat.

Grup **memberi role**, dan role memberi permission, supaya `subject.roles`,
`fetchGrantedPermissionKeys`, dan resolver fakta SoD tetap berada di satu sumbu
keanggotaan.

**Ini mode kegagalan senyap gelombang ini.** Kalau grup memberi permission tanpa
memberi role, kebijakan tenant `subject.roles in ["editor"]` diam-diam berhenti
cocok — sebuah **deny yang menjadi inert**, yaitu pelebaran — dan SoD berhenti
mendeteksi konflik untuk grant turunan-grup, persis untuk grant yang keberadaan
fitur grup dimaksudkan menciptakannya. Tidak ada test yang meng-assert sebuah
policy **memang** cocok, jadi tidak ada yang menangkapnya. Gerbang baru
`access:sod-fact-parity:check` mewajibkan kedua resolver merujuk satu konstanta
`grantSourceTables()` bersama.

SCIM: grup `source='scim'` menolak mutasi keanggotaan dan rename lewat admin API
dengan `409 GROUP_EXTERNALLY_MANAGED`, meniru grup SCIM Cloudflare yang
immutable. **SCIM tidak dibangun** — hanya tidak dihalangi.

### Gelombang 4 — undangan (2 PR)

**PR 4.1** — `awcms_invitations` (`status pending|accepted|revoked|expired`,
`resend_count <= 5` sebagai CHECK basis data, `skip_email_confirmation`) plus
`awcms_invitation_policies` — **undangan membawa Policy-nya**, persis Cloudflare.

Token: berkas baru `src/lib/auth/invitation-token.ts` meniru konstruksi
`reset-token.ts` (32 byte CSPRNG base64url, hash `sha256:` heks) tetapi dengan
**nama fungsi berbeda** — presedennya sudah ditulis di docblock `reset-token.ts`:
sepasang nama tersendiri supaya satu jenis token tidak pernah bisa dikira jenis
lain di sebuah call site.

Resend **merotasi** token dan membatalkan tautan lama; tanpa rotasi, "resend"
adalah permukaan perbanyakan token.

`skip_email_confirmation` hanya boleh dipakai oleh permission ber-`scope:
'platform'`, atau bila principal target sudah terverifikasi. Kalau tidak, admin
tenant mana pun bisa mencetak principal **global** tak terverifikasi untuk
`ceo@perusahaanlain.com` — dan principal global adalah satu-satunya objek di
mana itu penting.

**PR 4.2** — penerimaan. `materializeMembership()` diperkenalkan di sini sebagai
**satu fungsi** yang nanti diarahkan ulang Gelombang 7.
`GET /auth/invitations/{token}` (preview: nama tenant + nama pengundang,
**tidak pernah** email) dan `POST …/accept`, keduanya tanpa autentikasi →
**wajib `checkSharedRateLimit`** ([ADR-0066](../adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md)).

Token kedaluwarsa dijawab **404, bukan 410** — jangan membuat oracle status.
Undangan yang menyebut role `is_system` ditolak saat pembuatan **dan** diperiksa
ulang saat penerimaan; presedennya `approveRegistrationRequest`.

Undangan dan self-registration **keduanya tetap ada**: arahnya berlawanan —
registrasi adalah _tarik_ (orang asing meminta), undangan adalah _dorong_ (admin
menawarkan) — dan masing-masing punya permission dan cerita audit sendiri.

**[R] `tests/shared-rate-limit.test.ts` naik 11 → 13 permukaan.** ADR-0066
menulis "sebelas"; sebutkan perubahannya di changeset.

### Gelombang 5 — entitlement (SaaS) (4 PR)

**PR 5.1** — Global tanpa RLS, dengan preseden `awcms_permissions`:
`awcms_entitlements`, `awcms_plans`, `awcms_plan_entitlements`. Tenant + FORCE
RLS: `awcms_tenant_subscriptions`, `awcms_tenant_entitlements`. Keduanya
**wajib** didaftarkan di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` **dan** peta
hak-akses di `scripts/security-readiness.ts` — `tests/repo-inventory.test.ts`
meng-assert kedua sisi cocok, jadi tabel global yang tidak dideklarasikan
memerahkan dua gerbang.

`resolveModuleEnabled` menjadi `resolveModuleAvailability` — `LEFT JOIN` pada
query yang **sudah** berjalan, jadi nol round-trip tambahan. Deny baru
`403 ENTITLEMENT_REQUIRED`, `matchedPolicy: "entitlement_required"`, ditempatkan
**setelah** `module_disabled` (tenant yang mematikan modulnya sendiri berhak
diberi tahu itu, bukan ditawari upgrade) dan **hard-exempt** untuk tenant
platform, modul `isCore`, serta setiap deskriptor tanpa entitlement. Tenant
platform wajib dikecualikan keras: langganan yang lewat tempo tidak boleh
mengunci operator keluar dari control plane-nya sendiri.

**Mendarat inert:** nol deskriptor menyatakan `requiresEntitlement`. Test emas
membuktikan rantai guard byte-identik dengan sebelumnya, termasuk baris decision
log yang sama.

`MODULE_CONTRACT_VERSION` naik ke 2.6.0 (aditif murni — tidak menyatakan
entitlement berarti "tanpa batasan", yang adalah makna setiap deskriptor hari
ini), dipasangkan bump `awcms-family-compatibility.yaml`.

Gerbang baru `access:entitlement:deny-only:check` — evaluator entitlement tidak
mengekspor fungsi yang bisa mengembalikan `{ allowed: true }`. Ini persis kelas
mutasi yang dicatat ADR-0063.

**PR 5.2** — `evaluateSubscriptionTransition(now, subscription, policy)`
**murni, tanpa basis data**: `trialing → active → past_due → grace → suspended`,
menyambung ke gerbang suspensi PR 0.6. Job adalah satu-satunya penulisnya.

**PR 5.3** — mesin grandfathering: `bun run entitlements:backfill` (dry-run
default, aturan `skippedAsDeliberate` diambil dari
`identity-access/domain/owner-permission-backfill.ts`), laporan **blast-radius**
di `bun run security:readiness` — _"N tenant akan mulai menerima 403
ENTITLEMENT_REQUIRED untuk modul X"_ — yang wajib dijalankan **sebelum**
deskriptor mendarat, bukan sesudah. Itulah cek yang akan menangkap kesalahan
aslinya sebelum ia terkirim.

Satu hal membuat ini boleh menjadi migrasi selimut, tidak seperti backfill
permission: entitlement **tidak pernah ada untuk dicabut**, jadi ketiadaannya
tidak pernah bisa berarti keputusan sengaja. Asimetri itu yang membedakannya.

**PR 5.4** — pelekatan entitlement nyata pertama pada satu modul non-core,
`409 ENTITLEMENT_REQUIRED` di endpoint enable `module_management` (sopan santun,
bukan kontrolnya), dan layar `/admin/subscriptions`.

### Gelombang 6 — metering & kuota (IaaS) (4 PR)

**PR 6.1** — ADR: **kuota adalah admission control, BUKAN otorisasi.** Empat
alasan, dan tidak satu pun cukup sendirian:

1. Kuota bukan fakta subjek. Ia dimutasi oleh aksi yang sedang diotorisasi, jadi
   butuh `SELECT … FOR UPDATE` di transaksi tulis yang sama; chokepoint berjalan
   sebelum handler dan tidak bisa memegang kunci itu.
2. Menghitung sumber daya berarti mengetahui tabelnya. Menaruh itu di chokepoint
   memaksa `identity_access` mengimpor skema setiap modul — persis yang dilarang
   ADR-0011, dan `modules:table-writes:check` akan menolaknya.
3. Ia meracuni sinyal keamanan: `awcms_abac_decision_logs` adalah catatan
   keamanan. Menulis baris `deny` di sana untuk kondisi kapasitas bisnis membuat
   "anomali penolakan otorisasi" tidak terbaca.
4. Jawabannya kelas HTTP lain. `409 QUOTA_EXCEEDED` bisa ditindaklanjuti
   ("upgrade"); `403 ACCESS_DENIED` tidak.

Jadi: **kapabilitas** (boolean, turunan plan, bebas-request) di chokepoint;
**volume** lewat `_shared/ports/quota-port.ts` yang dipanggil lapisan aplikasi
modul pemiliknya, di dalam transaksi tulisnya sendiri.

Tiga tabel dengan kardinalitas yang dirancang, bukan kebetulan:

| Tabel                  | Ditulis saat                                                    | Kardinalitas                            | Retensi                                                       |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `awcms_usage_counters` | tiap kejadian termeter, `INSERT … ON CONFLICT DO UPDATE`        | tenant × meter × periode — **terbatas** | 90 hari, `generic`                                            |
| `awcms_usage_records`  | **hanya** meter ber-`itemized: true` — tidak pernah per-request | satu baris per kejadian layak-tagih     | 2555 hari, `financial_tax`, arsip `jsonl`, legal-hold berlaku |
| `awcms_usage_rollups`  | oleh job, dari counters                                         | harian/bulanan per tenant per meter     | panjang, `financial_tax`                                      |

Jalur panas menyentuh **satu baris per tenant per meter per periode**, tidak
pernah append. `itemized` adalah flag deskriptor supaya "apakah meter ini menulis
baris ledger" menjadi keputusan yang direview di kode, bukan kebiasaan call site.

Ketiganya wajib punya deskriptor `dataLifecycle` **di PR yang sama** — gerbang
PR 0.4 menegakkannya. `MODULE_CONTRACT_VERSION` naik ke 2.7.0.

**PR 6.2–6.4** — job rollup + bukti retensi; meter nyata pertama; API usage dan
layar `/admin/usage`.

### Gelombang 7 — principal global (4 PR) — risiko struktural tertinggi

Dieksekusi sebagai **pengangkatan otoritas yang tidak memindahkan satu foreign
key pun.** `awcms_identities` diturunkan maknanya sambil tetap identik secara
fisik: kolom `principal_id` nullable ditambahkan; otoritas (kredensial, MFA,
lockout, kepemilikan email) naik satu PR sekali; `awcms_identities.id` dan
delapan FK masuknya tidak bergerak. `resolveTenantContext` dan
`authorizeInTransaction` **tidak pernah tahu principal itu ada**.

**PR 7.1** — ADR _satu manusia, satu kredensial, banyak tenant_.
`awcms_principals` global tanpa RLS.

Kalimat yang membuat ketiadaan RLS bisa dipertahankan, wajib verbatim di ADR:
**"principal adalah fakta AUTENTIKASI, tidak pernah fakta OTORISASI."**
`awcms_permissions` adalah preseden tabel global — tetapi ia katalog yang tidak
memberi apa pun hanya karena ada; tabel kredensial bukan itu. Karena itu **empat
kontrol menggantikan RLS**:

1. **Hak basis data dipersempit.** `REVOKE ALL` lalu
   `GRANT SELECT, INSERT, UPDATE` — **tidak pernah DELETE**.
2. **Invarian bentuk-baca, diperiksa mesin.** Gerbang baru
   `identity:principal-access:check`: hanya berkas dalam allow-list boleh
   menyebut tabelnya, dan setiap query di sana berkunci `id =` atau
   `email_normalized =` — tidak pernah scan tak berbatas, tidak pernah `LIKE`.
   RLS membatasi _baris_; ini membatasi _call site_.
3. **Invarian proyeksi.** `password_hash` tidak pernah meninggalkan modul store.
4. **Batas otorisasi tidak berubah.** Memegang principal tidak memberi apa pun;
   otorisasi tetap melewati `awcms_tenant_users` di bawah FORCE RLS.

Backfill: satu principal per email ter-normalisasi distinct; `password_hash`
tetap **NULL**. Kredensial **dipromosikan** saat login sukses pertama (verifikasi
terhadap hash identitas, lalu tulis ke principal). Itulah yang membuat backfill
aman: ia tidak memindahkan satu rahasia pun dan tidak bisa mengunci siapa pun.
Migrasi gagal keras bila sensus PR 0.7 menemukan tabrakan.

**PR 7.2** — login mengautentikasi principal; kredensial promosi saat pakai
pertama; **lockout menjadi global**. Test regresi: merotasi header tenant tidak
mereset penghitung — yaitu perbaikan temuan #8.

**PR 7.3** — MFA pindah ke principal (enkripsi sama seperti `sql/024`).
Konsekuensi yang **wajib ditulis di ADR**: reset MFA oleh admin tenant A kini
global, dan karena itu diaudit di log **kedua** tenant. Ini satu-satunya tempat
tindakan admin tenant menjangkau keluar tenantnya, jadi ia harus tindakan yang
disengaja, ber-permission, dan tercatat.

**PR 7.4** — login tanpa header tenant → `409 MEMBERSHIP_SELECTION_REQUIRED`
plus **principal token** (namespace hash baru, ≤120 detik, sekali pakai) →
`POST /auth/session/tenant`; ditambah `POST /auth/session/switch`.

**Invarian paling berbahaya di seluruh program:** principal token tidak boleh
**pernah** mengautentikasi `authorizeInTransaction`. Tiru
[ADR-0049](../adr/0049-machine-credentials-and-session-introspection.md) persis
— jenis bearer dibawa oleh namespace hash-nya, `isPrincipalTokenHash()` diperiksa
**sebelum** `resolveTenantContext`, dan hash principal menghasilkan 401 keras.
Test: sodorkan principal token ke lima endpoint terjaga, assert 401 pada semuanya
**dan nol baris decision log**.

**Aturan non-switchable:** sesi yang lahir dari IdP tenant
(`awcms_external_identities`, `sql/025`) atau dari break-glass **wajib**
`switchable = false`. Tanpa aturan itu, administrator IdP tenant B bisa
meng-assert `alice@corp.com`, menerima sesi, lalu berpindah ke tenant A —
pengambilalihan lintas-tenant lengkap lewat fitur yang tampak seperti
kenyamanan.

**[R]** `tests/shared-rate-limit.test.ts` naik 13 → 15.

### Gelombang 8 — partner / EaaS + akses terdelegasi (5 PR)

**PR 8.1** — ADR: **`ModulePermissionScope` tetap `{tenant, platform}` — tidak
ada nilai `partner`.** Alasannya masuk rekaman karena orang berikutnya akan
mengusulkannya lagi: `scope` mengatur siapa yang boleh _memegang_ sebuah
permission; kemitraan mengatur _objek mana_ yang disentuhnya. Menyatukan keduanya
menghasilkan permission yang dipegang dengan benar dan dijalankan terhadap tenant
yang salah — dan tidak satu pun policy RLS akan keberatan, karena aktornya memang
terautentikasi secara sah di suatu tempat.

Sebagai gantinya: **partner adalah tenant biasa** (`awcms_partners`,
`awcms_partner_managed_tenants`). Argumen yang sama dipakai ADR-0053 untuk
menolak superadmin global. Jangkauan adalah **data**, bukan permission.

**PR 8.2** — ADR akses terdelegasi. Grant yang disetujui **mencetak baris
`awcms_tenant_users` biasa** di tenant target, terikat role `support` terbatas
dan baris `awcms_delegated_access_grants` ber-`expires_at NOT NULL`. Semua hilir
bekerja **tanpa perubahan** — RLS, decision log, audit, SoD, business-scope facts
— karena aktornya memang benar-benar tenant user di sana. Presedennya
[ADR-0050](../adr/0050-bff-session-handoff-code.md), yang juga mencetak sesi
segar dari artefak ber-hash berumur pendek alih-alih menyimpan kredensial hidup.

Baris grant ber-RLS pada tenant **TARGET**: pelanggan wajib bisa melihat dan
mencabut setiap akses ke tenantnya sendiri; pandangan partner lewat fungsi
`SECURITY DEFINER` sempit, preseden `sql/048`. Asimetri itu disengaja —
pandangan pelanggan yang otoritatif.

Sesi turunan grant: `switchable = false`, TTL terbatas, dan mati bersama grant di
transaksi yang sama (pola yang sudah dipakai `setTenantUserStatus`).

**PR 8.3** — atribusi dua sisi: setiap baris decision log dan audit di bawah
grant membawa `grant_id` plus identitas asal, dan `awcms_audit_events` mendapat
`actor_tenant_id`. Ini menutup tindak lanjut terbuka
[ADR-0054](../adr/0054-tenant-provisioning.md): _"tenant yang dibuat tidak
melihat catatan kelahirannya sendiri."_

**PR 8.4** — permukaan `/api/v1/partner/tenants/**`, diotorisasi oleh
`awcms_partner_managed_tenants` **dan** grant aktif — tidak pernah oleh sebuah
permission saja.

**PR 8.5** — kelas tulis machine credential (Cloudflare: token punya policy
sendiri). Plafon tetap **di kode**: `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS`
di-intersect dengan kolom per-kredensial. Kalau aksi menjadi kolom murni, satu
restore backup, satu INSERT tangan, atau satu jalur provisioning yang kehilangan
`WHERE` bisa mencetak kredensial tulis se-katalog dengan semua gerbang hijau.

Bukti: test yang menghitung `WRITE_ALLOWED ∩ HIGH_RISK_ACTIONS = ∅` **dari
konstanta hidup**, bukan dari daftar literal yang akan menyimpang begitu ada aksi
high-risk baru.

Ditambah kondisi IP (**wajib deny bila `clientIp` tidak tersedia** — kalau tidak,
setiap rute yang belum dimigrasi diam-diam mematikan kondisinya), ikatan scope,
dan `MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS = 30`.

Sentinel `machine_credential_readonly` **dipertahankan verbatim** — ia ada di
sejarah decision log dan di ADR-0049; menggantinya menulis ulang masa lalu bagi
konsumen log.

## 6. Aturan lintas-gelombang

1. **Urutan langkah chokepoint yang tidak boleh bergerak.** Gerbang struktural
   (machine-credential, `module_disabled`, `entitlement_required`,
   `platform_scope_required`, `tenant_suspended`) **wajib** berada di atas
   `fetchGrantedPermissionKeys`. Semuanya menjawab "grant pemanggil tidak boleh
   memengaruhi hal ini". Memindahkan salah satunya ke bawah mengubah gerbang
   struktural menjadi gerbang berbentuk-permission, dan kegagalannya tidak
   terlihat: sebuah baris grant yang seharusnya tidak ada menjadi cukup.
2. **`narrowPermissionKeys` tetap di antara fetch dan pelebaran
   `ownershipGrant`.** Setelah ada kelas kredensial tulis, klausa `!machine` jauh
   lebih menanggung beban daripada hari ini.
3. **Setiap gerbang baru deny-only.** Tidak satu pun boleh menghasilkan
   `allowed: true`.
4. **Klaim berbentuk "X berjalan sebelum Y" wajib diuji di level SOURCE**, karena
   test perilaku bisa dipuaskan oleh susunan yang benar _dan_ oleh susunan yang
   termutasi. Ini generalisasi ADR-0063, di mana mutasi yang memindahkan cek RBAC
   ke atas blok ABAC **membuat seluruh test tetap hijau**. Dan setiap asersi
   source wajib **rename-proof**, atau dipasangkan dengan asersi keberadaan
   identifier — kalau tidak ia lolos secara hampa.
5. **Pelebaran hanya mendarat setelah penyempitan yang membatasinya.** Kolom
   skema yang mengubah input evaluasi mendarat dengan backfill yang membuatnya
   no-op, **plus test yang membuktikan ke-no-op-annya**.
6. **Tidak ada atribut ABAC baru kecuali dua**, dan hanya bila gelombangnya
   mendarat:
   - `subject.principalKind` (`string`: `user|machine|delegated`, sumber
     `subject`). Tanpa ini tenant **tidak bisa** menuliskan "partner tidak boleh
     menyetujui", dan satu-satunya alternatif adalah aturan hard-coded yang tak
     bisa disetel tenant mana pun.
   - `resource.scopeType` (`string`, sumber `resource`) — proyeksi ulang murni
     dari `requiredScopeType` yang sudah dibaca guard. Nol I/O baru.

   **Ditolak:** `subject.groups` (grup dimodelkan sebagai pemberi role, jadi
   `subject.roles` sudah cukup; dua sumbu berarti setiap kebijakan lama harus
   ditulis ulang, dan yang tidak ditulis ulang menjadi lubang senyap);
   `subject.entitlements` / `env.planTier` (entitlement adalah gerbang struktural
   deny-only — mengekspornya berarti tenant bisa menulis `allow` berkondisi
   entitlement, dan semantik _allow-as-constraint_ akan membuat downgrade plan
   menolak lewat jalur kode lain dengan sentinel lain: dua jawaban untuk satu
   pertanyaan); `resource.ownerTenantId` / `subject.partnerTenantId`
   (`tenant_isolation` sudah memiliki penalaran lintas-tenant dan berjalan lebih
   dulu; atribut yang bisa mengungkapkan perbandingan lintas-tenant mengundang
   kebijakan yang _tampak_ melonggarkannya); dan **menyambungkan `env.ipTrusted`
   sungguhan** (hard-coded `false` di dua tempat hari ini — menyambungkannya
   membalik setiap leaf yang membacanya, sebuah perubahan otorisasi hidup yang
   menyamar sebagai pekerjaan infrastruktur; PR-nya sendiri, dengan diff decision
   log sebelum/sesudah, tidak pernah dibundel).

   Prasyarat sebelum daftar atribut tumbuh sama sekali: perbaiki temuan #9.

## 7. Ledger gerbang yang akan memerah

| Gerbang / test                                                                           | Memerah di                        | Sebab                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access:permissions:enforcement:check`                                                   | 0.6, 0.8, 2.1, 3.5, 4.1, 5.x, 8.x | daftar pengecualiannya **kosong** (skor 203/203); tiap permission baru butuh enforcer **di PR yang sama** — [ADR-0058](../adr/0058-unenforced-permissions-disposition.md) membuat satu entri pengecualian berharga satu ADR                                                      |
| `admin:screen-coverage:check`                                                            | 0.6, 0.8, 1.0, 2.1, 3.5, 4.1, 5.4 | permission baru wajib diklaim layar atau masuk ledger satu-arah; **plus** `extractScreenClaims` harus mengenali `defineAdminScreen` di PR 1.0                                                                                                                                    |
| `tests/access-assignment-writers.test.ts`                                                | 3.2                               | `WRITE_MARKER` menyebut tabel lama                                                                                                                                                                                                                                               |
| `tests/shared-rate-limit.test.ts`                                                        | 4.2 (11→13), 7.4 (13→15)          | **paling mudah terlupa — ia tinggal di berkas test, bukan di `scripts/`**                                                                                                                                                                                                        |
| `tests/repo-inventory.test.ts`                                                           | 5.1, 7.1                          | tiap tabel global baru wajib dideklarasikan di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` **dan** peta hak `security-readiness.ts`                                                                                                                                                      |
| `tests/platform-scoped-permissions.test.ts`                                              | 0.6, 0.8, 4.1, 8.x                | mengikat kode ↔ basis data dua arah                                                                                                                                                                                                                                              |
| `db:fk-index:check`                                                                      | tiap PR bertabel                  | [ADR-0064](../adr/0064-foreign-key-columns-must-be-index-reachable.md): satu index per kolom FK                                                                                                                                                                                  |
| `api:consumer-contract:check`                                                            | 8.5                               | `/access/machine-credentials` termasuk permukaan beku [ADR-0065](../adr/0065-awcms-astro-consumer-contract-is-frozen.md); **rancang field kelas-tulis sebagai penambahan murni** yang default-nya mereproduksi perilaku read-only hari ini — subset aditif lolos, rename memerah |
| `family:conformance:check`                                                               | 5.1 (2.6.0), 6.1 (2.7.0)          | tiap bump `MODULE_CONTRACT_VERSION` dipasangkan `awcms-family-compatibility.yaml`                                                                                                                                                                                                |
| `tests/adr-implementation-status.test.ts`                                                | tiap PR ber-ADR                   | ADR wajib melepas kualifikasi "belum diimplementasikan" di PR yang mendaratkan artefaknya                                                                                                                                                                                        |
| `skills:check`                                                                           | 1.x, 2.1, 5.4, 6.4                | aturan 5: tiap URL `/admin/…` berbacktick wajib resolve; menyebut layar yang belum dibangun memerahkannya                                                                                                                                                                        |
| `check:docs:translation`, `changeset:policy`, `repo`/`project-state`/`scripts` inventory | tiap PR                           | mekanis; regenerasi se-PR                                                                                                                                                                                                                                                        |

**Gerbang yang TIDAK akan memerah padahal seharusnya:**
`access:chokepoint:check` tetap hijau bila `fetchGrantedPermissionKeys` diganti
nama, sambil melaporkan "0 handler memutuskan permission". PR 0.2 menambahkan
asersi `deciding.length > 0` justru untuk itu.

**Enam gerbang baru:** `access:decision-log:coverage:check` (0.3),
`data-lifecycle:table-coverage:check` (0.4 — **mendarat dengan nama dan bentuk
yang berbeda dari yang direncanakan di sini**; lihat catatan di bawah),
`access:grant-readers:check` (3.1 — hanya dua berkas resolver boleh membaca
tabel grant; hari ini **enam** berkas merakit join sendiri, dan itulah cara
mereka menyimpang), `access:sod-fact-parity:check` (3.5),
`access:entitlement:deny-only:check` (5.1), `identity:principal-access:check`
(7.1).

**Koreksi terhadap rencana ini, ditulis di tempat rencananya (#437).** Gerbang
0.4 direncanakan sebagai `data-lifecycle:high-volume-coverage:check` — sebuah
gerbang atas tabel VOLUME-TINGGI. Tiga cara menurunkan "volume tinggi" dari
artefak repo dibangun dan diukur, dan ketiganya gagal terhadap skema ini:
_append-only di sumber_ (46 tabel; `INSERT … ON CONFLICT DO UPDATE` terbaca
sebagai append), _tanpa jalur hapus_ (94 tabel; repo ini memakai
`ON DELETE CASCADE` di **satu** migrasi saja, jadi "tanpa cascade" tidak
membedakan apa pun), dan _tak-terbatas menurut skema_ (121 dari 128; tabel
terbatas yang nyata ber-kunci pada teks terkurasi seperti `module_key`, yang
tidak bisa dibedakan dari nilai bebas dengan membaca DDL). Gerbang yang daftar
pengecualiannya 90% skema adalah daftar tulis-tangan yang menyamar.

Jadi pertanyaannya diganti: alih-alih menurunkan tabel MANA yang volume-tinggi
— yang menuntut tahu bagaimana produknya dipakai — turunkan saja bahwa sebuah
tabel ADA, lalu buat kewajibannya mustahil dilewati. Tabel baru wajib membawa
deskriptor `dataLifecycle` atau pengecualian beralasan; 114 tabel yang sudah ada
duduk di ledger warisan yang hanya boleh menyusut. Yang **tidak** bisa
dilakukannya, dan tidak diklaimnya: memberi tahu bahwa tabel LAMA di ledger itu
sedang memakan disk. Itu pertanyaan tentang lalu lintas, dan tempat jujurnya
`security:readiness` terhadap basis data nyata — bukan gerbang murni di rantai
`check`.

## 8. Yang **tidak** dikerjakan program ini

- **Modul provisioning / Cloudflare Tenant API.** Dicoret sesuai keputusan
  _shape-only_. Adaptor DNS `tenant_domain` yang ada tetap apa adanya — ia
  sengaja terkurung satu zona, sementara Tenant API menuntut kredensial partner
  yang bisa **menghapus permanen** akun pelanggan; itu blast radius kategori
  lain, jadi modul kedua, bukan perluasan.
  Baris terakhir tabel isomorfisme (`awcms_provider_accounts`, `unit_tag`, KYC
  maksimal 120 karakter per field, dan urutan wajib "hapus Logpush job, konfigurasi
  Zero Trust Gateway, dan Access organization **sebelum** akun") adalah
  **rancangan tertangguh yang tidak boleh dikontradiksi**.
- **SCIM.** Hanya tidak dihalangi: kolom `source`, `external_id`, dan keanggotaan
  per-tenant-user adalah bentuk yang akan ditulisi `/scim/v2/Groups` nanti.
- **SAML dan WebAuthn.** Di luar cakupan; `provider_type` tetap `{oidc}`,
  `factor_type` tetap `{totp}`.
- **Menyambungkan `env.ipTrusted` sungguhan.** PR-nya sendiri, keputusan
  sebelum/sesudah tersendiri.

## 9. Cara melanjutkan

1. Baca [`docs/PROJECT_STATE.md`](../PROJECT_STATE.md) §4 — titik-lanjut resmi.
2. Kerjakan Gelombang 0 berurutan: epic #423, anak #424–#431.
3. Setiap PR: `DATABASE_URL="" bun run test`, lalu `bun run build`, lalu
   `bun run check` **penuh** (36 segmen, bukan subset).
4. Suite DB-gated butuh PostgreSQL lokal, dan koneksinya **wajib** sebagai
   `awcms_app` — bukan pemilik migrasi. Sebagai pemilik, FORCE RLS inert dan
   setiap test isolasi tenant lolos secara palsu.
5. Untuk gerbang apa pun yang ditambahkan: **mutasikan sumbernya secara lokal dan
   pastikan gerbangnya merah.** Gerbang cakupan bisa hijau sambil seluruh
   jawabannya salah.
