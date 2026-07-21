# ADR-0031 — Segregation of duties (SoD) generik, exception/override, dan conflict enforcement untuk ERP

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** maintainer
- **Terkait:** Issue #181, epic #177 (kesiapan fondasi ERP turunan, Wave 2 authorization); ADR-0030 (business-scope hierarchy #180 — fondasi yang di-atas-nya SoD dibangun); ADR-0011 (capability port); ADR-0025 (module composition seam #178); ADR-0026 (modular OpenAPI); port dari awcms-mini Issue #746 (diadaptasi, bukan disalin).

## Konteks

ERP membutuhkan pemisahan kewenangan agar satu aktor tidak menguasai seluruh siklus transaksi berisiko (membuat vendor sekaligus menyetujui pembayaran; membuat jurnal sekaligus mem-posting; membuat permintaan sekaligus menyetujuinya). AWCMS sudah punya RBAC default-deny, ABAC baseline, business-scope hierarchy (#180), workflow self-approval guard, dan audit — tetapi belum punya **registry SoD generik**, **conflict detection**, **exception workflow**, dan **enforcement lintas assignment/action**.

Fondasi ini matang di awcms-mini (#746), tetapi di sana SoD dan business-scope dibangun **bersama**. #180 mem-port hanya fondasi business-scope dan meninggalkan seam bersih (`// SoD SEAM (#181)`); ADR ini mengisi seam itu.

## Keputusan

Mem-port lapis SoD generik dari mini, dengan keputusan:

1. **Rule descriptor versioned, code-only, kontribusi via composition seam (#178).** `SoDRuleDescriptor` (`_shared/module-contract.ts`, `MODULE_CONTRACT_VERSION` 1.2.0 → 1.3.0) adalah metadata tepercaya yang dideklarasikan `module.ts` modul pemilik — pasangan/kelompok `conflictingPermissionKeys` (≥2), `scopeApplicability` (`same_scope_only`/`global_within_tenant`/`any`), `severity`, dan `exceptionPolicy`. **Base tidak pernah men-hardcode rule domain** (out-of-scope #181: finance/procurement/payroll/inventory). Rule mengalir lewat `listModules()` dari modul domain (ditambahkan langsung ke `src/modules/`, ADR-0034); fixture in-repo (`tests/fixtures/example-domain-modules/`) menyumbang **≥5 contoh ilustratif** — bukan rule base bawaan.
2. **Registry gate machine-readable → CI.** `identity-access/domain/sod-rule-registry.ts` mengagregasi + memvalidasi `listModules()` (owner cocok, ruleKey unik, ≥2 key, enum valid, exceptionPolicy konsisten). Di-wire lewat `scripts/identity-access-sod-registry-check.ts` (`bun run identity-access:sod-registry:check`) ke rantai `bun run check` **dan** step CI (paritas dengan `reporting:projections:registry:check`). SoD registry drift (duplicate ruleKey / owner mismatch) membuat CI merah. Rule fixture divalidasi oleh `tests/sod-rule-registry.test.ts` (base + fixture ter-compose), yang juga berjalan di `bun test`/CI.
3. **Conflict matcher murni, fakta di-resolve di luar (I/O terpisah dari keputusan).** `domain/sod-conflict-evaluation.ts` (`createSoDConflictEvaluator`/`detectSoDConflicts`) tanpa I/O; fakta subjek di-resolve `business-scope-facts.ts`. Matcher mendukung `same_scope_only` **hierarchy-aware** (fakta di ancestor/descendant scope yang telah di-resolve dihitung match), fakta `null`-scope (grant RBAC biasa) match di **setiap** scope, dan `same_scope_only` tanpa `requestedScope` → **INDETERMINATE** (default-deny, bukan diam-diam "tidak konflik").
4. **Dua sumber fakta.** Subjek bisa memegang permission konflik lewat assignment business-scope **ATAU** grant RBAC biasa (`awcms_access_assignments`). `resolveSoDAssignmentFacts` menggabung keduanya — kalau tidak, cek buta terhadap kasus paling umum (satu role memegang kedua sisi konflik, mis. owner setup-wizard).
5. **Enforcement DUA titik.** **Assignment-time**: `createBusinessScopeAssignment` menolak (`sod_conflict`) grant yang melengkapi konflik tak-ter-exception. **Action-time (fail-closed)**: `high-risk-sod-guard.ts` di-wire ke `authorizeInTransaction` untuk **setiap** aksi high-risk — deny-overrides-allow (hanya bisa menambah deny atas keputusan ABAC yang sudah allow). Konflik diperiksa saat **eksekusi**, bukan hanya saat assignment.
6. **Creator ≠ approver kecuali override tersanksi.** Guard self-approval workflow existing (`evaluateAccess`, #147) tetap; SoD menambah pemisahan pembuat/penyetuju lewat rule generik. Satu-satunya jalan seorang creator boleh melewati konflik pada resource yang sama adalah **exception yang sah**.
7. **Exception = administrative override yang di-sanksi.** Tabel `awcms_sod_conflict_exceptions` (tenant-scoped, RLS `ENABLE`+`FORCE`). Exception **scope-bound** (blanket vs scope-spesifik), **time-bound** (`effective_to` NOT NULL — no indefinite override), **dapat dicabut**, dan **diaudit** `critical`. **Tidak boleh self-approved**: approve butuh permission `business_scope_exceptions.approve` (khusus, berbeda dari `.create`) **dan** approver ≠ requester **dan** approver ≠ subject/beneficiary (keduanya dicek-ulang dari baris DB, tak pernah dipercaya dari body). Kedua sumbu independensi wajib: route create menerima `subjectTenantUserId` sembarang (requester boleh mengajukan atas nama subjek lain), sehingga tanpa cek approver ≠ subject seorang beneficiary yang kebetulan memegang `.approve` bisa menyetujui bypass-nya sendiri (temuan review adversarial #181). Rule bisa melarang exception (`allowed: false`) — mis. maker/checker atas mekanisme override itu sendiri.
8. **Expired/revoked SEGERA tidak berlaku.** `isSoDConflictExceptionCurrentlyValid(row, now, scope)` adalah gerbang otoritatif (status hanya cache; `effective_to` vs `now` yang nyata). Job terjadwal (`identity-access:business-scope:expiry`, pass baru di sql/029 worker grant) hanya membalik `status` sebagai housekeeping.
9. **Decision log append-only.** `awcms_sod_conflict_evaluations` (RLS FORCE) merekam **setiap** cek konflik (assignment_create + high_risk_decision) apa pun hasilnya — proyeksi aman (rule key, subject, trigger, outcome, reason, timestamp; tanpa payload request/resource). Route preview `GET /conflicts` keyset-paginated.
10. **Isolasi tenant DUA lapis.** FK subject/requester/approver adalah **komposit `(tenant_id, …)`** ke `UNIQUE (tenant_id, id)` (RI check PostgreSQL melewati RLS — GHSA-r7cx-c4jh-cvvw), + RLS FORCE. Exception tenant A **tidak** bisa dipakai tenant B — dibuktikan di bawah role non-superuser `awcms_app`.
11. **Evaluasi bounded, non-N+1.** Fakta di-resolve dalam jumlah SELECT tetap (dua per cek: business-scope + RBAC), exception lookup batch satu query untuk banyak rule key, deteksi in-memory ter-index. Jumlah query **tidak** tumbuh dengan banyaknya permission/assignment subjek — dibuktikan test query-count (subjek kecil == besar).
12. **Invalidasi cache = tanpa cache.** Fakta konflik/exception di-resolve fresh per keputusan (bukan di-cache di memori), jadi perubahan assignment/rule/exception/hierarchy langsung tercermin di keputusan berikutnya.

## Batas scope (yang SENGAJA tidak diport)

- **Tidak ada rule domain di base.** Base hanya mengirim mekanisme; rule finance/procurement/payroll/inventory hidup di aplikasi turunan.
- **Tidak ada expression/SQL arbitrary dari tenant.** Rule adalah data statis kode-only, bukan ekspresi yang dievaluasi runtime.
- **Bukan pengganti RBAC/ABAC.** SoD adalah lapis pembatas tambahan (deny-overrides), bukan grant.
- **Admin UI.** Belum ada UI di base; hanya API. UI registry/preview/exception adalah pekerjaan aplikasi turunan / issue lanjutan.

## Konsekuensi

- Dua tabel baru RLS `ENABLE`+`FORCE` (`sql/029`) + seed permission (`sql/030`); grant worker diperluas satu tabel (`awcms_sod_conflict_exceptions`) di `scripts/security-readiness.ts` `WORKER_ROLE_GRANTS`.
- `MODULE_CONTRACT_VERSION` naik 1.2.0 → 1.3.0 (aditif: `sodRules` + tipe `SoDRule*`).
- `authorizeInTransaction` mendapat opsi opsional `sodRules` (default = registry ter-compose); action `reject` ditambah ke union `AccessAction` (bukan high-risk — menolak exception adalah outcome aman).
- Enam operasi OpenAPI baru di fragment `identity-access` (`conflicts` + `exceptions/*`), bundle + docs di-regenerate; tidak ada event domain (tak ada perubahan AsyncAPI).
- Enforcement mulai menggigit di tenant yang komposisi role-nya **sudah** memegang kedua sisi konflik saat rule turunan aktif — perilaku yang benar, bukan regresi.

## Threat model ringkas

- **Privilege accumulation** — satu subjek mengumpulkan kedua sisi konflik lintas waktu/role: terdeteksi lewat gabungan fakta (assignment + RBAC), ditolak assignment-time + action-time.
- **Collusion** — pembuat & penyetuju bersekongkol: dibatasi maker/checker (permission approve khusus, approver ≠ requester), override wajib exception yang di-audit `critical`.
- **Stale exception** — override kadaluarsa/dicabut masih dipakai: gerbang `effective_to` vs `now` (status hanya cache) membuat expired/revoked segera tak berlaku.
- **Self-approval** — requester ATAU subject/beneficiary menyetujui exception yang menguntungkan dirinya sendiri: ditolak pada kedua sumbu (approver ≠ requester DAN approver ≠ subject; dicek-ulang dari baris DB, bukan body).
- **Cross-tenant exception** — exception tenant A dipakai tenant B: FK komposit + RLS FORCE, dibuktikan di bawah `awcms_app`.
