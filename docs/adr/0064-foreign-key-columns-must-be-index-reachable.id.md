🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0064-foreign-key-columns-must-be-index-reachable.md)

<!-- i18n-source-hash: sha256:9ad3ceacb86a8eab6df46483557726b464c0a94e762d32bb5ecccbe9c15855f4 -->

# ADR-0064 — Kolom foreign key wajib terjangkau index

- **Status:** Accepted
- **Tanggal:** 2026-08-04
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §5 (temuan: nol dari 28 gerbang memeriksa performa), [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) + [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (preseden: daftar pengecualian ber-alasan, entri mati ikut gagal)

## Konteks

### 1. Gerbang repo ini tidak pernah memeriksa performa

Asesmen 4 Agustus 2026 mengukurnya: **nol dari 28 gerbang** di `bun run check`
menyentuh performa. Konsekuensi praktisnya — kolom FK tanpa index, atau query
N+1, mendarat dengan CI hijau penuh dan muncul berbulan-bulan kemudian sebagai
"layar admin jadi lambat".

### 2. Kenapa FK khususnya

Postgres meng-index sisi **REFERENCED** sebuah foreign key secara otomatis (ia
constraint unik) dan sisi **REFERENCING** **tidak sama sekali**. Kolom FK tanpa
index membayar dua kali, dan keduanya terlambat terlihat:

- setiap `DELETE`/`UPDATE` baris induk **sequential scan** tabel anak untuk
  menegakkan constraint, pada tabel yang hanya bertambah besar;
- join dari induk ke anak juga tak punya index untuk dipakai.

Diukur di repo ini: **182 kolom FK**, dan **14** di antaranya tak terjangkau
index apa pun. Satu tabel — `awcms_blog_ads` — tak punya index sama sekali di
luar primary key-nya.

### 3. Aturan ketat menghasilkan gerbang yang akan dimatikan

Aturan yang "benar" secara literal adalah **kolom FK wajib MEMIMPIN sebuah
index**, karena Postgres hanya bisa memakai PREFIX B-tree. Diukur: **40 dari
182** melanggar.

Empat puluh migrasi pada hari sebuah gerbang mendarat bukan gerbang — itu daftar
pengecualian yang menunggu ditulis. Repo ini sudah mencatat kelas kegagalan itu
tiga kali (ADR-0057 §F draf 1–3, ADR-0058 §1): pemeriksa yang menuntut terlalu
banyak melatih pembacanya menambah pengecualian sampai ia tak menanyakan apa
pun.

## Keputusan

### §A — Aturan: terjangkau index, sadar-tenant

Kolom FK dianggap **terjangkau** bila ia:

1. **memimpin** sebuah index (`(fk, …)`), **atau**
2. adalah kolom **kedua setelah `tenant_id`** (`(tenant_id, fk, …)`).

Butir 2 adalah relaksasi yang sengaja, dan alasannya spesifik untuk basis kode
ini: **setiap query ber-scope tenant membawa `tenant_id`** — RLS `FORCE`
menjamin itu — jadi composite `(tenant_id, fk)` MEMANG index yang dipakai join
tersebut. Menuntut 26 index satu-kolom tambahan akan menambah biaya tulis nyata
untuk lookup yang tak pernah dilakukan siapa pun.

**Residualnya dinyatakan, bukan disembunyikan.** Composite `(tenant_id, X)`
**TIDAK** membantu Postgres menegakkan constraint saat baris INDUK dihapus — itu
butuh lookup `X` telanjang dan akan scan. Diterima karena penghapusan induk pada
tabel-tabel ini administratif dan jarang, sementara biaya tulis 26 index dibayar
di setiap insert selamanya. Bila suatu saat penghapusan induk jadi panas,
jawabannya index untuk tabel itu — bukan aturan global yang lebih ketat.

Relaksasinya **berbatas dan diuji di kedua arah**: kolom kedua setelah sesuatu
selain `tenant_id` TIDAK terjangkau, dan kolom KETIGA setelah `tenant_id` juga
tidak. Tanpa batas itu aturannya akan menerima composite apa pun dan menemukan
nol — persis "gerbang yang terbaca sebagai cakupan sambil tak memberi apa-apa".

### §B — `sql/090` mengindeks ketiga belas sisanya

Tiga belas index additif (`IF NOT EXISTS`, nol data dipindah, nol constraint
berubah). Yang paling menonjol:

- `awcms_abac_decision_logs.tenant_user_id` — tabel dengan pertumbuhan tercepat
  di schema, dan kolom yang justru difilter audit "apa yang dilakukan user ini".
- `awcms_access_assignments.role_id` — menghapus sebuah role men-scan setiap
  baris assignment di deployment.
- `awcms_blog_ads.tenant_id` — satu-satunya tabel tanpa index apa pun.

### §C — Satu pengecualian, dan alasannya bukan "belum sempat"

`awcms_setup_state.tenant_id`. Tabel itu singleton keras
(`id boolean PRIMARY KEY` + `CHECK (id)`), jadi berisi **tepat satu baris** dan
index di atasnya murni overhead tulis melawan scan satu halaman.

Pengecualian yang **mati** — kolomnya sudah ter-index, atau bukan FK lagi — ikut
dilaporkan gagal, mengikuti ADR-0062/0063.

## Konsekuensi

**Yang didapat.** Gerbang performa pertama repo ini. Kelas cacat "FK tanpa
index" jadi merah di CI alih-alih ditemukan lewat keluhan latensi. Tiga belas
scan yang nyata hilang.

**Yang dibayar.** Tiga belas index berarti tiga belas struktur yang dipelihara
di setiap insert. Diterima: semuanya pada kolom yang di-join atau di-filter, dan
alternatifnya adalah sequential scan yang tumbuh tanpa batas.

**Yang TIDAK dilakukan.** Gerbang ini tidak mengukur rencana query, tidak
menghitung query per-endpoint, dan tidak menyentuh Core Web Vitals — ketiganya
ada di asesmen §7 sebagai butir terpisah. Ia sengaja satu aturan yang bisa
diputuskan dari teks migrasi saja, tanpa database, supaya bisa masuk rantai
`check` yang murni.

**Nol permission, nol perubahan OpenAPI, nol perubahan runtime.**
