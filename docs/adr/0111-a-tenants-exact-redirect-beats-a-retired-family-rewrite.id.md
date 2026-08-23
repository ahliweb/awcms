🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.md)

<!-- i18n-source-hash: sha256:e579d6c2a56bbd78508674ea7ab1e3c3980d81ad8a75f8b90f70ba2f5f9acf5e -->

# ADR-0111 — Redirect eksak milik tenant MENGALAHKAN rewrite keluarga `/news` yang dipensiunkan

- **Status:** Accepted
- **Tanggal:** 2026-08-23
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #599 (migrasi arsip legacy yang dikalahkannya); ADR-0039 (tata kelola redirect, pencegahan rantai/loop); ADR-0059 / ADR-0071 §4 (keluarga `/news/**` yang dipensiunkan dan inversinya); ADR-0098 (jalur blog publik ber-prefix locale); PRD §9.2 (tanpa rantai lebih dari satu hop)

## Konteks

`seo_distribution` menyelesaikan redirect publik lewat dua strategi. Strategi 1 adalah rewrite pemensiunan untuk keluarga `/news/**`: ADR-0071 menghapus empat rute itu dari repo ini dan mem-301 seluruh keluarganya ke `/blog/{tenantCode}/**`, karena URL-nya pernah hidup dan diiklankan di sitemap yang repo ini terbitkan. Strategi 2 adalah aturan eksak-path yang ditulis tenant di `awcms_seo_redirects`, diselesaikan lewat penelusur rantai berbatas.

`resolvePublicRedirect` menjalankan strategi 1 lebih dulu dan langsung mengembalikan hasilnya.

Untuk setiap jalur DI LUAR `/news/**` urutan itu tak teramati — `parseRetiredNewsPath` mengembalikan `null`, dan strategi 2 yang menjawab. Di DALAM `/news/**` urutan itu menentukan segalanya, dan menentukannya dengan salah.

### Apa yang dibayar urutan itu, secara konkret

Issue #599 memindahkan 23.906 artikel terindeks yang URL legacy-nya berbentuk `/news/{id_ber}_{slug}.html`. Pipeline yang dibangun untuknya bekerja: `sql/138` menyimpan provenance, `blog:legacy:import` mengisinya, dan `blog:legacy:redirects:import` menurunkan satu aturan eksak per artikel terbit, memeriksa tidak ada aturan yang berantai, dan membawa prefix locale ADR-0098 supaya hop-nya menjadi yang terakhir.

`isRedirectEligiblePath` MENERIMA `/news/**`, jadi aturan-aturan itu tertulis dan duduk di tabel tampak benar.

Tak satu pun bisa menyala. `parseRetiredNewsPath` mengklaim setiap jalur keluarga itu, jadi strategi 1 menjawab lebih dulu — dan yang dijawabnya adalah 301 ke `/blog/{tenantCode}/{id_ber}_{slug}.html`, jalur yang tidak dimiliki post mana pun, karena id legacy dan akhiran `.html` adalah bagian dari bentuk LEGACY, bukan bagian dari slug mana pun.

Setiap satu dari 23.906 URL akan mengarah ke 404. Itu persis keadaan yang dilarang Definition of Done #599, dihasilkan oleh kode yang ditulis untuk memenuhinya, dengan tabel redirect yang terbaca seolah migrasinya berhasil.

### Mengapa tidak ada yang menangkapnya

Presedensi itu hanya ada sebagai URUTAN dua `await` di dalam blok `try`. Bentuk itu tak terjangkau tanpa basis data, jadi tidak ada tes yang menyentuhnya, dan kedua strategi dimiliki concern yang berbeda — satu oleh pemensiunan rute, satu oleh authoring tenant — sehingga tes masing-masing modul tak punya alasan melihat yang lain. `tests/retired-news-redirect.test.ts` dan `tests/legacy-redirect-map.test.ts` sama-sama hijau sepanjang waktu, karena masing-masing benar tentang separuhnya sendiri.

## Keputusan

**Aturan eksak-path yang ditulis tenant diselesaikan SEBELUM rewrite keluarga `/news` yang dipensiunkan. Rewrite itu menjadi fallback untuk jalur yang tidak diklaim aturan mana pun.**

