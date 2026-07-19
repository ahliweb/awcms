# ADR-0033 — Dynamic ABAC policy evaluator (DSL, precedence, cache)

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** maintainer
- **Terkait:** Issue #179, epic #177 (kesiapan fondasi ERP turunan, Wave 2 authorization); ADR-0030 (business-scope hierarchy #180) & ADR-0031 (SoD #181) — guard yang tetap berjalan di sisi ABAC ini; ADR-0026 (modular OpenAPI #182); `src/modules/identity-access/domain/abac-policy.ts`, `abac-evaluator.ts`; `docs/awcms/20_threat_model_security_architecture.md`; port dari awcms-mini Issue #179 (ADR-0023, diadaptasi bukan disalin).

## Konteks

AWCMS menetapkan RBAC + ABAC default-deny, tetapi sampai Issue #179 `evaluateAccess()` belum pernah **mengonsumsi** baris `awcms_abac_policies` yang tersimpan — otorisasi hanya bergantung pada permission peran dan guard bawaan (tenant isolation, self-approval, force-decision, business-scope #180, SoD #181). AWCMS sudah punya CRUD flat `awcms_abac_policies` (Issue #171: `effect`/`is_active`/`description` di `/api/v1/abac/policies`) yang belum pernah dibaca evaluator. Untuk ERP, kebijakan perlu mengevaluasi atribut subject, resource, action, environment, kepemilikan, status transaksi, unit organisasi, dan batas nilai secara konsisten di satu chokepoint — tanpa membuka pintu bagi ekspresi arbitrer (`eval`, SQL bertemplat) yang berbahaya.

## Keputusan

### 1. DSL kondisi: AST jsonb yang terbatas, deterministik, versioned

Kondisi kebijakan disimpan sebagai AST jsonb (`conditions`) dengan `dsl_version` (mulai 1), plus kolom applicability nullable (`module_key`/`activity_code`/`action`/`resource_type` = wildcard bila null) dan `priority` — ditambahkan `sql/031` sebagai ALTER additif atas tabel `awcms_abac_policies` (sql/005). Sebuah **node** adalah salah satu dari:

- `{ "allOf": [node, ...] }` — semua benar (kosong = vacuously true)
- `{ "anyOf": [node, ...] }` — salah satu benar (kosong = vacuously false)
- `{ "not": node }`
- **Leaf:** `{ "attr": "<ns.attr>", "op": "<op>", "value": <literal> }` **atau** `{ "attr": "<ns.attr>", "op": "<op>", "valueAttr": "<ns.attr>" }` (attr-ke-attr untuk cek kepemilikan, mis. `resource.ownerTenantUserId eq subject.tenantUserId`)

**Attribute allow-list** (di-resolve SERVER-SIDE — daftar tetap, di luar daftar = invalid/deny):

- `subject.*` (`tenantUserId`, `identityId`, `roles`, `defaultOfficeId`) — dari `TenantContext` terautentikasi, **tidak pernah** dari body request. `defaultOfficeId` opsional dan belum di-resolve base (selalu absen sampai deployment memasangnya).
- `resource.*` (`tenantId`, `ownerTenantUserId`, `businessScopeId`, `status`, `resourceType`, `amount`) — dari `request.resourceAttributes` yang **wajib** diisi endpoint dari resource yang sudah diverifikasi/dipersist (kepemilikan dicek terhadap baris nyata, bukan klaim klien).
- `action` — action request.
- `env.*` (`now`, `dayOfWeek`, `ipTrusted`) — **hanya** server-derived; `ipTrusted` default `false` (fail-closed) sampai deployment memasang resolver jaringan tepercaya.

