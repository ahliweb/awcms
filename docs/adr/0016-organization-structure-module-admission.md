# ADR-0016 — Admission of `organization_structure` as an Official Optional Business Foundation module

- **Status:** Accepted
- **Tanggal:** 2026-07-14
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #749 (epic #738 `platform-evolution`, Wave 2), Issue #739 / ADR-0013 (extension layers, tenant vs legal entity vs organization unit vocabulary), Issue #746 (business-scope assignments + `BusinessScopeHierarchyPort`, PR #776), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

## Konteks

ADR-0013 §1 sudah mem-pre-klasifikasikan `organization_structure` sebagai kandidat **Official Optional Business Foundation** (lapisan 3) untuk Wave 2 epic #738, dan §2 sudah mendefinisikan batas konsep tenant vs legal entity vs organization unit secara mengikat. Issue #749 sendiri secara eksplisit mensyaratkan sebagai acceptance criterion pertama: "Admission decision and ADR classify the module and dependencies before implementation" — ADR ini memenuhi syarat itu dengan mengisi `docs/awcms/templates/module-proposal-template.md` inline dan mengonfirmasi kategori/dependency/lifecycle/offline-compatibility/owner sebelum baris kode pertama modul ditulis, mengikuti pohon keputusan admission `docs/awcms/21_module_admission_governance.md` §3.

Berbeda dari #742 (`domain_event_runtime`) dan #743 (`data_lifecycle`) yang keduanya **tidak** menulis ADR/update doc 21 §8 terpisah (mengandalkan pre-klasifikasi ADR-0013 sebagai cukup) — issue #749 secara eksplisit meminta admission decision/ADR sendiri sebagai acceptance criterion, jadi preseden itu **tidak** diikuti di sini secara sengaja.

## Keputusan

Kami memutuskan untuk mengadmisi `organization_structure` sebagai modul baru di registry base ini dengan parameter berikut (mengisi format `module-proposal-template.md` inline):

### 1. Nama & key modul

- Nama: **Organization Structure**
- `key`: `organization_structure`
- Kategori: **Official Optional Module** (= lapisan ADR-0013 "Official Optional Business Foundation")

### 2. Masalah/kebutuhan

Banyak aplikasi turunan (retail multi-cabang, layanan publik multi-unit, portal pendidikan dengan struktur fakultas/departemen) butuh primitif organisasi generik — legal entity, departemen/cabang/cost-center/gudang/program unit, hierarki efektif-tanggal, lokasi operasional, dan penugasan pihak/user ke unit — tanpa membangun ulang ini di setiap repo turunan, dan tanpa melemahkan batas isolasi tenant (ADR-0013 §2). Ini untuk **sebagian besar** aplikasi turunan yang punya struktur organisasi internal (bukan hanya satu vertikal), tapi tetap **opt-in per tenant** (tidak setiap tenant butuh legal entity/hierarki — banyak tenant kecil beroperasi datar).

### 3. Mengapa ini bukan modul Derived Application

Lolos pohon keputusan §3 doc 21, node Q3 ("generik untuk SEMUA aplikasi turunan"): legal entity/organization unit/hierarki/lokasi operasional/penugasan adalah primitif struktural yang berlaku sama untuk retail, layanan publik, pendidikan, kesehatan, dst. — bukan logika spesifik satu vertikal (tidak ada chart of accounts, valuasi inventory, payroll, atau aturan pemerintah spesifik di sini, lihat §Out of scope). Preseden sama seperti `blog_content`/`news_portal`/`social_publishing` (konten editorial generik lintas vertikal) — modul ini adalah "struktur organisasi generik lintas vertikal", bukan ERP.

