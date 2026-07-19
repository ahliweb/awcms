# ADR-0032 — Compatibility manifest keluarga AWCMS dan CI conformance terhadap standar AWCMS-Mini

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** maintainer
- **Terkait:** Issue #183, epic #177 (kesiapan fondasi ERP turunan, Wave 1); ADR-0001 (rebuild di atas fondasi awcms-mini); ADR-0008 (versioning kontrak independen); ADR-0015 (compatibility manifest aplikasi turunan — pola yang di-mirror ke arah hulu); ADR-0025 (module composition #178); ADR-0026 (modular OpenAPI #182); ADR-0023 (dokumentasi dwibahasa); ADR-0027/0028/0029/0030/0031 (sumber intentional divergence)

## Konteks

AWCMS mengadopsi standar teknis AWCMS-Mini (ADR-0001), tetapi sinkronisasinya bergantung pada port manual, dokumentasi, dan review manusia. Pola itu berulang kali menghasilkan drift pada migration reference, skill agent, modul, CI gate, dan dokumentasi — dan tidak ada satu artefak pun yang bisa dibaca mesin untuk membedakan:

- bagian yang **wajib kompatibel secara semantik** dengan standar (default-deny, RLS, redaction, audit, idempotency, envelope, migration immutability);
- bagian yang **sengaja berbeda** karena scope AWCMS adalah fondasi kesiapan ERP, bukan produk CMS (mis. SSRF guard membalik keputusan mini, MFA session-assurance dibangun baru, modul konten tidak diport);
- **versi stack** yang telah diuji bersama (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL);
- **bukti conformance** yang dapat diaudit.