Yang paling spesifik menang. Aturan tenant menyebut SATU jalur dan ditulis dengan sengaja; rewrite keluarga adalah substitusi prefix borongan yang menggantikan rute yang sudah tidak ada. Ketika keduanya mengklaim satu jalur, instruksi yang disengaja adalah jawaban yang benar — presedensi yang sama yang diterapkan router mana pun untuk segmen literal di atas wildcard.

Rewrite itu tidak dilemahkan. Untuk URL yang menjadi alasan keberadaannya — rute `/news/**` milik repo ini sendiri yang sudah dihapus, yang tak satu tenant pun menulis aturan untuknya — tidak ada yang berubah: strategi 2 tak menemukan aturan, dan strategi 1 menjawab persis seperti sebelumnya.

### Keputusannya adalah NILAI, bukan urutan pernyataan

`domain/redirect-precedence.ts` memuat `chooseRedirectOutcome`, sebuah fungsi murni. Ini separuh yang memikul beban dari ADR ini, bukan kerapian: aturan yang dinyatakan sebagai urutan pernyataan adalah aturan yang tak bisa diuji tanpa menegakkan basis data, dan alasan cacat ini bertahan justru karena tak seorang pun bisa menulis tes murahnya. Sebagai fungsi ia diuji unit ke dua arah, dan `tests/redirect-precedence.test.ts` tambahan meng-assert terhadap SUMBER service bahwa fungsi itu benar-benar dipanggil dan bahwa tidak ada `return retired` dini yang merayap kembali ke atasnya.

### Fallback mengembalikan `passthrough` MILIK strategi 2

Bukan yang baru. Nilai itu membawa konteks penangkapan 404 yang memberi makan telemetri not-found; menggantinya dengan yang kosong akan diam-diam memensiunkan observasi 404 keluarga `/news`, yang muncul belakangan sebagai dasbor kosong yang tak bisa ditanggalkan siapa pun.

## Konsekuensi

- Sebuah tenant kini bisa mencegat jalur di keluarga yang dipensiunkan dengan menulis aturan untuknya. Itulah maksudnya, dan dibatasi oleh `isRedirectEligiblePath` (tidak ada jalur admin/API/auth/aset/discovery yang terjangkau) serta oleh `assertSafeRedirectTarget` pada tulis MAUPUN resolve.
- Satu transaksi tambahan pada permintaan `/news/**` yang jatuh ke rewrite. Permintaan yang dijawab aturan tenant kini melakukan LEBIH SEDIKIT round trip daripada sebelumnya, karena handler pensiun tidak lagi dikonsultasikan lebih dulu — ia dulu membuka transaksinya sendiri hanya untuk menemukan bahwa ia tak punya apa-apa untuk dikatakan.
- `blog:legacy:cutover:verify` (Issue #599 butir 4) menerapkan presedensi yang sama ini ketika memprediksi apa yang akan dilihat crawler. Verifier yang memodelkan urutan lama akan melaporkan arsipnya bersih sementara produksi mengirim setiap URL ke 404.

## Alternatif yang dipertimbangkan

**Pertahankan urutannya; buat handler pensiun memeriksa aturan eksak lalu menyingkir.** Perilakunya identik di setiap jalur, dan itu diff minimal yang menggoda. Ditolak karena menyatakan aturannya terbalik: ia terbaca sebagai "rewrite keluarga yang memutuskan, dengan pengecualian", padahal kebenarannya adalah instruksi spesifik mengungguli yang umum. Ia juga membiarkan presedensi tersebar di dua berkas alih-alih dinamai di satu tempat.

**Kecualikan jalur `/news/**` yang tidak cocok dengan bentuk rute lama repo ini.** Ditolak sebagai tebakan yang tak terpelihara — bentuk itu milik sistem yang DITINGGALKAN, dan arsip baru membawa bentuk baru, jadi aturannya perlu disunting tiap migrasi dan akan gagal diam-diam ketika tidak.

**Laporkan tabrakannya dari verifier dan jangan ubah apa pun.** Ditolak: verifier akan dengan benar melaporkan seluruh 23.906 URL rusak, dan satu-satunya perbaikan yang tersedia tetap yang ini.
