---
name: awcms-codeql-triage
description: Triase dan perbaiki temuan CodeQL code scanning AWCMS (github.com/ahliweb/awcms/security/code-scanning). Gunakan saat diminta "analisis code scanning"/"perbaiki CodeQL", saat sebuah PR gagal check CodeQL, atau saat menemukan alert baru. Mendokumentasikan enam false-positive nyata yang sudah ditemukan (name-heuristic password, incompatible-types typeof/null, URL substring-sanitization di test mock, dua kasus dismiss resmi tanpa reformulasi kode, Bun.SQL tagged-template null-cast, dan build-time extension seam trivial-conditional) plus pola "unused-local-variable di test kadang menandai coverage gap" — supaya tidak diinvestigasi ulang dari nol.
---

# AWCMS — Triase CodeQL Code Scanning

CodeQL (`.github/workflows/codeql.yml`, matrix `actions` + `javascript-typescript`) jalan di setiap push/PR ke `main`. Sebagian temuan adalah bug nyata; sebagian lain adalah **false positive** dari heuristik statis CodeQL yang tidak melihat konteks runtime sesungguhnya. Skill ini adalah proses triase + katalog false-positive yang sudah dikonfirmasi.

## Langkah triase (wajib, jangan menebak)

1. **Ambil daftar alert nyata** — jangan asumsikan dari ingatan/PR lama:
   ```bash
   gh api repos/ahliweb/awcms/code-scanning/alerts --paginate \
     -q '.[] | select(.state=="open") | "\(.number)\t\(.rule.severity)\t\(.rule.id)\t\(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)"'
   ```
2. **Ambil detail + pesan asli per alert** (bukan cuma nama rule):
   ```bash
   gh api repos/ahliweb/awcms/code-scanning/alerts/<N>
   ```
   Baca `most_recent_instance.message.text` — ini alasan CONCRETE CodeQL, bukan deskripsi generik rule. Untuk PR yang gagal check, `gh api repos/ahliweb/awcms/check-runs/<id>/annotations` memberi lokasi+pesan yang sama.