ADR-0015 (Issue #741, diadaptasi dari mini) sudah membangun manifest kompatibilitas ke arah **hilir** — bagaimana aplikasi turunan menyatakan kompatibilitasnya terhadap rilis base. ADR ini membangun lapisan yang saling melengkapi ke arah **hulu**: bagaimana base AWCMS menyatakan conformance-nya terhadap standar keluarga AWCMS, ditegakkan CI.

## Keputusan

### 1. Manifest machine-readable versioned + schema

`awcms-family-compatibility.yaml` (root repo) adalah sumber deklaratif tunggal. Divalidasi oleh `validateFamilyManifestShape()` di `src/modules/_shared/family-contract.ts` (validator otoritatif, zero-import — sama disiplin dengan `module-contract.ts`) DAN dipublikasikan sebagai JSON Schema draft-07 `awcms-family-compatibility.schema.json` untuk tooling eksternal. Kedua sisi dijaga tidak drift: gate memverifikasi daftar `required` skema JSON sama dengan `REQUIRED_TOP_LEVEL_KEYS` validator.

### 2. Family contract version — skema versioning KETUJUH

`FAMILY_CONTRACT_VERSION` (`family-contract.ts`, `"1.0.0"`) adalah skema versioning ketujuh di atas enam yang sudah didokumentasikan ADR-0008/ADR-0015 (package release, kontrak REST, kontrak event, module descriptor, per-capability, extension-manifest). Ia adalah versi yang setiap fixture/snapshot conformance dipin. Setiap contract versi yang dideklarasikan manifest WAJIB salah satu dari:

- **cocok dengan konstanta sumber nyata** — `MODULE_CONTRACT_VERSION`, `CAPABILITY_CONTRACT_VERSIONS`, `info.version` OpenAPI/AsyncAPI (gate membaca sumber dan gagal saat mismatch); atau
- **family-owned** — dipin ke `FAMILY_OWNED_CONTRACT_VERSIONS` (`family-contract.ts`) dan diberi gigi oleh contract test SEMANTIK yang berubah RED bila kontrolnya drift (envelope, tenant-context/RLS, audit/redaction, idempotency, migration checksum).

Tidak ada nomor versi mengambang tanpa sumber kebenaran.

### 3. Gate `family:conformance:check` — wiring di tiga tempat (pelajaran PR #769/#770)

`scripts/family-conformance-check.ts` — pure (tanpa DB/network), aman di setiap build. Cross-reference manifest terhadap sumber nyata, memvalidasi allow-list intentional divergence (well-formed, tidak kedaluwarsa, ADR ada), dan meng-emit evidence report pass/fail per contract (tanpa secret/DSN — di-assert `assertEvidenceReportSecretFree`). Fungsi keputusan murni `collectFamilyConformanceChecks(manifest, actuals)` menerima `actuals` yang di-inject supaya contract test bisa memutasi satu fakta dan membuktikan gate RED (pola injeksi `checkRuntimeRoleGrants(policy?)`).

Sesuai ADR-0015 §6: ditambahkan ke (1) `package.json`'s `check`, (2) langkah bernama eksplisit di `.github/workflows/ci.yml`'s `quality` job (bukan diasumsikan otomatis), dan (3) `release.yml` mewarisi via `bun run check` verbatim. Parity dijaga `tests/family-conformance-ci-parity.test.ts` agar langkah tak bisa hilang diam-diam dari CI atau `bun run check`.

### 4. Contract test SEMANTIK, bukan byte-equality

Setiap kontrol reusable kritis dipin ke perilaku, dan tiap test MUTATION-PROVABLE (berubah RED bila kontrol dilemahkan): module descriptor/composition (duplicate module key → invalid), tenant-context fail-closed di bawah `FORCE RLS` (tanpa GUC → nol baris; policy fail-open → bocor semua baris), response envelope, audit/redaction (redactor dilemahkan → kebocoran terdeteksi), idempotency (hash collapse → konflik tak terdeteksi), migration immutability/checksum (edit migration terapan → `validateAppliedChecksums` throw — murni, tanpa DB), OpenAPI/AsyncAPI metadata, database role/RLS (`checkRlsEnabled` FORCE invariant). Bagian yang butuh Postgres nyata (`tests/family-conformance-db.test.ts`) di-gate `DATABASE_URL` dan masuk daftar eksplisit suite ad-hoc DB di ci.yml + release.yml (dua-suite-DB tak boleh tabrakan dalam satu proses `bun test`).

Setiap pelemahan default-deny/RLS/redaction/audit/idempotency dianggap **breaking** (MAJOR family contract) dan membuat conformance gagal.

Kontrak **Astro SSR build/start on Bun** TIDAK punya test standalone di suite conformance (build+start+probe duplikat hanya akan menjalankan ulang job `e2e-smoke`). Ia dieksekusi nyata oleh `bun run build` (di dalam `bun run check`) DAN job `e2e-smoke` yang men-start server hasil-build di Bun (`bun ./dist/server/entry.mjs`) lalu menjalankan login/SSR render. `tests/family-conformance-ci-parity.test.ts` meng-assert job `e2e-smoke` + baris start itu ADA di ci.yml — jadi menghapusnya memerahkan conformance.

### 5. Compatibility matrix: current DAN minimum-supported dijalankan nyata

Job `quality` mem-pin Bun current (1.3.14); job terpisah `minimum-supported` men-setup dan MENJALANKAN floor `engines.bun >=1.3.0` (Bun 1.3.0) untuk subset bermakna: `bun install --frozen-lockfile`, `typecheck`, `build` (Astro SSR), `family:conformance:check`. Diverifikasi nyata: Bun 1.3.0 menjalankan subset itu bersih. Gate sendiri meng-assert himpunan versi Bun di CI = TEPAT {current, minimum} (`stack.bun.ci` + `stack.bun.ciMinimum`, dan `ciMinimum` == floor `engines`), sehingga menghapus job minimum-supported memerahkan gate. Astro/@astrojs/node/TypeScript "minimum" == range caret current-nya (`^7.0.7`/`^11.0.2`/`^7.0.2`), jadi tak butuh cell terpisah; PostgreSQL hanya mendeklarasikan 18.4 (tanpa floor terpisah), jadi tak ada gap PG minimum.

### 6. Intentional divergence butuh alasan + owner + review date + ADR

Allow-list `intentionalDivergences` mendaftar setiap perbedaan sengaja dari standar mini. Bukan backlog port yang belum selesai — tiap entri punya `reason`, `owner`, `reviewDate` (gate gagal saat kedaluwarsa — divergence tak-ter-review tak bisa hidup selamanya), dan `adr` (file yang harus ada). Divergence awal: modul konten tak diport (ADR-0022), ModuleType tanpa "derived" (ADR-0025), OpenAPI satu-file-per-modul (ADR-0026), SSRF blokir IP privat (ADR-0028), MFA session-assurance baru (ADR-0027), business-scope resolver base NO-OP (ADR-0030), SoD rule ilustratif di fixture (ADR-0031), Turnstile pertahankan gate profil (ADR-0029), SemVer lanjut lini major legacy (ADR-0024).

### 7. Tanpa dependency live ke upstream mini

CI tidak pernah mengunduh branch mini. Semua conformance dibuktikan terhadap konstanta sumber lokal + fixture yang dipin; build reproducible walau GitHub eksternal tak tersedia (ADR-0015 §5 prinsip yang sama).

## Konsekuensi

- **Positif:** perubahan fondasi terhadap standar keluarga jadi eksplisit, dapat diuji, dan tidak bergantung perbandingan copy file. Manifest tervalidasi schema; drift versi/divergence memerahkan CI.
- **Positif:** contract test semantik menangkap pelemahan nyata (bukan cuma perubahan sumber), dibuktikan mutasi (fail-open RLS, redaction bypass, envelope drift, duplicate module key, edit migration terapan).
- **Positif (F1):** AC "menguji current DAN minimum-supported" dipenuhi nyata — job `minimum-supported` menjalankan Bun 1.3.0 (floor), dan gate meng-assert himpunan Bun CI = {current, minimum}. Cell minimum mencakup install/typecheck/build/family-conformance; residual: Astro/@astrojs/node/TS minimum == caret current (tak butuh cell terpisah), PostgreSQL tanpa floor terpisah.
- **Positif (F3):** drift indeks ADR ditutup gate `check-docs` (`checkAdrIndexCoverage`) — setiap `docs/adr/NNNN-*.md` (kecuali template 0000) wajib punya baris di `README.id.md`; menghapus baris/menambah ADR tak-terindeks memerahkan CI. Indeks 0027-0032 yang sempat drift kini dilengkapi.
- **Netral (F4):** manifest hanya mendeklarasikan capability yang modul pemiliknya benar-benar ada di base (`party_directory`/`profile_identity`); tiga capability konten (`news_media`/`public_content`/`social_publishing`) yang terbawa dari mini dihapus dari `CAPABILITY_CONTRACT_VERSIONS` + manifest karena modul CMS pemiliknya dikecualikan (`no-content-website-modules`, ADR-0022) — mengoreksi ketidakjujuran daftar. Detail historis daftar 4-capability ada di ADR-0015 §1 (tak diedit; ADR historis, dikoreksi oleh ADR ini).
- **Negatif/trade-off:** skema versioning ketujuh menambah permukaan kebijakan — didokumentasikan di `family-contract.ts` + `docs/awcms/family-compatibility.md`.
- **Netral:** tidak ada migration (tooling/docs saja); tidak mengubah kontrak modul/OpenAPI yang ada.

## Alternatif yang dipertimbangkan

- **Git submodule seluruh source mini + diff byte** — ditolak (out of scope issue): nondeterministik, bergantung repo lain live, dan menyamakan seluruh source bukan tujuan (AWCMS sengaja berbeda scope).
- **Menambah dependency validator JSON Schema (ajv, dll.)** — ditolak: Bun-only minim-dependency (ADR-0002); validator TypeScript tulisan tangan cukup untuk skema kecil ini, JSON Schema tetap dipublikasi untuk interop.
- **Family contract version = package release version** — ditolak: keduanya berevolusi berbeda (ADR-0008 sudah menetapkan versioning independen); lini major legacy (ADR-0024) tak boleh mengikat kontrak keluarga.