### 4. Dependency

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, wajib aktif duluan): `["tenant_admin", "identity_access", "domain_event_runtime"]`. `tenant_admin` untuk `awcms_tenants` (batas tenant), `identity_access` untuk `awcms_tenant_users` (subjek assignment direferensikan lewat FK biasa ke tabel ini, mirip pola `business-scope-assignment-service.ts`'s `tenantUserId` check), `domain_event_runtime` karena modul ini adalah REAL producer (`appendDomainEvent`, mengimpor konstanta event type dari `domain-event-runtime/domain/event-type-registry.ts`) — persis pola `workflow_approval` (Issue #747), bukan pola `profile_identity` (Issue #748, Core, sengaja TIDAK mengimpor konstanta lintas-modul karena Core tidak boleh depend ke System). Optional (`organization_structure`) depend ke System (`domain_event_runtime`) adalah arah DAG yang diizinkan (ADR-0013 §1: Opt → Sys).
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `organization_structure` **PROVIDES** `organization_hierarchy_resolution` — sebuah implementasi nyata `BusinessScopeHierarchyPort` (`_shared/ports/business-scope-hierarchy-port.ts`) untuk `scopeType` "legal_entity"/"organization_unit". Modul ini **TIDAK** mendaftarkan `capabilities.consumes` apa pun dari `identity_access`, dan yang lebih penting — `identity_access` **TIDAK** mendaftarkan `organization_structure` sebagai lifecycle atau capability dependency apa pun ke arah sebaliknya (Core tidak pernah depend ke Optional, ADR-0013 §1). Pemilihan adapter (`defaultBusinessScopeHierarchyPortAdapter` identity-access yang flat vs `organizationStructureHierarchyPortAdapter` yang nyata) dilakukan oleh **composition root** (route handler / job script yang butuh resolusi scope) saat runtime — persis pola yang didokumentasikan header `business-scope-hierarchy-port.ts` dan `business-scope-hierarchy-port-adapter.ts` sendiri untuk kasus "office" hari ini.

### 5. Kompatibilitas offline/LAN vs full-online-only

- Kelas kompatibilitas: **offline-lan-safe**. Tidak ada provider eksternal apa pun yang dilibatkan — seluruh CRUD/hierarki/lokasi/assignment adalah operasi database murni, koordinat lat/lng divalidasi secara lokal (bukan dipanggil ke geocoding provider), dan import seed hook (lewat kontrak data-exchange masa depan, #750/#752) bersifat opsional, bukan hard dependency runtime.
- Modul ini berfungsi 100% di profil `offline-lan` tanpa konektivitas internet sama sekali.

### 6. Provider eksternal

Tidak ada. Tidak ada kategori External Integration di dalam modul ini.

### 7. Security & data governance

- Data yang disentuh: nama/identifier legal entity (identifier generik, BUKAN field spesifik pemerintah seperti NPWP/SIUP — lihat §Out of scope), nama unit organisasi, alamat/koordinat lokasi operasional (PII rendah — alamat kantor/cabang, bukan data pribadi individu), referensi `tenant_user_id` untuk assignment (bukan data profil baru — mereferensikan `identity_access`'s tabel yang sudah ada).
- ABAC: default-deny, permission key baru per resource (`organization_structure.legal_entities.*`, `.unit_types.*`, `.units.*`, `.hierarchy.*`, `.locations.*`, `.location_unit_relationships.*`, `.assignments.*`) — lihat migration permission seed.
- High-risk action yang wajib audit log: reparent hierarki (+ `Idempotency-Key`), deaktivasi legal entity, akhiri assignment, hapus (soft-delete) unit/lokasi.
- Tenant dan legal entity/organization unit tetap konsep berbeda (ADR-0013 §2) — RLS predicate SETIAP tabel baru modul ini selalu dan hanya `tenant_id`, tidak pernah `legal_entity_id`/`organization_unit_id` sebagai predicate kedua.

### 8. Ownership

`@ahliweb` (mengikuti `.github/CODEOWNERS`, sama seperti seluruh modul lain — `ModuleDescriptor.maintainers` belum diisi modul manapun per doc 21 §8 R3, tidak diubah di sini).

### 9. Rencana deprecation

Tidak relevan — modul baru, tidak menggantikan modul/fitur lain yang ada.

### 10. Alternatif yang dipertimbangkan

- **Menambahkan `legal_entity_id`/`organization_unit_id` langsung ke `awcms_offices`/`tenant_admin`** — ditolak: melanggar ADR-0013 §2 secara langsung (legal entity/organization unit BUKAN konsep Core, dan `tenant_admin` tidak boleh punya dependency ke modul Optional manapun, ADR-0012 §4.1). Sebagai gantinya, `organization_structure` boleh (opsional) mereferensikan `awcms_offices` lewat `office_id` sebagai FK biasa di masa depan (tidak diimplementasikan di issue ini — di luar scope), bukan sebaliknya.
- **Menjadikan `organization_structure` modul System, bukan Official Optional Module** — ditolak: ini adalah fitur produk bernilai bisnis langsung (opt-in per tenant, dinonaktifkan tanpa merusak Core/System manapun), bukan infrastruktur reusable murni seperti `logging`/`sync_storage` (doc 21 §2 definisi System vs Official Optional Module) — persis kriteria yang sama yang menempatkan `blog_content`/`news_portal`/`social_publishing` di kategori ini.
- **`organization_structure` men-declare `identity_access` sebagai capability consumer dari port yang modul ini sendiri sediakan** — tidak relevan/tidak masuk akal: port `BusinessScopeHierarchyPort` didefinisikan di `_shared` dan modul ini hanya PROVIDES sebuah implementasi tambahan untuknya; tidak ada arah dependency capability dari `organization_structure` ke `identity_access` untuk hal ini.
- **Menjadikan "location" sebuah `scopeType` yang diekspos lewat `BusinessScopeHierarchyPort`** — ditolak untuk versi ini: port ini tentang otorisasi/hierarki bisnis (legal entity/organization unit), bukan lookup lokasi fisik; `location` tetap murni internal `organization_structure` (diakses lewat endpoint modul ini sendiri, bukan lewat port ini) sampai ada kebutuhan konkret authorization berbasis lokasi.

## Konsekuensi

- **Positif:** Aplikasi turunan (AWPOS multi-cabang, Smart School Portal dengan struktur fakultas, dst.) mendapat primitif organisasi reusable tanpa membangun ulang legal entity/hierarki/lokasi/assignment masing-masing, dan `identity_access` mendapat implementasi hierarki nyata (bukan hanya flat "office") untuk `BusinessScopeHierarchyPort` tanpa Core pernah bergantung pada modul Optional ini.
- **Positif:** Batas tenant vs legal entity/organization unit ADR-0013 §2 sekarang punya implementasi konkret pertama yang membuktikan aturan itu bisa ditegakkan (RLS tetap hanya `tenant_id`, `legal_entity_id`/`organization_unit_id` selalu FK biasa yang divalidasi ulang di application layer).
- **Negatif/trade-off:** Modul ke-17 di registry menambah permukaan yang harus lolos `modules:dag:check`/`modules:compose:check` setiap kali registry berubah — mitigasi: dependency dideklarasikan minimal (`tenant_admin`, `identity_access` saja), tidak ada capability `consumes` yang bisa menciptakan cycle.
- **Netral:** `docs/awcms/21_module_admission_governance.md` §8 diperbarui menambah baris ke-17 (lihat PR ini) — dari "3 Core + 9 System + 3 Official Optional Module = 15 dari 16 modul" menjadi "3 Core + 9 System + 4 Official Optional Module = 16 dari 17 modul terdaftar".

## Alternatif yang dipertimbangkan

Lihat §10 di atas (digabung ke dalam format proposal template inline, bukan diulang di sini).
