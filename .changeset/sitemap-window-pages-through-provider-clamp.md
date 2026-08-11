---
"awcms": patch
---

fix(seo): sitemap berhenti membuang senyap setiap URL setelah yang ke-200

Tenant dengan lebih dari 200 post kehilangan sisanya dari `/sitemap-{n}.xml` —
tanpa error di mana pun. Index tetap mengiklankan `ceil(count / 10 000)` anak,
tiap anak tetap balas `200 OK` dengan XML yang valid, dan satu-satunya gejala
adalah halaman yang tak pernah muncul di mesin pencari berminggu-minggu
kemudian.

Sebabnya dua angka yang tak pernah dipertemukan. `discovery-limits.ts`
menetapkan `SITEMAP_URLS_PER_PAGE = 10000` dan `buildSitemapPagePayload`
memintanya ke provider dalam **satu** panggilan; `blog-content`
(`seo-facts-port-adapter.ts`) menjepit `pageSize` ke 200. `listWindow` membaca
`page.items` sekali lalu berhenti.

**`pageSize` itu PERMINTAAN, bukan jaminan.** Itu tertulis di port sejak awal —
tiap provider boleh menjepitnya — dan halaman terjepit tidak bisa dibedakan dari
halaman yang memang habis, **kecuali** lewat `nextCursor`. Kode lama tidak
pernah melihat `nextCursor` di jalur ini, jadi 200 baris pertama tampak seperti
seluruh korpus.

Perbaikannya menyerang keduanya:

- `listProviderSlice` baru **memaging** `nextCursor` sampai jatah satu halaman
  anak terpenuhi atau providernya habis. Cursor diperlakukan **opaque**:
  dikembalikan apa adanya, tak pernah di-parse, di-encode ulang, apalagi
  dilewatkan `Date` — cursor keyset di repo ini membawa `timestamptz`
  presisi-penuh (mikrodetik) sementara `Date` hanya milidetik, jadi satu
  round-trip saja melewatkan tiap baris di dalam mikrodetik yang terpotong.
  Itu kelas cacat yang **sama persis** dengan yang sedang diperbaiki di sini,
  cuma sumbernya lain.
- `SITEMAP_URLS_PER_PAGE` turun ke **1000** — disetel terhadap apa yang port
  memang sanggup layani (5 permintaan × 200), bukan terhadap plafon protokol
  50k. `SEO_FACTS_PROVIDER_PAGE_SIZE = 200` menamai ukuran yang provider hormati,
  dan `SITEMAP_PROVIDER_REQUESTS_PER_PAGE = 50` membatasi jalannya cursor supaya
  provider yang menjepit sangat rendah (atau yang mengembalikan cursor tanpa
  henti) berharga sejumlah query tetap, bukan loop tak terbatas — pertahanan
  amplifikasi ADR-0038 §7 tidak dikendurkan untuk menambal ini.
- `offset` kini hanya menempatkan permintaan **pertama** sebuah slice; sisanya
  ditempatkan cursor sendirian. Mengirim keduanya akan melompat ganda pada
  provider yang menghormati masing-masing secara independen — port memang
  memenangkan `cursor`, tapi kebenaran satu slice tak boleh bergantung pada
  tie-break itu.

Bonus yang ikut tertutup: window yang membentang **dua provider** dulu juga
memotong ekor provider pertama, karena `remaining` hanya berkurang sebanyak
halaman terjepit sebelum pindah ke provider berikutnya.

`BLOG_CONTENT_SEO_MAX_LIST_PAGE_SIZE` kini diekspor, jadi sisi konsumen bisa
meng-assert anggaran permintaannya terhadap **angka provider yang sebenarnya**,
bukan salinannya — menurunkan jepitan itu memerahkan test alih-alih diam-diam
memotong sitemap lagi.

Regresinya dibuktikan, bukan diklaim (`tests/seo-sitemap-window-paging.test.ts`,
korpus 201 dan 1201 entri): mengembalikan window satu-permintaan yang lama
membuatnya **MERAH** dengan `Expected: 201, Received: 200` — persis satu entri
yang hilang. Providernya palsu tapi jujur pada dua hal yang menentukan: ia
menjepit `pageSize`, dan ia mencari cursor lewat pencocokan string **persis**,
sehingga round-trip `Date` gagal berisik di situ alih-alih melewatkan baris
diam-diam.
