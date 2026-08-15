🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0045-jualanku-porting-awcms-system-of-record-astro-bff.md)

<!-- i18n-source-hash: sha256:f8b35e96efb4eea225fcd3e94718df305b70897facea09652fad285c5a89ee16 -->

# ADR-0045 — Porting Jualanku.info: `awcms` adalah system of record, `awcms-astro` adalah lapisan pengalaman BFF

- Status: Accepted
- Tanggal: 2026-07-29
- Terkait: [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  (modul domain tinggal langsung di `src/modules/`), [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md)
  (pemosisian superset online-first), [ADR-0030](0030-business-scope-hierarchy-generic-authorization-layer.md)
  (lapisan otorisasi business-scope), [ADR-0033](0033-abac-dynamic-policy-evaluator.md)
  (allow-list atribut ABAC yang berbatas), [ADR-0031](0031-segregation-of-duties-conflict-enforcement.md)
  (SoD), [ADR-0026](0026-modular-openapi-ownership-and-composition.md) (kepemilikan
  OpenAPI modular), [ADR-0009](0009-public-tenant-scoped-routes.md)
  (rute publik ber-scope path), [ADR-0044](0044-merge-news-portal-into-blog-content.md)
  (satu modul konten). Sumber permintaan: _"Validasi Arsitektur dan Standar —
  Porting UI/UX Jualanku.info ke AWCMS dan AWCMS-Astro"_ v1.0, PT TIM SIX,
  29 Juli 2026 (`APPROVE WITH CORRECTIONS`).

## Konteks

Jualanku.info adalah direktori merchant + portal penjual + program afiliasi yang
UI/UX-nya hanya ada sebagai prototipe Elementor. Sebuah dokumen validasi tingkat
kemudi menyetujui pembangunannya di atas dua repositori keluarga ini — `awcms`
untuk platform bisnisnya dan `awcms-astro` untuk pengalaman publik/portalnya —
dengan syarat sejumlah keputusan arsitektur P0 dicatat lebih dulu. ADR ini
adalah catatan itu untuk `awcms`; paruh rendering/runtime-nya dicatat di ADR
milik `awcms-astro` sendiri, karena perubahan yang digambarkannya (adapter,
deployment, rute on-demand) terjadi di repositori itu.

Empat fakta diperiksa terhadap kode repo ini sebelum diputuskan, karena dokumen
validasi itu sebagian bernalar dari dokumentasi dan dokumentasi mengalami drift:

**1. Registry modul menampung 20 modul, dan `news_portal` bukan salah satunya.**
Dokumen validasi menandai ketidakkonsistenan inventaris (README menyebut 21,
dokumen arsitektur menyebut 20, `news-portal` terdokumentasi tetapi absen).
Temuannya nyata, tetapi penyebabnya justru kebalikan dari "ada modul yang
hilang": `news_portal` _dilebur ke dalam_ `blog_content` oleh ADR-0044, dan
`README.md`/`docs/ARCHITECTURE.md` tidak ikut diperbarui. `src/modules/index.ts`
adalah satu-satunya inventaris yang diperlakukan otoritatif oleh ADR ini; prosa
basi itu dikoreksi dalam perubahan yang sama dengan ADR ini.

**2. Penanganan sesi bukan bearer-only — tetapi ia same-origin.**
`resolveAuthInputs()` (`src/modules/identity-access/application/access-guard.ts`)
sudah menerima baik header `authorization`/`x-awcms-tenant-id` **maupun** cookie
sesi/tenant httpOnly yang dipasang shell SSR admin saat login. Yang benar-benar
belum ada itu berbeda dan lebih sempit: `GET /api/v1/auth/me` bearer-only, dan
tidak ada kontrak introspeksi yang bisa dipanggil sebuah **origin terpisah** atas
nama browser yang cookie-nya tidak ia bagi. Celahnya adalah kontrak sesi portal
lintas-origin, bukan dukungan cookie.

**3. Kepemilikan merchant tidak punya rumah di allow-list atribut ABAC — tetapi
punya satu di lapisan business-scope.** `ABAC_ATTRIBUTES`
(`src/modules/identity-access/domain/abac-policy.ts`) adalah allow-list tertutup;
atribut yang tak dikenal tidak valid saat authoring dan men-deny saat evaluasi.
Tidak ada `subject.merchantIds`/`resource.merchantId` di dalamnya, dan menambah
atribut khusus per-produk ke daftar yang berbatas adalah cara daftar semacam itu
berhenti berbatas. Namun ada `resource.businessScopeId`, plus port hierarki
business-scope (ADR-0030) yang implementasi base-nya mengembalikan
`resolved: false` untuk setiap tipe scope supaya aksi berisiko tinggi
gagal-tertutup sampai sebuah modul memasok hierarki yang sebenarnya. Merchant
persis hierarki jenis itu.

**4. RLS memisahkan tenant, dan hanya tenant.** Setiap tabel ber-scope tenant
di-`FORCE`-RLS terhadap GUC tenant. Dengan satu tenant penyelenggara yang
menampung banyak merchant, RLS bungkam soal merchant A membaca merchant B. Tidak
ada apa pun di kode saat ini yang menutup itu; ia wajib dibangun.

## Keputusan

**1. Kedua repositori mempertahankan pembagian tanggung jawabnya, dan browser
tidak pernah berbicara ke `awcms`.** `awcms` memiliki layanan domain, policy,
workflow, audit, reporting, shell SSR admin internal, dan basis datanya.
`awcms-astro` memiliki halaman publik, portal penjual/afiliasi, dan satu-satunya
Backend-for-Frontend. `awcms` di-deploy di origin privat (atau origin yang
dibatasi pada identitas layanan milik lapisan pengalaman); rute publik di `awcms`
ada hanya di tempat repo ini memang sudah mengirimkannya
(`/blog/{tenantCode}/*`, rute discovery SEO, `/search`).

**2. BFF mengorkestrasi dan memproyeksikan; ia tidak pernah memutuskan.**
`_portal-api/*` di `awcms-astro` boleh meresolusi sesi, menetapkan konteks
tenant, menegakkan CSRF/Origin, membentuk view model, dan me-mask field.
Pemeriksaan entitlement, pemeriksaan kepemilikan, transisi state, penulisan
ledger, dan invarian validasi tinggal di layanan application `awcms` dan
diperiksa ulang di sana untuk setiap panggilan, termasuk panggilan yang diyakini
BFF sudah ia validasi.

**3. Jualanku dikirim sebagai modul domain langsung di `src/modules/`, dan
sebagai lima bounded context, bukan tujuh.** Sesuai ADR-0034 tidak ada
repositori turunan dan tidak ada registry ekstensi. Modulnya adalah
`jualanku_directory`, `jualanku_catalog_growth`, `jualanku_affiliate`,
`jualanku_commercial`, dan `jualanku_trust_operations`, masing-masing
`type: "domain"`, masing-masing memiliki tabelnya sendiri di bawah prefiks
`awcms_jualanku_*`. Memecahnya lebih jauh adalah keputusan yang diambil dari
kopling terukur, bukan dari bentuk bagan organisasi.

**4. Isolasi merchant ditegakkan di tiga tempat, dan tidak pernah diasumsikan
dari RLS.**

- **Lapisan tenant** — tak berubah: RLS `FORCE` berkunci pada GUC tenant.
- **Lapisan scope** — sebuah merchant adalah **business scope**.
  `jualanku_directory` menyediakan capability `business_scope_hierarchy`
  (ADR-0030) untuk tipe scope `merchant`, sehingga resolver berhenti
  mengembalikan `resolved: false` untuk merchant dan aksi merchant berisiko
  tinggi berhenti gagal-tertutup karena alasan yang salah. Keanggotaan merchant
  dan penugasan assisted-onboarding berbatas waktu menjadi grant scope dengan
  penanggalan efektif.
- **Lapisan query** — setiap baca dan tulis ber-scope merchant membawa predikat
  kepemilikan yang diturunkan dari grant scope hasil resolusi, dan setiap nilai
  `resourceAttributes` yang diserahkan ke evaluator ABAC dibaca dari baris
  tersimpan. `merchantId` di badan request adalah input untuk divalidasi, tidak
  pernah klaim untuk dipercaya.

Policy ABAC mengekspresikan aturan merchant lewat `resource.businessScopeId`,
`subject.roles`, `resource.status`, dan `resource.ownerTenantUserId`. Allow-list
atributnya **tidak** diperluas untuk Jualanku.

**5. `identity_access` mendapat kontrak introspeksi sesi untuk portal
lintas-origin.** Sebuah endpoint baru mengembalikan _klaim aman saja_ (id
identitas, tenant, nama tampilan, role, tingkat assurance, referensi scope
merchant/afiliasi) untuk sesi yang disodorkan BFF; ia tidak pernah mengembalikan
token, status password, secret MFA, atau PII di luar yang dibutuhkan sebuah
header portal. Pencetakan sesi, rotasi, pencabutan, dan MFA/step-up tetap
dimiliki `awcms`; BFF tidak menyimpan identity store, dan logout di portal
mencabut ke hulu sebelum ia membersihkan cookie-nya sendiri.

**6. Namespace public, portal, dan admin adalah tiga policy di atas satu
layanan.** `/api/v1/jualanku/public/*`,
`/api/v1/jualanku/portal/{merchant,affiliate}/*`, dan
`/api/v1/jualanku/admin/*` berbeda dalam autentikasi, otorisasi, permukaan
input, dan proyeksi respons. Mereka tidak boleh berbeda dalam aturan bisnis, dan
aturan yang diimplementasikan dua kali adalah cacat terlepas dari apakah kedua
salinannya saat ini sepakat.

**7. Administrasi internal tetap di SSR `awcms` di bawah `/admin/jualanku/*`,
default-deny.** Principal merchant dan afiliasi tidak mendapat role, rute, entri
navigasi, maupun audience sesi yang menjangkaunya. Menyembunyikan menu bukanlah
kontrol; endpoint dan halaman yang dirender server itulah kontrolnya.

**8. Artefak uang dan kepercayaan bersifat append-only.** Entri komisi dan
pergerakan ledger payout disisipkan, tidak pernah ditimpa; koreksi berupa
pembalikan atau penyesuaian. Persiapan payout dan persetujuan payout adalah
permission yang berbeda, ditegakkan sebagai aturan SoD (ADR-0031) dan sebuah
workflow, sehingga subjek yang sama tidak bisa melakukan keduanya.

**9. Baseline standar disegarkan ke versi yang berlaku pada tanggal ini.**
WCAG 2.2 AA (ISO/IEC 40500:2025), profil L2 OWASP ASVS 5.0 untuk permukaan
portal dan admin, OWASP API Security Top 10:2023, ISO/IEC 27701:2025,
ISO/IEC 27018:2025, ISO/IEC 15408 Bagian 1–5:2026 diterapkan secara sempit pada
komponen sesi/otorisasi, ISO/IEC 27017:2026 dalam pantauan transisi. Tidak ada
klaim sertifikasi di mana pun dalam produk maupun dokumentasinya.

**10. Tidak ada yang menghadap produksi dibangun sampai gerbang P0 tertutup.**
Gerbangnya adalah: ADR ini plus ADR rendering `awcms-astro` diterima; inventaris
modul direkonsiliasi; kontrak sesi/CSRF/tenant dispesifikasikan dan tercakup
test; model data merchant/business-scope beserta matriks otorisasi negatifnya
disepakati; dan lima deskriptor modul plus kepemilikan tabelnya ditetapkan.
Desain yang mengimplementasikan gerbang-gerbang itu tinggal di
[`../awcms/jualanku/`](../awcms/jualanku/README.md); folder itu adalah blueprint,
dan tidak ada bagian darinya yang merupakan klaim bahwa kodenya ada.

## Konsekuensi

**Positif.**

- Isolasi merchant memakai ulang lapisan otorisasi yang sudah fail-closed, sudah
  diaudit, dan sudah dilatih oleh test SoD dan business-scope, alih-alih
  pemeriksaan kepemilikan per-produk yang hanya akan ada di jalur kode Jualanku
  sendiri.
- Allow-list atribut ABAC tetap berbatas — properti yang membuatnya layak
  dimiliki.
- Situs publik mempertahankan karakteristik cache dan SEO sebuah build statis,
  sementara hanya rute yang benar-benar dipersonalisasi yang membayar rendering
  on-demand.
- Satu layanan application per use case berarti proyeksi publiknya tidak bisa
  menyimpang dari pandangan admin atas aturan yang sama.

**Negatif / trade-off.**

- BFF adalah satu hop tambahan, satu deployment tambahan, dan satu tempat
  tambahan di mana developer yang terburu-buru bisa menaruh aturan bisnis.
  Risiko itu nyata dan dimitigasi oleh review, bukan oleh arsitektur semata.
- Memodelkan merchant sebagai business scope mengopel `jualanku_directory` ke
  kontrak scope: perubahan pada port hierarkinya menjadi perubahan dengan radius
  ledakan berbentuk Jualanku.
- Lima modul di dua repositori adalah koordinasi yang lebih banyak daripada satu
  modul di satu repositori, dan baca lintas-modul wajib lewat port capability
  atau read model alih-alih sebuah join yang praktis.

**Netral.**

- Model tenant-penyelenggara-tunggal (`JUALANKU_MAIN`) adalah keputusan pilot,
  bukan keputusan platform. Multi-penyelenggara/white-label tetap mungkin justru
  karena isolasi merchant tidak dibangun di atas batas tenant.
- Tidak ada migrasi, deskriptor modul, rute, atau fragmen OpenAPI yang
  ditambahkan oleh ADR ini. Unit kerja berikutnya menambahkannya, satu bounded
  context pada satu waktu, masing-masing dengan migrasinya sendiri, seed
  permission, test otorisasi negatif, dan changeset.

## Alternatif yang dipertimbangkan

- **Satu modul `jualanku`.** Mulai tercepat, sekaligus rute tercepat menuju
  katalog permission yang tidak bisa dinalar siapa pun: baca direktori,
  persetujuan payout, dan keputusan moderasi akan berbagi satu namespace
  aktivitas dan satu pemilik tabel.
- **Tujuh modul, seperti usulan aslinya.** Batas ditarik dari struktur menu
  alih-alih dari invarian dan kepemilikan data. Ia melipatgandakan event
  lintas-modul dan port capability sebelum ada bukti bahwa salah satu batas itu
  memikul bobot.
- **Satu tenant per merchant.** RLS lalu akan mengisolasi merchant secara gratis
  — dan direktori lintas-merchant, taksonomi bersama, antrean moderasi, serta
  reporting seluruh platform yang justru menjadi alasan produk ini ada semuanya
  akan menjadi query lintas-tenant, yang memang dengan benar dibuat sulit oleh
  platform ini.
- **Sepasang atribut khusus `subject.merchantIds`/`resource.merchantId`.**
  Langsung dan mudah dibaca, tetapi ia mengubah allow-list yang berbatas menjadi
  yang terus tumbuh: domain berikutnya meminta pasangannya sendiri, dan jaminan
  fail-closed terkikis satu permintaan masuk akal pada satu waktu.
- **Browser memanggil `awcms` langsung dengan bearer token.** Menghapus hop BFF
  dan menaruh token di storage browser, pemilihan tenant di tangan klien, dan
  permukaan CORS sebuah API ERP di internet publik.
