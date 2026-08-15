🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0047-mini-micro-frozen-foundation-built-here.md)

<!-- i18n-source-hash: sha256:261a153b85c43361591a94792800044be18f3251b13e184c6246fc96a6902134 -->

# ADR-0047 — `awcms-mini` dan `awcms-micro` dibekukan sebagai referensi; fitur fondasi dibangun langsung di sini

- **Status:** Superseded by [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
- Tanggal: 2026-07-31
- Terkait: [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  (template dipakai-langsung, tanpa repo turunan wajib), [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md)
  (pemosisian superset ERP/SaaS online-first), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
  (`awcms` adalah system of record, `awcms-astro` adalah lapisan pengalaman).
  Mengamandemen aturan **mini-first** yang dinyatakan di [`AGENTS.md`](../../AGENTS.md)
  §"Relasi dengan awcms-mini" dan [`docs/awcms/alur-pengembangan-mini-first.md`](../awcms/alur-pengembangan-mini-first.md).

> **Baca sebagai sejarah.** ADR ini membekukan `awcms-mini`/`awcms-micro`
> sebagai referensi yang **masih boleh di-port KELUAR**.
> [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
> (2 Agustus 2026) menutup jalur itu juga: keduanya adalah **ARSIP**, dan
> kapabilitas yang diinginkan **dibangun di sini** di bawah ADR admission-nya
> sendiri. Butir 1 §Keputusan di bawah ("Membaca dan mem-port _keluar_ tetap
> dianjurkan") karena itu **tidak lagi berlaku** — kata-katanya sengaja tidak
> ditulis ulang, sesuai Aturan 2 indeks ADR (ADR yang digantikan **ditandai**,
> bukan dihapus dan bukan ditulis ulang). Lihat juga
> [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
> untuk peran yang dipikul dua repo yang bertahan hari ini.

> **Catatan penomoran.** `0046` sengaja dilewati: ia dicadangkan oleh pekerjaan
> yang sedang berjalan (`feat/idn-admin-regions-module`) yang belum mendarat di
> `main` saat ADR ini ditulis. Mengambil nomor bebas berikutnya di `main` akan
> bertabrakan dengannya. ADR tidak pernah dinomori ulang, jadi satu celah yang
> dicadangkan lebih murah daripada dua dokumen yang mengklaim identitas yang
> sama.

## Konteks

`AGENTS.md` menyatakan jalur pengembangan repositori ini dalam dua kalimat yang,
bersama-sama, melarang memulai pekerjaan fondasi di sini:

> "Fitur fondasi diuji lebih dulu di awcms-mini, baru di-port ke repo ini."
>
> "Repo ini bukan tempat merintis fitur fondasi dari nol."

Aturan itu benar untuk kondisi yang melahirkannya: `awcms-mini` adalah repo
standar tempat kapabilitas fondasi dibuktikan dengan murah, dan repo ini
menyerapnya sesudahnya lewat satu putaran rename yang terdokumentasi.

Kondisi itu tidak lagi berlaku. **Per 31 Juli 2026 maintainer telah membekukan
`ahliweb/awcms-mini` dan `ahliweb/awcms-micro` sebagai referensi-saja**: keduanya
boleh dibaca, polanya boleh disalin, kode boleh di-port _keluar_ dari keduanya —
tetapi keduanya tidak menerima perubahan. Pengembangan mendarat di `awcms` dan
`awcms-astro`.

### Konsekuensi yang memaksa lahirnya ADR ini

Pembekuan saja adalah pernyataan penjadwalan. Digabung dengan aturan mini-first
ia menjadi sesuatu yang sama sekali lain: **pekerjaan fondasi tidak punya tempat
mendarat sama sekali.**

Ini bukan hipotetis, dan ia layak dicatat justru karena ia ditemukan dengan
menabraknya, bukan dengan membaca aturannya.

`awcms-astro` saat ini tidak bisa mengambil konten dari repositori ini. Dua
cacat kontrak, keduanya diverifikasi terhadap instans staging yang hidup
alih-alih disimpulkan dari dokumentasi:

1. **Header tenant tidak cocok.** `resolveAuthInputs` membaca
   `x-awcms-tenant-id`; `awcms-astro` mengirim `X-Tenant-Code`/`X-Tenant-Id`.
   Diprobe terhadap `awcms-staging`: setiap nilai `X-Tenant-Code` mengembalikan
   `400 TENANT_REQUIRED`, sementara `x-awcms-tenant-id` sampai ke
   `401 AUTH_REQUIRED`.
2. **Tidak ada kredensial yang bisa dipegang sebuah build.** Bearer yang
   diterima `/api/v1/blog/posts` adalah token **sesi** yang di-hash. Skema repo
   ini punya `awcms_sessions` dan tidak punya tabel token mesin; `awcms-mini`
   juga tidak. `.env.example` milik `awcms-astro` menginstruksikan operator untuk
   menerbitkan "a BUILD-TIME, READ-ONLY token" yang tidak bisa diterbitkan siapa
   pun.

Memperbaiki (2) berarti sebuah konsep kredensial mesin — tanpa ragu sebuah fitur
fondasi di `identity-access`. Di bawah mini-first ia mestinya masuk ke
`awcms-mini` lebih dulu. Di bawah pembekuan, `awcms-mini` tidak boleh disentuh.
Pekerjaannya karena itu terblokir oleh irisan dua aturan yang masing-masing
secara tersendiri masuk akal.

Irisan yang sama memblokir **kontrak introspeksi sesi lintas-origin** yang sudah
diputuskan [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
dan yang oleh checklist kesiapan `awcms-astro` disebut sebagai dependensi
_keras_: tanpa itu sebuah proof-of-concept portal hanya bisa memalsukan sesi,
dan proof-of-concept yang memalsukan bagian tersulitnya tidak membuktikan apa
pun.

Jadi ini bukan preferensi tentang di mana kode terasa wajar. Ini adalah sebuah
kebuntuan, dan ia punya dua korban hidup.

## Keputusan

1. **`awcms-mini` dan `awcms-micro` adalah referensi-saja selama pembekuan
   berlaku.** Membaca dan mem-port _keluar_ tetap dianjurkan; mengirim perubahan
   _masuk_ tidak terjadi.

2. **Fitur fondasi dirintis langsung di `awcms`** selama masa itu. Jalur
   mini-first di `AGENTS.md` dan
   [`docs/awcms/alur-pengembangan-mini-first.md`](../awcms/alur-pengembangan-mini-first.md)
   **ditangguhkan, bukan dihapus** — ia berlaku kembali tanpa perubahan saat
   pembekuan dicabut.

3. **Setiap penjagaan yang dibawa rute mini-first secara implisit kini
   eksplisit.** Menghapus sebuah rute bukan menghapus pagar pengamannya.
   Pekerjaan fondasi yang mendarat di sini selama pembekuan tetap mensyaratkan,
   tanpa kecuali:
   - sebuah ADR ketika ia mengubah sebuah standar (`GOVERNANCE.md` §2);
   - review keamanan tambahan yang diwajibkan `AGENTS.md` untuk modul
     `auth`/`access`/`sync` — dan sebuah tabel kredensial mesin jelas berada di
     dalam himpunan itu;
   - `bun run check` secara penuh, termasuk `family:conformance:check`;
   - OpenAPI/AsyncAPI dijaga selaras, RLS `FORCE` di setiap tabel ber-scope
     tenant, dan ABAC default-deny di setiap endpoint non-publik.

4. **Setiap fitur fondasi yang mendarat selama pembekuan adalah divergence yang
   disengaja** dari baseline keluarga dan dicatat sebagai demikian di
   [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml)
   pada saat ia mendarat — bukan secara retroaktif. Divergence yang baru
   ditemukan ketika pembekuan dicabut adalah konflik merge yang berbaju skema.

5. **Ketika pembekuan dicabut, keputusan pertama yang harus diambil adalah
   repatriasi**: bagaimana kapabilitas yang dibangun di sini kembali ke
   `awcms-mini` sebagai baseline keluarga, termasuk arah rename
   `awcms_…` → `awcms_mini_…`, yang merupakan kebalikan dari porting yang
   terdokumentasi. Keputusan itu mendapat ADR-nya sendiri.

## Konsekuensi

**Terbuka blokirnya.** Dua kontrak yang ditunggu `awcms-astro` kini boleh
dibangun di sini: pasangan kredensial-mesin + build-feed, dan endpoint
introspeksi sesi dari ADR-0045. Keduanya mendarat di `identity-access` dan
keduanya membutuhkan kredensial mesin, jadi keduanya adalah satu percakapan
desain alih-alih dua — dan membangunnya terpisah berarti membuka jalur auth
repositori ini dua kali.

**Biaya yang diterima — utang divergence.** Setiap fitur fondasi yang
ditambahkan di sini selama pembekuan berlaku melebarkan jurang antara repo ini
dan baseline keluarga. Utang itu nyata dan ia menumpuk diam-diam, yang justru
merupakan alasan butir 4 mewajibkannya dicatat sembari ia bertambah.
`family:conformance:check` adalah yang membuat pencatatan itu tidak opsional.

**Biaya yang diterima — drift di repo referensi.** `awcms-mini` dan
`awcms-micro` berhenti mengikuti fondasinya. Nilainya sebagai _referensi_ luruh
seiring waktu; siapa pun yang membacanya untuk sebuah pola setelah tanggal ini
wajib memastikan pola itu masih berlaku di sini.

**Risiko, disebut namanya supaya bisa ditolak.** "Dirintis langsung di sini"
mudah disalahbaca sebagai "dipegang pada standar yang lebih ringan di sini". Ia
bukan begitu, dan butir 3 ada untuk membuat klaim itu sulit dilontarkan dalam
sebuah review. Rute mini-first tidak pernah menjadi satu-satunya hal yang
membuat pekerjaan fondasi aman — ia salah satu dari beberapa — dan ia
satu-satunya yang ditangguhkan.

## Alternatif yang dipertimbangkan

**Pertahankan mini-first lalu tunggu.** Ditolak: pembekuan membuat hulunya tidak
bisa menerima pekerjaan itu, sehingga "tunggu" tidak punya kondisi akhir. Itu
akan membuat `awcms-astro` selamanya tidak bisa mengambil kontennya sendiri
sementara kedua repo tampak sehat.

**Cabut pembekuan `awcms-mini` khusus untuk pekerjaan fondasi.** Ditolak: ia
bertentangan dengan direktifnya, dan ia memecah perhatian fondasi ke dua
repositori persis pada saat maintainer mengonsolidasikannya menjadi dua. Ia juga
memperkenalkan kembali langkah porting untuk setiap perubahan, yang justru
merupakan biaya yang hendak dihindari pembekuan.

**Bangun kredensial mesin di `awcms-astro` saja.** Ditolak mentah-mentah:
`awcms-astro` adalah situs publik statis tanpa basis data dan tanpa identity
store. Menaruh konsep kredensial di sana berarti menaruh penerbit token di
satu-satunya repo dari pasangan itu yang seluruh premisnya adalah tidak punya
apa pun untuk dilindungi saat runtime.