3. **Cari bukti apakah ini bug nyata atau false positive** sebelum menulis kode apa pun:
   - Cek apakah pola kode yang sama persis ada di file lain **tanpa** alert — kalau ada, itu sinyal kuat false positive kontekstual (CodeQL flow-sensitive analysis kadang berbeda hasil per call-site untuk kode identik).
   - Baca pesan CodeQL kata-per-kata dan uji terhadap semantik JS/TS sesungguhnya — kalau pesannya menyebut sesuatu yang secara data-flow **tidak mungkin** (mis. menyebut sebuah fungsi yang terbukti tidak pernah mengembalikan field yang dituduh), itu bukti definitif false positive, bukan tebakan.
   - **Jangan** langsung tambah suppression comment (`// codeql[rule-id]`) sebagai upaya pertama — sudah terbukti **tidak efektif** di setup CI repo ini (diverifikasi PR #505, Issue #496: suppression comment tetap muncul ulang di run berikutnya).
4. **Perbaiki dengan code change minimal, behavior-preserving** — bukan menekan alert. Kalau setelah investigasi ternyata false positive murni tanpa cara reformulasi kode yang wajar, baru pertimbangkan dismiss resmi lewat API (lihat §4 katalog di bawah untuk dua kasus nyata):
   ```bash
   gh api repos/ahliweb/awcms/code-scanning/alerts/<N> -X PATCH \
     -f state=dismissed -f "dismissed_reason=false positive" \
     -f dismissed_comment="<alasan konkret + bukti, maks 280 karakter>"
   ```
   `dismissed_reason` harus PERSIS `"false positive"` / `"won't fix"` / `"used in tests"` (dengan spasi) — `false_positive` dengan underscore ditolak API (422). `dismissed_comment` dibatasi 280 karakter; taruh alasan lengkap di katalog skill ini, bukan di comment.
5. **Verifikasi**: `bun run check` hijau, push, tunggu CI — konfirmasi CodeQL run berikutnya tidak lagi menampilkan alert yang sama (bukan cuma "kelihatannya benar").

## Katalog false-positive yang sudah dikonfirmasi

### 1. `js/insufficient-password-hash` — heuristik nama fungsi

CodeQL menandai **return value fungsi APA PUN yang namanya mengandung substring "password"** sebagai "password-flavored", terlepas dari apa yang sungguh-sungguh dikembalikan atau bagaimana dipakai. Ditemukan Issue #496 (PR #505): `hashPasswordResetToken` (hash token 256-bit) dan `validateForgotPasswordInput` (return `{loginIdentifier}`, TIDAK ADA field password sama sekali) sama-sama ditandai. Bukti definitif false positive: kasus kedua _tidak mungkin_ soal data-flow nyata karena tipe returnnya tidak punya field password sama sekali — satu-satunya penjelasan adalah heuristik nama.

**Fix yang terbukti berhasil**: **rename** fungsi agar namanya tidak mengandung "password" (`generatePasswordResetToken`→`generateResetToken`, `hashPasswordResetToken`→`hashResetToken`, `validateForgotPasswordInput`→`validateForgotIdentifierInput`, `validateResetPasswordInput`→`validateCompleteResetInput`). Suppression comment inline **dicoba lebih dulu dan terbukti tidak menghilangkan alert** — jangan ulangi jalan itu.

**Pencegahan**: saat menamai fungsi yang menangani hashing/validasi terkait password/reset/kredensial, hindari substring "password" di nama fungsi kalau return value-nya **bukan** password mentah/hash password sungguhan (mis. token, identifier, DTO tanpa field password) — heuristik CodeQL hanya melihat nama, bukan tipe.

### 2. `js/comparison-between-incompatible-types` — idiom `typeof x === "object" && x !== null`

Ditemukan 2026-07-07 (alert #11) di `isPlainObject`/`isRecord` helper (`typeof value === "object" && value !== null && !Array.isArray(value)`) — idiom standar JS untuk cek "objek non-null" (`typeof null === "object"`, sehingga cek `!== null` wajib). CodeQL menganggap setelah `typeof value === "object"` menyempitkan tipe `value` ke "Date, object, atau regular expression", lalu membandingkannya ke `null` dianggap "incompatible types" — padahal `null` selalu bisa dibandingkan langsung ke referensi objek apa pun di JS, ini bukan bug. Bukti false positive: pola identik ada di 4 file lain (`form-draft-validation.ts`, `settings-validation.ts`, `announcement-validation.ts`, `wizard-client.ts`) tanpa alert — CodeQL flow-sensitive analysis berbeda hasil per call-site untuk kode yang identik.

**Fix**: urutkan ulang — cek `value === null` **sebelum** narrowing `typeof`, bukan sesudahnya (perilaku runtime identik):

```ts
// Sebelum (bisa kena false positive):
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Sesudah (perilaku sama, tidak kena false positive):
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value)) {
    return false;
  }
  return typeof value === "object";
}
```

**Pencegahan**: saat menulis helper "is non-null object" baru, pakai urutan `value === null` dulu, baru `typeof`.

### 3. `js/incomplete-url-substring-sanitization` — `startsWith(<literal origin>)` di test mock fetch

Ditemukan 2026-07-10 (alert #19, #20) di `tests/unit/generic-oidc-client.test.ts` dan
`tests/integration/tenant-sso-flow.integration.test.ts` — kedua test menyuntik
`globalThis.fetch` palsu yang mencocokkan URL dengan
`url.startsWith("https://attacker.example.com")` untuk memutuskan kapan
membalas kegagalan simulasi. Rule ini didesain untuk kode PRODUKSI yang
memutuskan APAKAH SEBUAH URL DIPERCAYA berdasarkan awalan string (rawan
bypass `https://trusted.com.evil.com`) — di sini pemakaiannya justru
terbalik (mencocokkan URL mock test untuk MENOLAK, bukan mempercayai) dan
kedua sisi perbandingan sepenuhnya dikontrol test itu sendiri, jadi bukan
kerentanan sungguhan. Tetap diperbaiki dengan kode minimal alih-alih
suppress, karena `startsWith` juga secara tidak sengaja lebih longgar dari
yang dimaksud (cocok untuk origin manapun yang KEBETULAN diawali string
yang sama).

**Fix**: bandingkan `new URL(url).origin` dengan origin target secara
exact, bukan `startsWith` pada string mentah — perilaku test tetap sama
(masih cocok untuk semua path di bawah origin itu), tapi sekarang presisi
origin-level, bukan substring-level:

```ts
// Sebelum (kena false positive, dan sedikit longgar):
if (url.startsWith("https://attacker.example.com")) { ... }

// Sesudah (perilaku sama untuk kasus nyata, presisi origin):
if (new URL(url).origin === "https://attacker.example.com") { ... }
```

**Pencegahan**: saat menulis mock fetch di test yang mencocokkan URL
berdasarkan host/origin, pakai `new URL(url).origin === <origin>` alih-alih
`startsWith(<origin>)` — sama presisinya untuk niat aslinya (cocok semua
path di origin itu), tapi tidak memicu heuristik CodeQL yang menyasar pola
"substring sanitization" di kode produksi.

### 4. `js/insufficient-password-hash` dan `js/clear-text-logging` — dismiss resmi tanpa reformulasi kode (Issue #614)

Ditemukan 2026-07-09 (alert #16, #17, #18), diinvestigasi dan di-dismiss
2026-07-10. Berbeda dari pattern #1-#3 di atas (semua diperbaiki dengan
code change), ketiga alert ini di-dismiss resmi lewat API karena
reformulasi kode yang wajar tidak tersedia tanpa mengorbankan tujuan
sungguhan kode tersebut:

- **Alert #18** (`js/insufficient-password-hash`,
  `src/lib/auth/oauth-state-token.ts:30`): CodeQL menandai return value
  `generateOAuthState()`/`parseOAuthStateParam()` yang mengalir ke
  `hashOAuthState`'s sha256 sebagai "password". BUKAN heuristik nama fungsi
  (pattern #1) — nama fungsi ini sama sekali tidak mengandung substring
  "password", jadi trigger mechanism-nya berbeda dan tidak sepenuhnya
  dikonfirmasi. Tapi argumen keamanannya independen dan kokoh:
  `generateOAuthState()` mengembalikan `randomBytes(32).toString("base64url")`
  — nilai CSPRNG 256-bit, BUKAN input user/password. `hashOAuthState`
  memakai bentuk fast-hash-with-prefix (`sha256:<hex>`) yang PERSIS sama
  dengan tiga file token lain yang TIDAK di-flag (`session-token.ts`'s
  `hashSessionToken`, `password-reset-token.ts`'s `hashResetToken`,
  `mfa-challenge-token.ts`'s `hashChallengeToken`) — alasan yang sama
  berlaku: hash lambat (bcrypt/argon2/scrypt) hanya menambah biaya
  verifikasi tanpa manfaat keamanan nyata untuk nilai random 256-bit yang
  mustahil di-brute-force offline berapa pun kecepatan hash-nya. Mencoba
  rename tanpa tahu trigger mechanism pastinya berisiko sia-sia (CI cycle
  terbuang tanpa kepastian fix), jadi dismiss dipilih dengan bukti
  keamanan independen sebagai justifikasi, bukan sekadar asumsi "sama
  seperti pattern #1".
- **Alert #16, #17** (`js/clear-text-logging`, `scripts/validate-env.ts` — the
  `EnvCheckResult` printer near the end of `config:validate`'s CLI output
  block, NOT a fixed line number; line numbers in this file drift as the
  script grows, describe by function/context instead of re-citing a line):
  CodeQL menandai `console.log` yang mem-print `EnvCheckResult.name`/`.detail`
  sebagai membocorkan `AUTH_MFA_REQUIRED_WHEN_ENABLED` (array konstan berisi
  NAMA var, isinya `["AUTH_MFA_SECRET_ENCRYPTION_KEY"]`) secara clear-text.
  Diverifikasi langsung dari `checkMfaConfig`: yang benar-benar mengalir ke
  `console.log` hanya STRING LITERAL nama var (`name`, mis.
  `"AUTH_MFA_SECRET_ENCRYPTION_KEY"`) dan teks statis (`"is set."`, `"is
missing or empty."`, dst) — nilai asli `env[name]` (secret sungguhan)
  HANYA pernah dipakai di dalam predikat boolean (`isSet(env[name])`,
  `isMfaEncryptionKeyWellFormed(env)`), tidak pernah masuk ke variabel yang
  di-log. Reformulasi kode tidak masuk akal di sini karena tujuan
  `console.log` ini MEMANG untuk memberi tahu operator var mana yang hilang
  saat `bun run config:validate` gagal — menghapus nama var dari pesan
  error menghancurkan kegunaan tool ini untuk operator.

**Pencegahan**: kalau menemukan alert serupa (nama VAR/konstanta config
di-flag sebagai "sensitive data" padahal yang di-log cuma label/nama, bukan
nilai), verifikasi eksplisit dengan membaca SETIAP jalur data yang
benar-benar sampai ke sink (console.log/hash call) sebelum memutuskan
dismiss — jangan asumsikan dari nama alert saja. Simpan bukti konkret di
`dismissed_comment` (API `PATCH .../code-scanning/alerts/<N>`, `dismissed_reason`
harus persis `"false positive"`/`"won't fix"`/`"used in tests"` dengan spasi,
BUKAN `false_positive` dengan underscore — API menolak keduanya kalau
salah format; `dismissed_comment` dibatasi 280 karakter, taruh alasan
lengkap di skill ini, bukan di comment).

### 5. `js/implicit-operand-conversion` — Bun.SQL tagged template dengan argumen yang provably-always-`null`

Ditemukan 2026-07-14 (alert #48, #49), Issue #788: dua instance pada baris
yang sama, `business-scope-facts.ts:59`
(`AND (${excludeAssignmentId}::uuid IS NULL OR id <> ${excludeAssignmentId})`
di dalam `` tx`...` ``, sebuah Bun.SQL tagged template). CodeQL menganggap
`${excludeAssignmentId}` di-stringify seperti template literal biasa
(`` `${null}` `` → `"null"`), padahal **tagged template TIDAK melakukan
implicit toString** — nilai substitusi diteruskan mentah ke fungsi tag
(`tx`), yang mem-bind-nya sebagai parameter SQL asli (`NULL` sungguhan,
bukan string `"null"`). CodeQL hanya menandai baris ini karena satu-satunya
call site `fetchActiveAssignmentRows` (fungsi privat, satu caller) selalu
memanggilnya dengan literal `null` — dataflow-nya "provably always null" di
sini, tapi konversi implisit yang dituduh tetap tidak pernah terjadi
(bukan soal apakah nilainya null, tapi bukan JS's implicit-toString sama
sekali karena tagged template). Bukti definitif false positive: pola
identik persis (`${excludeAssignmentId}::uuid IS NULL OR bsa.id <>
${excludeAssignmentId}`) ada di baris 186 file yang SAMA (fungsi
`resolveSoDAssignmentFacts`, dipanggil dari 2 caller eksternal — juga
selalu dengan literal `null` di kedua caller saat ini) dan 12+ file lain
di repo memakai pola `${x ?? null}::uuid IS NULL OR ...` yang sama —
semuanya tidak di-flag CodeQL. Ini murni artefak heuristik per-call-site,
bukan sinyal bug sistematis.

**Fix**: dismiss resmi (bukan reformulasi) — reformulasi kode (mis. cabang
if/else terpisah untuk null vs non-null) hanya menambah kompleksitas nyata
untuk kode yang sudah benar dan konsisten dengan 12+ file lain di repo.

**Pencegahan**: kalau CodeQL menandai `js/implicit-operand-conversion` pada
sebuah `` tx`...${x}...` `` (Bun.SQL/postgres.js tagged template), cek dulu
apakah ekspresi itu benar-benar di dalam tagged template (bukan
concatenation string biasa) — kalau ya, implicit-toString tidak pernah
terjadi secara runtime, dan alert ini adalah false positive berbasis
pola string-interpolation generik yang tidak paham parameter binding SQL
client library. Cari pola identik di file lain sebagai bukti sebelum
dismiss.

### 6. `js/trivial-conditional` — nilai build-time extension seam yang sengaja selalu satu cabang di base repo

> **HISTORIS / TIDAK BERLAKU LAGI (ADR-0034, 2026-07-21).** Alert ini
> bergantung pada `src/modules/application-registry.ts` (build-time extension
> seam jalur aplikasi-turunan). ADR-0034 **menghapus jalur turunan** dan file
> `application-registry.ts` beserta `scripts/validate-module-composition.ts:41`
> yang men-`ternary`-nya — jadi alert `js/trivial-conditional` ini **tidak akan
> muncul lagi** dan tidak perlu di-triase ulang. Dipertahankan hanya sebagai
> catatan sejarah triase. Prinsip umum "extension point yang sengaja `undefined`
> di base memicu trivial-conditional" tetap sahih untuk pola serupa lain, tetapi
> tidak ada lagi seam turunan di repo ini.

Ditemukan 2026-07-14 (alert #44), Issue #788:
`scripts/validate-module-composition.ts:41`,
`applicationModuleRegistry ? ... : ...` — CodeQL benar bahwa
`applicationModuleRegistry` (diimpor dari
`src/modules/application-registry.ts`) SELALU `undefined` di repo dasar
ini, sesuai desain (Issue #740, epic #738 `platform-evolution`): file itu
adalah _build-time extension seam_ yang sebuah aplikasi turunan REPLACE
seluruhnya dengan `ApplicationModuleRegistry` sungguhan. CodeQL cuma
melihat kode yang ter-checked-in di REPO INI, jadi kondisinya memang
trivial DI SINI — tapi genuinely conditional begitu file itu diganti oleh
repo turunan. Bukti pembeda: 5 file lain
(`src/modules/index.ts`, `module-composition-inventory-generate.ts`,
`extension-check.ts`, `modules-sync.ts`) juga meng-import
`applicationModuleRegistry` tapi HANYA meneruskannya sebagai _value_ ke
fungsi lain (never in a truthy/boolean context) — tidak ada satu pun yang
di-flag; hanya `validate-module-composition.ts` yang memakainya dalam
ekspresi ternary boolean-context, satu-satunya tempat trivial-conditional
bisa terdeteksi.

**Fix**: dismiss (won't-fix) — bukan bug, dan reformulasi apa pun (mis.
`!= null` alih-alih truthy check) tidak menghilangkan kesimpulan CodeQL
karena akar masalahnya adalah NILAI-nya provably-constant di repo ini,
bukan operator pembandingnya.

**Pencegahan**: pola "build-time extension point/seam yang sengaja
`undefined`/no-op di base repo, real value di repo turunan" akan selalu
memicu `js/trivial-conditional` di base repo begitu nilainya dipakai dalam
boolean context — ini SEHAT (bukan alasan untuk menghapus fitur
ekstensibilitasnya), dismiss dengan menjelaskan desain seam-nya, jangan
coba "memperbaiki" trivialitasnya.

### Pola tambahan: `js/unused-local-variable` di test kadang menandai coverage gap, bukan sekadar dead code

Dari 11 alert `js/unused-local-variable` di Issue #788 (semua di file
test), 8 memang leftover import/variable murni (aman dihapus). Tapi 3
adalah TEST HELPER YANG DITULIS DENGAN BENAR tapi tidak pernah dipanggil
— masing-masing menunjuk ke satu jalur test yang seharusnya ada tapi
hilang:

- `createCategoryTerm` (`news-portal-homepage-sections.integration.test.ts`)
  — hanya ada test REJECT untuk `category_grid` (categorySlug tidak ada),
  tidak ada test ACCEPT (categorySlug valid) — helper-nya sudah ditulis
  lengkap, cuma tidak pernah dipanggil dari sebuah test.
- Destructured `has` di test "stale orphaned ... gets its R2 object
  deleted" (`news-media-r2-reconciliation-job.integration.test.ts`) — judul
  test menjanjikan verifikasi penghapusan objek R2 tapi body hanya mengecek
  counter (`result.staleOrphaned.deleted`) dan status DB, tidak pernah
  memanggil `has(key)` untuk membuktikan objeknya benar-benar hilang dari
  R2 (dan tidak pernah `put()` objeknya lebih dulu).
- `resolveLinkedInApiVersion` (`linkedin-provider-config.test.ts`) — semua
  fungsi lain yang diexport modul itu punya `describe` block sendiri,
  hanya fungsi ini yang diimpor tapi tidak pernah diuji langsung.

**Aturan triase**: sebelum menghapus binding `js/unused-local-variable` di
file test, cek APAKAH nama binding itu match sebuah kapabilitas/skenario
yang disebut di judul test lain, docstring file, atau nama fungsi lain di
modul yang sama — kalau ya, kemungkinan besar itu coverage gap (helper
ditulis untuk test yang lalu terlupa/terpotong), bukan dead code murni.
Wire ke assertion baru yang sesuai (menutup gap SEKALIGUS menghilangkan
alert) alih-alih sekadar menghapus.

## Verifikasi

- `gh pr checks <PR>` — tunggu CodeQL selesai (jangan asumsikan pending = akan pass).
- Alert yang sudah diperbaiki otomatis pindah ke state `fixed` di halaman code-scanning pada run berikutnya di `main` — tidak perlu dismiss manual kalau memang sudah tidak muncul lagi.
- `bun run check` tetap harus hijau — perbaikan CodeQL tidak boleh mengubah perilaku runtime (lihat test yang sudah ada untuk fungsi yang diubah).

## Skill terkait

`awcms-security-review` (checklist keamanan modul, bukan tooling scan), `awcms-pr-review` (proses review PR secara umum).
