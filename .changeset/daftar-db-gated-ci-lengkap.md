---
"awcms": patch
---

fix(ci): 36 test DB-gated berhenti hijau-palsu — lima berkas yang tak pernah dijalankan pipeline mana pun

Suite DB-gated di akar `tests/` tak bisa berjalan satu proses dengan
`tests/integration/` (empiris: 26 tabrakan), jadi kedua pipeline menjalankannya
sebagai step tersendiri dengan **daftar berkas eksplisit**. Daftar eksplisit
memang keputusan yang benar di situ — `bun test` telanjang akan menumbuhkan
kembali tabrakannya — tetapi daftar eksplisit **drift**, dan yang ini drift.

Ia lahir dengan **10** entri (#176). Lima berkas DB-gated mendarat sesudahnya
(#188, #189, #190, #191) dan **tak satu pun PR-nya menyentuh daftar itu**:

- `tests/mfa-integration.test.ts` — atomisitas lockout & replay counter di
  Postgres (CAS + `FOR UPDATE`), konsumsi recovery code sekali-pakai di bawah
  konkurensi, RLS FORCE, penolakan lintas-tenant.
- `tests/mfa-login-e2e.test.ts` — enforcement enrollment + step-up pada handler
  login/step-up/admin-reset yang SEBENARNYA.
- `tests/oidc-integration.test.ts` — penolakan lintas-tenant atas empat tabel
  OIDC, validasi klaim ID token, guard SSRF terhadap issuer privat.
- `tests/turnstile-login-e2e.test.ts` — Turnstile berjalan SEBELUM lookup
  identitas/kerja password di handler nyata, gagal-tertutup, dan tiap rute
  terikat action-nya sendiri.
- `tests/openapi-office-response-schema-postgres.test.ts` — konformansi payload
  respons terhadap schema `Office` di bundel OpenAPI.

Hasilnya **36 test yang skip di setiap pipeline** sambil terbaca sebagai
cakupan pada setiap run hijau. Dan bukan salah tafsir: header keempat berkas
itu **menuliskan sendiri** bahwa mereka "runs in the dedicated legacy
`bun test <files>` step" — step yang daftarnya tak pernah memanggil mereka.

Tak ada yang bisa menangkapnya. `bun run check` memang berjalan dengan
`DATABASE_URL` kosong, jadi berkas-berkas itu SEHARUSNYA skip di sana — skip
bukan sinyal. Satu-satunya pengamat yang bisa membedakan "skip karena tak ada
database" dari "skip selamanya" adalah pemeriksa yang membandingkan filesystem
dengan workflow, dan pemeriksa itu **tidak butuh database**.

Perbaikannya: kelimanya masuk daftar di **kedua** workflow (`ci.yml` dan
`release.yml` — `release.yml` justru pipeline yang mereka tuju saat ditulis),
komentar "These 9 files" yang sudah salah sejak lama dibetulkan jadi 15, dan
`tests/db-gated-suite-ci-parity.test.ts` mengikat daftar itu ke filesystem
**dua arah atas kedua workflow**:

1. tiap berkas DB-gated di akar `tests/` wajib disebut;
2. tiap entri wajib menunjuk berkas yang ADA dan MASIH DB-gated — entri yang
   berhentinya DB-gated akan berjalan di step yang seluruh tujuannya isolasi
   database sambil tak membuktikan apa pun;
3. kedua pipeline wajib menjalankan himpunan yang SAMA — berkas yang ada di
   `ci.yml` tapi tidak di `release.yml` lebih buruk daripada yang tak ada di
   keduanya: PR hijau atas bukti yang rilis tak pernah periksa ulang, dan
   itulah persis cara kelima entri ini bertahan.

**Mutation-proven tiga kali:** mengembalikan cacat aslinya (buang lima entri)
→ MERAH; entri menunjuk berkas tak-ada → MERAH; berkas berhenti DB-gated tapi
tetap terdaftar → MERAH.

**Catatan menghitung, karena draf pertama perubahan ini salah menghitungnya.**
Menjalankan kelima berkas dengan `DATABASE_URL` kosong melaporkan **46 skip**,
dan 46 **bukan** jumlah test: bun ikut menghitung **hook** yang di-skip, dan
kelimanya punya persis `beforeAll` + `afterAll` — 36 test + 10 hook. Yang jujur
adalah jumlah deklarasi (`grep -cE '^\s*(test|it)\('`), dan itulah yang kini
benar-benar dieksekusi pipeline: 14 + 3 + 9 + 1 + 9, diverifikasi per berkas
dari log run yang memulihkannya, bukan disimpulkan. Nol di antaranya merah —
90 migrasi berlalu sejak berkas-berkas itu ditulis, dan ternyata tak ada yang
membusuk.

Dan gerbangnya menangkap satu cacat pada dirinya sendiri sebelum di-commit:
draf pertama mencocokkan seluruh dokumen YAML, sehingga **komentar** yang
menyebut nama berkas ikut terbaca sebagai entri daftar. Itu kelas cacat yang
ADR-0062 sudah catat untuk ekstraktor path `skills:check`. Baris komentar kini
dibuang lebih dulu, dan alasannya ditulis di berkasnya.