**Operator:** `eq`, `ne`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`, `exists`. `lt/lte/gt/gte` hanya untuk atribut numeric/date. Tidak ada regex, fungsi, atau ekspresi arbitrer. Nilai hanya literal (string/number/boolean/ISO-date, atau array untuk `in/nin`). Evaluator adalah **interpreter murni** atas AST — tanpa `eval`, `new Function`, dynamic import, atau SQL bertemplat.

Parser/validator (`abac-policy.ts`) fail-closed: attribute tak dikenal, operator tak dikenal, tipe nilai salah, arity operand salah, versi DSL lebih baru dari yang didukung, atau cacat struktural apa pun → kebijakan **invalid** saat authoring (ditolak endpoint CRUD) sehingga tak pernah bisa diaktifkan.

Keanggotaan allow-list diuji **own-property saja** (`Object.prototype.hasOwnProperty.call`, via `lookupAbacAttribute`/`isKnownAbacAttribute`), bukan `ABAC_ATTRIBUTES[attr]`/`attr in …` yang menelusuri prototype chain. Tanpa ini, key prototype (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, …) akan me-resolve anggota warisan dan **lolos** cek attribute-tak-dikenal — sebuah lubang fail-OPEN: sebuah `deny` beratribut prototype akan diam-diam dilewati, atau `not(exists)` atasnya menjadi allow yang selalu-terpenuhi. Gerbang own-property berlaku di kedua sisi: validator authoring **dan** backstop eval-time (`abac-evaluator.ts` `lookup()`, yang juga men-gate bag hasil `buildAttributeBag` dengan `hasOwnProperty`), sehingga bahkan kondisi tersimpan yang dibuat-tangan tetap fail-closed (throw → DENY). Diuji: +17 test prototype-key (validator + eval-time), mutation-proven merah tanpa gerbang.

### 2. Precedence: fail-closed, deny-overrides, allow-as-constraint, RBAC tetap wajib

Setelah semua guard bawaan (tenant isolation, self-approval, force-decision, business-scope #180) yang tetap berjalan lebih dulu dan tak dilemahkan, atas himpunan kebijakan **aktif** yang **applicability**-nya cocok (`module_key`/`activity_code`/`action`/`resource_type`, masing-masing nullable = wildcard), di dalam `evaluateAccess` (murni):

1. **DENY eksplisit menang.** Bila ada kebijakan `deny` applicable yang kondisinya terpenuhi → **DENY** (mengalahkan RBAC allow dan kebijakan allow). Kebijakan aktif yang **invalid** (gagal compile / `dsl_version` terlalu baru) atau **error evaluasi apa pun** (attribute/operator tak dikenal) → **DENY** (fail-closed). Bagian ini dievaluasi **sebelum** cek RBAC.
2. **Permission RBAC tetap wajib.** Bila subject tak memiliki permission `module.activity.action` → **DENY** (`default_deny`). Kebijakan `allow` **tidak pernah** menciptakan permission yang tidak dimiliki subject.
3. **Kebijakan `allow` sebagai CONSTRAINT.** Bila ada kebijakan `allow` applicable, minimal satu kondisinya harus terpenuhi, jika tidak → **DENY** (`abac_allow_unsatisfied`). Bila tak ada kebijakan applicable sama sekali → ABAC no-op, RBAC yang memutuskan.

`evaluateAccess` memperoleh **param opsional ke-5** `abac?: { policies, env }` (`businessScopeFacts` tetap param ke-4). Bila absen/kosong → ABAC no-op; **semua call site lama ≤4 argumen tak terpengaruh** (backward-compatible). Model ini membuat kebijakan `allow` hanya bisa **mempersempit** akses yang sudah diberikan RBAC, tak pernah memperluas — memenuhi acceptance "policy tidak dapat menciptakan permission yang tidak dimiliki subject". Atribut yang **sah-tapi-absen** membuat leaf-nya `false` secara deterministik — itu **bukan** error dan bukan fail-closed-deny; fail-closed hanya untuk attribute/operator tak dikenal dan error evaluasi.

Enforcement SoD high-risk (#181) tetap di chokepoint aplikasi (`authorizeInTransaction`), additif **setelah** keputusan ini (deny-overrides). RLS tetap wajib sebagai pertahanan berlapis; ABAC tidak menggantikannya.

### 3. Dua permukaan authoring, satu tabel, satu evaluator

- **Permukaan DSL (`/api/v1/access/policies*`, #179)** — CRUD penuh atas AST/applicability/priority + simulasi, guard `identity_access.abac_policies.{read,configure,analyze}` (di-seed `sql/032`). Ini permukaan lengkap.
- **Permukaan flat (`/api/v1/abac/policies*`, #171)** — hanya `effect`/`description`/`is_active`, guard `identity_access.access_control.{read,configure}`. Dipertahankan untuk back-compat admin UI #171. Karena keduanya menulis tabel yang sama yang kini dibaca evaluator, permukaan flat **juga** memanggil `invalidatePolicyCache` setelah commit — jika tidak, mengubah kebijakan lewat #171 tak akan berefek (bypass evaluator).

**Footgun terdokumentasi:** kebijakan yang di-author lewat permukaan flat memakai default migrasi — applicability wildcard (empat kolom NULL) + kondisi vacuously-true. Sebuah `deny` flat yang diaktifkan karena itu **men-deny SETIAP request** tenant tsb; untuk membatasi lingkup, gunakan permukaan DSL.

### 4. Cache per-tenant dengan invalidasi deterministik

Kebijakan aktif dikompilasi sekali per tenant dan disimpan di cache in-process yang **tenant-keyed** (`application/policy-cache.ts`). Setiap mutasi kebijakan (create/update/enable/disable, dari **kedua** permukaan) memanggil `invalidatePolicyCache(tenantId)` yang menaikkan versi per-tenant dan menghapus entry; endpoint memanggilnya **setelah** transaksi commit sehingga request berikutnya tak pernah men-cache snapshot pra-commit (jebakan TOCTOU). Load selalu di dalam `withTenant` (RLS + peran `awcms_app` non-superuser, FORCE RLS), sehingga tak pernah membaca lintas tenant. Tanpa restart. **Batasan:** invalidasi bersifat per-PROSES; deployment yang di-scale horizontal butuh sinyal lintas-instance tambahan (LISTEN/NOTIFY atau TTL pendek) — dicatat sebagai batasan, bukan diasumsikan hilang.

### 5. Decision log & simulasi

Setiap keputusan mencatat `decision`, `reason`, `matched_policy` (kode), dan `matched_policy_version` (`sql/031`) ke `awcms_abac_decision_logs` — tanpa PII/identifier sensitif mentah (hanya kode kebijakan, versi, dan reason statis). Endpoint simulasi read-only diaudit lewat `awcms_audit_events` (bukan decision log) karena keputusannya hipotetis.

**Simulasi & subjek asing.** Mensimulasikan himpunan **role hipotetis** adalah kapabilitas `analyze` murni. Namun mensimulasikan **tenant user yang sudah ada dan berbeda** (`subject.tenantUserId` selain milik pemanggil) me-resolve role/grant **nyata** user itu — sebuah oracle enumerasi horizontal bagi principal `analyze`-saja. Karena itu jalur subjek-asing **juga** mensyaratkan `identity_access.access_control.read` (di AWCMS **tidak ada** modul `user_management`; membaca record user diguard oleh `access_control.read` — lihat `src/pages/api/v1/users/index.ts`); tanpanya subjek asing ditolak `403`. Id subjek yang di-probe direkam di audit (`simulatedSubjectTenantUserId`) agar dapat diatribusikan (bukan enumerasi diam-diam). Trace per-policy tetap hanya boolean struktural — tak pernah mengembalikan VALUE atribut ter-resolve.

## Konsekuensi

- **Positif:** kebijakan beratribut (kepemilikan, batas nilai, status, environment) dinyatakan sebagai data tersimpan, auditable, dan berlaku di satu chokepoint tanpa deploy ulang; permukaan serang minimal (interpreter murni, allow-list tertutup, fail-closed).
- **Trade-off:** setiap request terguard membaca kebijakan aktif (di-cache); authoring menambah permukaan admin (`identity_access.abac_policies.*`); dua permukaan authoring hidup berdampingan (flat #171 + DSL #179), keduanya menginvalidasi cache.
- **Netral:** base tidak menyertakan kebijakan domain apa pun — lima contoh ERP hidup di `fixtures/abac-example-policies.json`, di-author aplikasi turunan lewat API.

## Alternatif yang dipertimbangkan

- **Ekspresi arbitrer / CEL / mini-language dengan fungsi** — ditolak: permukaan serang dan non-determinisme; AST terbatas cukup untuk kebutuhan ERP.
- **Allow-policy sebagai pemberi permission (ABAC-primary)** — ditolak: melanggar "permission peran tetap wajib"; dipilih model allow-as-constraint + deny-overrides.
- **Tanpa cache (baca tiap request)** — ditolak: biaya per-request; cache tenant-keyed dengan invalidasi deterministik memberi konsistensi tanpa restart.
- **Mengganti CRUD flat #171 dengan DSL (satu permukaan)** — ditolak untuk atomicity: akan menyentuh admin UI #171 + test-nya; dipilih pertahankan flat + tambah DSL, dengan cache-invalidation di kedua permukaan.
