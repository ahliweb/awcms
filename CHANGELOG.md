# awcms

## 7.0.1

### Patch Changes

- b2b6ce6: CI job `quality` kini menjalankan `bun run check` PENUH alih-alih cermin manual per-step yang sempat kehilangan 16 dari 34 gerbang di PR (di antaranya `access:permissions:enforcement:check` dan `access:chokepoint:check` — keduanya tidak pernah jalan di CI PR sejak mendarat). Bentuk cermin manual mengulang persis pelajaran PR #770; guard paritasnya (`tests/family-conformance-ci-parity.test.ts`) kini mengikat bentuk struktural anti-drift: step `run: bun run check` ber-`DATABASE_URL: ""` (pola job Validate release.yml), bukan kehadiran satu gerbang bernama.
- 5a085df: Dua celah standar ditutup dengan pemeriksanya: kompresi yang diwarisi kini
  dinyatakan, dan CodeQL berhenti mengklaim `.astro`.

  **C3 — kompresi diwarisi dari lapisan yang repo ini tak miliki.**
  `security:readiness` memuat `checkResponseCompressionOwnership`: ia memindai
  lima lapisan yang repo ini KIRIM (`src/middleware.ts`, `astro.config.mjs`,
  `infra/varnish/default.vcl`, `infra/varnish/docker-compose.varnish.yml`,
  `Dockerfile.production`) dan, karena tak satu pun mengompresi, menuntut blok
  bertanda `kompresi-tepi` di `docs/awcms/environments.md` menyebut tier
  pengompresi (Cloudflare) beserta akibatnya: deployment di luar CDN pengompresi
  menyajikan seluruh teks tanpa kompresi. Cabang pertama resep C3 (memindahkan
  kompresi ke sini) sudah **dicabut** asesmen §9.3 — kompresor kedua adalah dua
  tempat yang memutuskan hal yang sama. Yang ditutup adalah ketidakterlihatannya;
  repo ini tetap tidak mengompresi apa pun, dan tidak ada gerbang yang melihat
  lapisan luarnya. Dua arah dibuktikan `tests/security-readiness-compression.test.ts`:
  blok dihapus/dikosongkan/penanda separuh → MERAH; kompresi menyala di lapisan
  yang dikirim → pemeriksa menyebut `berkas:baris` dan menuntut blok ditulis
  ulang; komentar `do_gzip` dan `Vary: Accept-Encoding` tidak dihitung sebagai
  kompresi.

  **C16 — `codeql.yml` mengklaim memindai "TypeScript/Astro source".** CodeQL
  tidak punya ekstraktor Astro, jadi 42 berkas `.astro` (22.328 baris — permukaan
  yang sama yang C4 sebut) berada di luar setiap pemindaian sementara komentar
  repo menyatakan sebaliknya. Langkah `State coverage` kini menulis ke ringkasan
  run berapa berkas dianalisis dan berapa `.astro` TIDAK, dihitung `git ls-files`
  saat run; komentar matriksnya berhenti mengklaim Astro. Dijaga
  `tests/codeql-coverage-statement.test.ts`: langkah hilang, angka ditulis
  tangan, atau klaim Astro kembali → MERAH. Postur keluarga kini satu kalimat —
  `.astro` tidak teranalisis statik di repo mana pun, dan kedua repo
  mengatakannya sendiri.

  Tidak ada perubahan perilaku runtime: `security:readiness` bertambah satu
  pemeriksa `warning` (tidak pernah memblokir go-live), dan `codeql.yml`
  bertambah satu langkah ringkasan.

- 2812720: Bangun ulang graf pengetahuan graphify: `graph.json` kini membawa nama komunitas, dan cakupan `.sql` dipulihkan

  Artefak di `graphify-out/` — bukan kode runtime. Tidak ada perubahan perilaku aplikasi, API, skema, atau permission; tingkat `patch` dipakai karena gerbang `changesets:policy:check` menuntut satu tingkat bump eksplisit dan tidak menerima changeset kosong.

  Graf terakhir dibangun 29 Juli, 88 commit yang lalu. Rebuild inkremental atas 409 file berubah dan 35 terhapus membawanya dari 8.247 ke 9.574 node, 24.098 ke 26.456 edge, 495 ke 570 komunitas.

  Tiga cacat senyap ikut tertutup:

  - **`graph.json` tidak membawa `community_name` sama sekali.** Ia dibangun sebelum langkah pelabelan menulis label kembali ke sana, jadi `graphify query`, server MCP, dan konsumen GraphRAG mencetak `community=27` alih-alih nama komunitas — sementara label kurasinya hanya hidup di `.graphify_labels.json`, yang tidak ter-track. Sekarang 570 dari 570 node bernama di dalam artefak yang ter-track, sehingga label bertahan di clone baru.
  - **Sidecar `.graphify_labels.json.sig` sudah basi dua hari terhadap labelnya** dan hanya cocok untuk 6 dari 495 komunitas. Satu jalannya `cluster-only` akan menamai ulang 489 komunitas memakai nama file hub dan menghapus nama kurasi tanpa peringatan apa pun. Sekarang cocok 570 dari 570.
  - **`tree_sitter_sql` hilang setelah pemutakhiran graphify 0.9.27 → 0.9.35,** sehingga setiap berkas `.sql` menyumbang nol node sementara ekstraksi tetap melapor sukses. Di repositori yang tulang punggungnya `sql/NNN`, itu lubang cakupan, bukan kekurangan kosmetik.

  Label lama juga mengandung cacat yang persis dilarang aturan penamaan komunitas: dua pasang duplikat dan 43 dari 495 berbentuk nama berkas — sisa penamaan hub otomatis. Seluruh 570 label ditulis ulang dan diverifikasi nol hilang, nol duplikat, nol berbentuk nama berkas. Pemeriksaan integritas graf bersih, dan `--update` sesudahnya melaporkan nol berkas berubah.

- b5d6be2: Artefak graphify berhenti menuntut changeset, dan permukaan render-nya berhenti mengintai untuk ikut ter-commit

  Tiga pembenahan kebersihan repositori di sekitar `graphify-out/`, tidak satu pun menyentuh perilaku aplikasi.

  **Gerbang changeset mengecualikan tiga artefak graf yang ter-track.** Sebelum ini setiap pembangunan ulang graf harus mengarang changeset `patch`, sehingga penyegaran artefak murni menaikkan versi rilis dan menulis baris changelog yang tak bisa ditindaklanjuti pengguna paket mana pun. `graph.json`, `manifest.json`, dan `cost.json` kini dikecualikan — `GRAPH_REPORT.md` sudah lebih dulu lewat pola `.md`.

  Pengecualiannya **dienumerasi, bukan `/^graphify-out\//`**, dengan alasan yang sama membuat temuan security-auditor di PR #715 mempersempit entri `.claude/`: pengecualian se-direktori juga menutupi apa pun yang dijatuhkan proses lain ke sana kelak. Berkas artefak keempat harus melewati daftar ini secara sengaja, bukan mewarisi pengecualian yang tak pernah ditinjau untuknya. Sebuah test membuktikan kesempitan itu: melebarkan pola menjadi se-direktori membuat test merah, dan hanya test itu.

  **Empat artefak render graphify masuk `.gitignore`.** `graph.svg`, `graph.graphml`, `GRAPH_TREE.html`, dan `*-callflow.html` berjumlah 49 MB pada graf 9.574 node, melawan 15 MB milik `graph.json`. Melacaknya akan melipatempatkan lebih dari apa yang ditambahkan setiap penyegaran graf ke riwayat selamanya, dan tiap berkas membusuk dengan cara yang sama seperti `graph.html` — yang sudah lebih dulu diabaikan dengan alasan tertulis yang sama. Semuanya satu perintah dari regenerasi.

  **`graphify-out/.graphify_labels.json.sig` tidak lagi dilacak.** Aturan `.gitignore` `graphify-out/.*` bermaksud mengeluarkannya sejak awal, tetapi aturan tidak bisa membatalkan pelacakan berkas yang sudah terlanjur ter-commit. Salinan yang ter-track hanya bisa basi: ia adalah tanda tangan keanggotaan komunitas yang berpasangan dengan `.graphify_labels.json`, yang memang tak pernah dilacak — jadi sebuah clone menerima tanda tangan tanpa label yang ia jelaskan. Nama komunitas tetap aman di `graph.json`, yang membawanya per-node.

- ce99272: Impor dataset wilayah menulis SQL NULL, bukan string `"null"`. `tx.array(values, "text")` tidak bisa membawa NULL — Bun menyerialkan elemen `null` menjadi teks empat karakter `"null"` (diprobe terhadap PostgreSQL 18.4 di Bun 1.3.14; varian tanpa tipe pun bukan NULL). Akibatnya impor nyata mengisi setiap kolom nullable dengan `'null'`: 38 provinsi ber-`parent_code` `'null'` dan 7.285 kecamatan ber-`local_term` `'null'`, yang dirender apa adanya oleh layar lookup dan membuat filter `IS NULL` mengembalikan nol baris. Nilai null kini melintas sebagai sentinel dan dipulihkan `NULLIF(t.col, '')` di SELECT — benar juga bila Bun kelak mengirim NULL sungguhan. Digerbangi test integrasi yang hanya bisa merah di database nyata.
- ebd4b1b: Artefak rilis bertahan lebih lama dari gerbang persetujuan yang menunggunya

  `release.yml` mengunggah SBOM, tarball sumber, dan checksum dengan `retention-days: 1`, lalu menggantung job penerbitan di balik gerbang environment `release` yang **tidak punya batas waktu sama sekali**. Setiap persetujuan yang datang lebih dari 24 jam setelah build karena itu menerbitkan apa-apa: artefaknya sudah hilang.

  Itu bukan skenario teoretis. Run v7.0.0 mati persis begitu — build selesai 5 Agustus 08:43 UTC, artefaknya kedaluwarsa 24 jam kemudian, dan persetujuan yang tiba 8 Agustus langsung menabrak `Artifact not found for name: release-artifacts`. Yang membuatnya mahal: tidak ada satu pun kalimat di teks kegagalan yang menyebut retensi, jadi kegagalannya terbaca seperti masalah unggah, bukan seperti run yang sudah tidak mungkin diterbitkan sejak dua hari sebelumnya. Rilis itu menggantung 63 jam sebelum ada yang menyentuhnya, dan pada jam ke-24 ia sebenarnya sudah mati.

  Retensi dinaikkan ke 30 hari — sama dengan batas GitHub sendiri untuk berapa lama sebuah run boleh menunggu persetujuan. Dengan begitu setiap gerbang yang masih bisa disetujui punya artefak untuk disetujui, dan kedua batas itu berhenti saling bertentangan.

  `ci.yml` memakai `retention-days: 5` dan tidak diubah: tidak ada job di sana yang menunggu di balik gerbang, jadi retensinya tidak pernah berlomba dengan keputusan manusia.

- bcd5422: Catatan rilis dipotong ke batas body GitHub alih-alih menjatuhkan penerbitan

  `release.yml` menyalin satu seksi `CHANGELOG.md` mentah-mentah menjadi body GitHub Release. GitHub menolak body di atas 125.000 karakter dengan `HTTP 422: body is too long` — dan penolakan itu datang **setelah** penandatanganan, attestation, dan push image semuanya berhasil. Hasilnya run yang mati dengan image tertandatangani dan ter-attest di registry, tetapi tanpa rilis yang menunjuk kepadanya.

  v7.0.0 gagal persis di sini: seksinya 186.449 karakter, 49% di atas batas. Ini juga bukan kejutan mendadak — v6.0.0 sudah 103.262 karakter, jadi langit-langitnya sudah didekati beberapa rilis tanpa ada apa pun yang melaporkan jaraknya.

  Sekarang langkah ekstraksi mengukur hasilnya dan memotong bila perlu, menyisipkan pemisah plus tautan ke `CHANGELOG.md` pada tag itu supaya teks utuhnya selalu satu klik jauhnya. Anggarannya dihitung dalam **byte** melawan langit-langit **karakter**: untuk UTF-8 byte selalu lebih besar atau sama dengan karakter, jadi anggaran byte hanya bisa terlalu berhati-hati, tidak pernah melampaui. Pemotongan mundur ke batas baris terakhir supaya body tak pernah berakhir di tengah karakter atau di tengah markdown.

  Diuji terhadap seksi v7.0.0 yang sesungguhnya: 186.449 byte turun menjadi 117.351 karakter, UTF-8 utuh, berakhir rapi. Seksi berukuran normal (v6.4.0, v6.3.0, v6.0.0) melewatinya tanpa disentuh.

## 7.0.0

### Major Changes

- 611286f: **Security / breaking:** region-dataset activation and rollback become operator jobs; their HTTP endpoints are removed and their permissions revoked.

  `POST /api/v1/idn-regions/datasets/{id}/activate` and `POST /api/v1/idn-regions/datasets/rollback` both swapped the Indonesia administrative-region dataset served to **every** tenant — those tables are global, with no `tenant_id` and no RLS. But `sql/081` seeded their permissions (`idn_admin_regions.dataset.configure` / `.restore`) into the **global** ABAC catalogue, and `POST /api/v1/setup/initialize` grants the whole catalogue to each new tenant's `owner` role. So an ordinary tenant owner held authority over data served to other tenants, and ABAC could not see anything wrong: it evaluates the permission, not who the action ultimately affects.

  Replaced by `bun run idn-regions:activate -- --dataset <code|uuid>` and `bun run idn-regions:rollback`, both dry-run by default and writing only with `--commit`, running as `awcms_worker`. This matches `bun run idn-regions:import`, which ADR-0046 §5 had already made job-only for the identical reason: a global action has no request-time tenant subject for an ABAC guard to evaluate.

  `sql/084` revokes both permissions and any role grants that already reference them. Two permissions remain for this module, both genuinely read-only: `region.read` and `dataset.read`.

  **Breaking:** two OpenAPI paths are removed. No consumer existed — no screen in this repo called them, and a repo-wide search found no caller.

  **Accepted cost, stated rather than hidden:** these actions no longer write an `awcms_audit_events` row. That table is tenant-scoped while the action is global; the old row landed in whichever tenant's log the clicking owner belonged to, misrepresenting a global change as that tenant's and staying invisible to every other affected tenant. Evidence now lives on the dataset row itself (`status`, `activated_at`, `activated_by`) plus the command's own output. A correct cross-tenant audit needs a global log this base does not have yet.

  See ADR-0052.

### Minor Changes

- dc54236: ADR-0044 §4 Fase 2, langkah pertama: `awcms_news_portal_ad_placements` kini
  punya targeting (`target_type` global/widget/post/page + `target_id`), sehingga
  ia bisa menyatakan segala yang bisa dinyatakan sistem iklan free-URL yang akan
  dipensiunkan.

  Penggabungan ADR-0044 meninggalkan `blog_content` memiliki DUA sistem iklan,
  masing-masing punya kemampuan yang tidak dimiliki lawannya. Yang lama menerima
  `image_url` bebas — URL apa pun, tanpa registry media — tetapi bisa menarget
  post dan page. Yang baru mengikat `media_object_id` sebagai foreign key ke objek
  media terverifikasi, tetapi setiap barisnya efektif site-wide.

  Yang berbasis media adalah yang bertahan, karena `image_url text` persis
  merupakan jalan pintas yang dituju ADR-0036 saat membalik kepemilikan media.
  Tetapi menghapus yang lama LEBIH DULU akan diam-diam memusnahkan targeting
  per-post dan per-page — iklan yang dibeli untuk satu artikel berhenti muncul,
  tanpa satu pun error. Karena itu pelebaran ini berdiri sendiri, sebelum satu
  baris pun dipindahkan.

  Migrasi 078 SENGAJA tidak memindahkan data dan tidak menghapus tabel. Ingest
  `awcms_blog_ads.image_url` ke `media_library` (dengan laporan residu yang bisa
  di-dry-run) dan penghapusan kedua tabel lama adalah langkah terpisah
  berikutnya, dalam urutan itu.

  - `placement_key` tetap SLOT (di mana pada halaman); `target_type`/`target_id`
    adalah SCOPE (halaman mana). Keduanya ortogonal.
  - Render sebuah halaman mengembalikan iklan bertarget halaman itu DIGABUNG
    dengan setiap iklan `global` untuk slot yang sama — perbaikan yang disengaja
    atas sistem lama yang mencocokkan satu scope persis dan menyerahkan
    penggabungan ke pemanggil.
  - Aturan berpasangan (`target_id` wajib untuk tipe bertarget, terlarang untuk
    `global`) adalah CHECK di basis data, bukan hanya di validator seperti tabel
    lama. Diuji dengan INSERT sebagai peran admin — penulis yang persis tidak bisa
    dijangkau aturan tingkat-aplikasi.
  - `target_id` polimorfik (post/page/widget), jadi tidak ada foreign key yang
    bisa menjangkaunya. Keberadaannya diperiksa saat tulis; target yang dihapus
    KEMUDIAN bukan error dan tidak pernah menjadi error — barisnya sekadar
    berhenti cocok.
  - Baris yang ditulis dengan bentuk pra-078 bernilai `global`, jadi tidak ada
    iklan lama yang berubah perilakunya. Dibuktikan terhadap PostgreSQL 16 nyata,
    bukan disimpulkan dari default kolom.

- 52e333a: Add the `/admin/approvals` inbox and put `workflow_approval` in the admin sidebar.

  The module shipped a complete engine — graph definitions, quorum, delegation, escalation, administrative recovery — and no screen, so every approval in this base could only be decided with `curl`. Under ADR-0051 the screen belongs here.

  The inbox lists tasks with the same filters the JSON route accepts (status, workflow key, resource type, overdue, safe search) over keyset pagination, and offers approve/reject, reassign and force-decision per row, a per-instance history panel carrying the cancel action, and the delegation ledger with create and revoke. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially; instance history is fetched only when `?instance=` names one, because doing it per row would be up to 100 queries for a list nobody expanded.

  Writes go to the guarded endpoints, all six with a fresh `Idempotency-Key` per click — unlike `/admin/reporting` there is no exception here, because every one of them requires the header.

  Cancel sits on the instance panel rather than the task row: cancelling ends the whole instance and every pending task under it, so offering it beside a single task would misrepresent its blast radius.

  `tests/admin-approvals-page-contract.test.ts` pins the page's eight permission keys against what the routes enforce and the descriptor declares. Two traps are specific to this module and both would deny every caller while reading perfectly: the permission namespace is `workflow`, not `workflow_approval` (the directory, README and descriptor name all say the latter), and approve/reject share one permission — `approval.approve` is the ability to decide, not its direction, and `approval.reject` is seeded nowhere.

  The six `definition.*` permissions are deliberately left to their own screen: authoring a node graph needs a real editor, and a raw-JSON textarea that accepts a malformed graph until publish rejects it is a worse affordance than none. The contract test asserts they stay off this page, so the split remains a decision rather than a gap.

  `MAX_REASON_LENGTH` — written out as a bare `500` in five separate files — moves to `workflow-approval/domain/reason-bounds.ts`, imported by all of them and by the form that renders it as `maxlength`.

  Also corrects `workflow-approval/README.md`, which described an `/admin/workflows` page that never existed in this repo.

- 4b998bf: feat(blog-content): `/admin/blog-pages` — the page console (ADR-0057 step 3)

  Completes ADR-0057. The screen drives **all eight** `pages.*` permissions —
  `read`/`create`/`update`/`publish`/`archive`/`delete`/`restore`/`purge` — four
  of which had no surface at all until the previous change, and so no screen
  could have driven them.

  Two views, because delete and archive are different axes: the default lists
  live pages, `?view=deleted` lists the bin. Control placement follows what each
  endpoint accepts — Restore on bin rows, Publish/Archive/Delete on live rows,
  Purge on both. `listBlogPagesForAdmin` gains the `deletedOnly` filter that makes
  the bin reachable.

  `pages.update` is driven through the structure fields this screen owns (title,
  slug, page type, menu order), not a body editor. Re-parenting is deliberately
  absent: the API performs no cycle detection, and a control that can make a page
  its own ancestor is worse than none.

  The status filter offers the three states a page can reach, not all five —
  there is no `pages.schedule` and no review queue.

  Sidebar gains a second `blog_content` entry, gated on `pages.read` rather than
  `posts.read`.

- c0163b1: Add the `/admin/blog` post lifecycle console and put `blog_content` in the admin sidebar.

  `blog_content` is the largest module in this repo — 43 permissions across 15 activity codes and ~30 route files — and until now it had no screen at all. Under ADR-0051 the screens belong here; this is the first, and it covers the surface an editor uses every day.

  The console lists posts with the module's own admin search/status filters and page-number pagination, and drives eleven permissions: `posts.read`/`create`/`update`/`publish`/`schedule`/`archive`/`delete`/`restore`/`purge` plus `revisions.read`/`restore`. Reads go through `listBlogPostsForAdmin` and `listBlogRevisions` inside one `withTenantOrThrow`, awaited sequentially; revisions are fetched only when `?post=` names one. Every mutation posts to the guarded endpoint.

  Pagination is page-number rather than keyset, which is the opposite of `/admin/approvals` — deliberately. `listBlogPostsForAdmin` is LIMIT/OFFSET by design for a human-browsed table with "page 2, 3" controls, and its own header comment records that choice.

  The other 32 permissions belong to sibling screens that are not in this change (pages, taxonomy, templates/menus/widgets, settings/seo/theme, internal links, homepage sections, ad placements). Two absences are different in kind, and `tests/admin-blog-page-contract.test.ts` asserts both rather than leaving them to look like gaps:

  - **`posts.export` is declared and seeded by `sql/036`, and no endpoint anywhere enforces it.** The test proves this by scanning every route under `src/pages/api/v1/blog/`, so a future export endpoint fails it and forces the screen question to be answered instead of missed.
  - **`search.read` has a route and the page still does not use it.** The admin list already searches by title `ILIKE`, which tolerates the empty query that the `websearch_to_tsquery` surface behind `search.read` rejects.

  There is also no body/content editor: authoring a post body needs a rich-text surface plus SEO fields, terms and featured media. `posts.update` is still driven, through "submit for review".

  The module-specific trap the contract test pins: `submit-review` is gated on `posts.update`, not a `posts.submit` or `posts.review` — neither is seeded anywhere — and that route builds its guard in two pieces, so a regex over guard triples cannot see it and the test asserts it directly. Idempotency splits too: six lifecycle mutations require an `Idempotency-Key`, while `POST /api/v1/blog/posts` requires none by documented design, because a retry duplicating a create is caught by the `(tenant_id, locale, slug)` partial unique index.

  `MAX_TITLE_LENGTH`/`MAX_EXCERPT_LENGTH` are now exported from `content-validation.ts` so the form's `maxlength` comes from the same constants the validator enforces.

  Also corrects `blog-content/README.md`, whose §Admin UI described a fifteen-screen `/admin/blog/*` tree that never existed in this repo. It is kept, clearly marked as the awcms-mini specification, because it is a useful target for the sibling screens.

- 9e0da39: `/admin/blog-presentation` — templates, menus, widgets and theme, the fourth
  blog console.

  Four activities on one screen because they answer one question (how the blog
  looks) and each is a short bounded list. `?section=` reads only the section
  being shown, and a section the operator cannot read is not offered at all.

  The eight permissions are gated as four INDEPENDENT pairs: holding
  `widgets.configure` must not reveal a template control.

  Three deliberate absences, each mutation-proven:

  - **menu ITEMS are not editable.** `PATCH /api/v1/blog/menus/{id}` replaces the
    whole item list, so a flat form would delete every item it did not render.
    The client never sends the key at all;
  - **no "revert to tenant default" for the theme.** `upsertBlogThemeSettings`
    only INSERTs or UPDATEs and no delete route exists, so an override is
    one-way. The screen states that instead of offering a control that cannot
    succeed;
  - **no bin, no Restore.** Templates, menus and widgets all soft-delete with no
    counterpart and no `*.restore` permission to build one against.

  `key` is sent on create and never on update, because the update inputs have no
  `key` field.

- e20c942: `/admin/blog-taxonomy` — the categories-and-tags console, third sibling of
  `/admin/blog` and `/admin/blog-pages`.

  Drives both `taxonomies.*` permissions. `configure` gates create, update AND
  delete together, because `sql/036` seeds no per-verb rows — the permission is
  the capability "manage taxonomy", not one flag per verb, and a screen that
  invented `taxonomies.create` would gate on authority nothing honours.

  Three deliberate absences, each held by the contract test:

  - **no bin view and no Restore.** Term soft delete is one-way BY DESIGN (no
    restore route, no `taxonomies.restore` to build one against), so a bin would
    imply a way back that does not exist. The confirmation states the finality
    instead — copy promising recoverability is what made #351 hard to see;
  - **no re-parenting on edit.** Neither term route detects cycles, so pointing a
    parent at its own descendant is accepted and every reader then walks forever.
    Create still offers a parent: a term with no children cannot close a loop;
  - **no `Idempotency-Key`.** None of the three term endpoints reads it.

- 5368c23: Add the `/admin/domain-events` operator console and put `domain_event_runtime` in the admin sidebar.

  The module shipped consumers, deliveries, retry/dead-letter and replay with no screen, so the only way to see why an event never arrived — or to unstick it — was `curl`. Under ADR-0051 the screen belongs here.

  All five of the module's permissions are driven from this one page: the consumer registry with pause state and backlog counts (pause/resume), the delivery list filtered by status/consumer/event type with replay on dead-lettered rows, and the outbox itself with a payload inspector. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially; every mutation posts to the guarded endpoint.

  The interesting part is the idempotency split, which the screen reproduces exactly: `replay` sends an `Idempotency-Key` because each call does new work (it enqueues another attempt), while `pause` and `resume` send none because setting a flag twice has the same end state — `resume` takes no body at all. Sending a key to `pause` would imply a replay contract that endpoint does not have; omitting it on `replay` would render a button that always fails with `IDEMPOTENCY_REQUIRED`.

  `tests/admin-domain-events-page-contract.test.ts` pins all five permission keys against what the routes enforce and the descriptor declares, pins the three-way idempotency split per request rather than as a global count, and asserts the endpoints themselves still disagree the way the page assumes. The module-specific trap: pause and resume are opposite actions sharing ONE permission, `consumers.manage` — `consumers.pause` and `consumers.resume` read better and are seeded nowhere, so inventing them would hide both buttons from every operator including the owner.

  `MAX_REASON_LENGTH`, written out twice, moves to `domain-event-runtime/domain/reason-bounds.ts`.

- 05c247c: Add `/admin/media` and put `media_library` in the admin sidebar — the last module in this base without a screen.

  It was listed for two waves beside modules that were genuinely only missing a page, and that was wrong for this one. [ADR-0056](docs/adr/0056-media-library-admin-surface.md) found that five of eleven permissions were enforced by nothing, five application functions had zero callers, and there was **no list function at all** — so this screen could not have been built on the surface that existed, whatever the permission catalog said. `attach`/`detach` were revoked (§A), `delete`/`restore`/`purge` got endpoints (§B), and the browse listing got its own function and route (§C). This is what those three were for.

  The console browses with §C's filters — status, mime type, and the three-way `live`/`deleted`/`all` — then deletes, restores, and purges. Reads go through `listMediaObjects` inside one `withTenantOrThrow`; writes post to the guarded endpoints, each with a fresh `Idempotency-Key`. Unlike `/admin/blog` there is no opt-out, and unlike `/admin/sync` there is no endpoint that declines the header: all three here require it.

  **Three deliberate absences**, each pinned by `tests/admin-media-page-contract.test.ts` so they stay decisions rather than becoming gaps:

  - **Upload** (`media.create`/`.verify`/`.cancel`) — a three-step browser flow (create session → PUT the bytes straight to R2 → finalize) with real file input, progress, and client-side failure modes. A button that starts a session this page cannot finish leaves a `pending_upload` row behind on every misclick, which is precisely the litter the reconciliation job exists to clean up.
  - **`enforcement.read`/`.enable`** — a tenant-wide, ONE-WAY content policy switch, not an object action. It belongs on `/admin/security` with the other policy controls; offering it beside a row of files would misrepresent its blast radius.
  - **No `<img>` preview.** A registry row can be `pending_upload` or `failed` — the bytes may be absent, unverified, or the very thing an operator is here to delete. Rendering them is how a policy-violating image gets shown one more time, to the person removing it.

  The delete prompt asks for a real reason rather than sending a placeholder, because it lands on an audit row that outlives the object, and its `maxlength` comes from the constant the validator enforces. Purge is the only irreversible action and is the only one behind a `confirm`. It is also the only failure this screen names specifically: `MEDIA_OBJECT_REFERENCED` gets "remove that reference first" rather than "please try again", because retrying will never succeed while the foreign key is live.

  **This closes ADR-0021's first criterion.** `idn-admin-regions` is now the only module without a screen, and that is a documented decision (ADR-0052 moved its lifecycle to operator jobs). The contract test asserts it repo-wide, so the next module to land without `navigation` turns CI red instead of quietly becoming a second exception.

  Mutation-proven four ways: gating a control on the revoked `media.detach`, dropping one mutation's `Idempotency-Key`, rendering a preview `<img>`, and removing the navigation entry each turn it red.

- 821387b: Add the `/admin/reporting` console and put `reporting` in the admin sidebar.

  `reporting` had seven permissions and, between them, one page: `/admin` renders four of its five dashboard views. Everything Issue #753 built — the projection registry, live freshness, rebuild, reconciliation, scheduled exports and artifact download — had no screen at all, and neither did `email-health`, the fifth dashboard view. All of it was reachable only by `curl`. Under ADR-0051 the screen belongs here.

  The console renders each registered projection with its live freshness status, metric values and most recent reconciliation, plus rebuild history, scheduled-export management, on-demand export, and the export-run history with checksum-verified download links. It deliberately does not repeat the four aggregations `/admin` already shows; a projection links to its own `drillDownPath` instead.

  Reads reuse this module's own application functions inside one `withTenantOrThrow` transaction, awaited sequentially. `listProjectionSummariesForTenant` is handed the caller's real granted-permission set, so the per-descriptor `requiredPermission` filter stays honest on this path too. Writes go to the guarded `/api/v1/reports/*` endpoints — five with a fresh `Idempotency-Key` per click, `reconcile` with none, because that endpoint mutates no business state and requires none.

  `tests/admin-reporting-page-contract.test.ts` pins all seven permission keys against what the routes enforce and the descriptor declares. Three plausible-but-wrong guesses would each have rendered a control that denies every caller including the owner: `projections.cancel` for cancelling a rebuild (it is `projections.rebuild`), `projections.read` for reconciling (it is `projections.analyze`), and `exports.configure` for triggering an export (it is `exports.export`).

  `MIN_EXPORT_INTERVAL_MINUTES` / `MAX_EXPORT_INTERVAL_MINUTES` / `MIN_REASON_LENGTH` / `MAX_REASON_LENGTH` move to `reporting/domain/operator-input-bounds.ts` and are now imported by both the three routes that validate them and the form that renders them as `min` / `max` / `maxlength`, so the browser cannot accept what the server rejects.

  Also corrects `reporting/README.md`, which described an `/admin/reporting/projections` page and a `submitJson` helper that never existed in this repo.

- 48d5bcb: Add `/admin/security` — the screen for authentication policy that the endpoints
  have been waiting for since #184/#185.

  Tenant auth policy (password/SSO/break-glass/JIT/allowed domains) and MFA
  enforcement have been fully implemented and guarded for two releases, reachable
  only by hand-writing `curl`. This renders them: deployment posture (read-only),
  the tenant authentication policy, MFA enforcement level, and a read-only list of
  configured OIDC providers.

  **It adds no enforcement of its own.** Every mutation posts to the real endpoint
  and inherits its ABAC guard, its break-glass rule and its audit row. The
  permission checks decide what to render, never what is allowed.

  **The gates reuse the endpoints' exact permission keys** — including
  `mfa_admin.reset` as the MFA _read_ gate, which reads like a mistake and is
  precisely what `GET /api/v1/auth/mfa/policy` requires. Inventing a friendlier
  `mfa_admin.read` that no migration seeds would hide the section from everyone
  including the owner, which is the latent-authz bug this repo has already shipped
  twice. `tests/admin-security-page-contract.test.ts` extracts the guard triples
  from the route sources and the `permissionKey(...)` triples from the page and
  requires the second to be a subset of the first; mutation-proven — swapping in
  `mfa_admin.read` turns three tests red.

  **Deployment posture is shown because the tenant policy cannot be judged without
  it.** `ssoRequired` with `AUTH_SSO_ENABLED=false` produces a tenant nobody
  outside the break-glass list can sign into, and that contradiction was
  previously invisible from any screen. It now renders as a warning. No key or
  secret value is displayed — only whether a control is active.

  **The break-glass picker deals in identity ids**, not tenant_user ids: the
  policy column stores identity ids, both are uuid, and passing the wrong one is
  accepted by the endpoint, filtered out as ineligible, and saved as an empty
  list — a silent no-op exactly where an operator is trying to keep themselves
  able to log in. New `listBreakGlassCandidates` uses the same predicate as
  `fetchEligibleBreakGlassIdentityIds`, and an integration test pins the two
  together across inactive identities, inactive memberships, locked identities and
  cross-tenant rows, so the picker can never offer an option the save path
  discards.

  `409 BREAK_GLASS_REQUIRED` surfaces verbatim rather than collapsing into a
  generic failure: the caller is already an authenticated admin holding
  `sso_policy.update`, so it leaks nothing they cannot read directly, and a
  generic message would leave them retrying the one change the server will never
  accept.

  OIDC provider CRUD stays API-only — a form that posts a client secret deserves
  its own change.

- b993159: Render the admin sidebar from the module registry instead of a hand-written array.

  `ModuleDescriptor.navigation` was already synced to `awcms_module_navigation`
  and served by `GET /api/v1/modules`, while `AdminLayout.astro` rendered a
  separate static list. Nothing compared them and both had rotted: three declared
  entries pointed at admin pages that do not exist (`/admin/blog`, two
  `/admin/news-portal/*`) and were being published as valid menu items, while
  eight pages that do exist were unknown to the registry.

  The sidebar now composes from `listModules()` through the new
  `module-management/domain/sidebar-menu.ts` (ported from awcms-micro, without
  its per-tenant override tables). Tenant-disabled modules and the caller's
  permissions both filter it, so an operator no longer sees links to screens that
  will only deny them. `tests/admin-navigation-registry.test.ts` binds
  declarations to the filesystem in both directions.

  `AdminLayout`'s `active` prop is gone — the current entry derives from the
  request path, which cannot disagree with itself the way `/admin/comments` did
  (it never passed one and was never highlighted).

- 16cf031: Add the `/admin/sync` operator console and put `sync_storage` in the admin sidebar.

  The module shipped node management, conflict resolution and the object upload queue with no screen, so an operator could see on the dashboard that sync was unhealthy and had no way to act on it except `curl`. `application/sync-directory.ts` has named "the future `/admin/sync` SSR page" in its own header comment since it was written. Under ADR-0051 this is that page.

  All six of the module's permissions are driven here: the node list with activate/deactivate, the conflict list with the three resolutions and an optional note, and the object queue with retry on `failed` entries, keyset-paginated. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially.

  `fetchSyncConflicts` is new in `sync-directory.ts`, and `GET /api/v1/sync/conflicts` now calls it too — the query used to be inline in that route, which was fine while it was the only reader; a screen that re-wrote it would be free to drift from the endpoint it is meant to mirror. The endpoint keeps its exact wire format: `fetchSyncConflicts` returns `null` for an unresolved conflict's resolution fields, and the route maps them back to `undefined` so they stay absent from the JSON rather than becoming `null` — that is a contract change, not a refactor.

  **None of the three mutations sends an `Idempotency-Key`**, because none of the endpoints requires one: all three are naturally idempotent state transitions (`status = 'active'`, `'resolved'`, `'pending'`) rather than requests that do fresh work per call. Sending one would imply a replay contract they do not have. `tests/admin-sync-page-contract.test.ts` pins that in both directions, so an endpoint that later starts requiring a key turns the contract red instead of failing silently at runtime.

  The HMAC node protocol (`push`/`pull`/`objects`/`status`) gets no controls, and the test asserts the page never names those paths: they authenticate a node by signature, not an administrator by session, so a button for them would be a control no browser can legitimately use and whose failure would read as a bug rather than a category error.

  The module-specific latent-authz trap the test also pins: resolving a conflict is `conflict_resolution.approve`. Both `conflict_resolution.resolve` and `.update` read better than the permission that exists, and neither is seeded anywhere.

- 2c722ee: Add the `/admin/audit-trail` viewer and put `logging` in the admin sidebar.

  `logging` has exactly one HTTP surface (`GET /api/v1/logs/audit`) and had no screen, so the tenant's audit history — the record of every high-risk action the system takes — was readable only by `curl`. For the module whose whole purpose is accountability, that is a poor place to have no UI.

  The screen lists events newest-first with a resource-type filter and a per-event detail disclosure (correlation id + the already-redacted `attributes`, rendered as escaped text, never as HTML). It is read-only and ships **no client script at all**: the audit trail is append-only by design, so the filter is a plain `method="get"` form that works with JavaScript disabled.

  `listAuditEvents` clamps to 100 rows and has no cursor, so the page states that bound whenever the view is full rather than letting a truncated audit log read as "this is everything that happened". Adding keyset pagination to that endpoint is a follow-up with its own OpenAPI change, deliberately not smuggled in here.

- c6b9ceb: Freeze and gate the API slice `ahliweb/awcms-astro` consumes (ADR-0065).

  The existing frozen snapshot is the pre-#182-migration monolith, and every
  surface that repo actually calls landed after it — `/auth/session` and
  `/access/machine-credentials` (ADR-0049), `/media/objects` (#318),
  `/media/public-origin` (#370), the `/blog/posts` cursor traversal (#317).
  Searching the snapshot for them returns zero. So a response-shape change to any
  of them was green here and broke the other repo's build: a failure surfacing
  where whoever caused it is not looking.

  `bun run api:consumer-contract:check` freezes 6 paths plus the 16 components
  their `$ref`s reach. The closure is the point — freezing path objects alone
  would be near-useless, since a path is a few lines of `$ref` and the interesting
  breakages happen in the schema.

  The rule is additive-superset: a new optional field passes, a rename or retype
  fails. Regenerating is deliberate and means the consumer must change too, which
  the fixture header and the failure message both say — whoever reads that message
  is in the wrong repo to realise it unaided. A missing consumer path throws
  rather than silently shrinking the contract.

  This is a schema contract, not a behavioural one: a change of meaning with an
  unchanged shape is not caught.

  No migrations, no permissions, no runtime change.

- da9b51f: ADR-0044 §4 Fase 2, langkah kedua: job `bun run blog:ads:ingest` yang
  memindahkan sistem iklan free-URL ke sistem berbasis media — dan **melaporkan
  setiap baris yang tidak bisa dipindahkan**.

  Pratinjau adalah default, bukan flag. Job scheduled lain memakai `--dry-run`
  sebagai opt-in karena mereka berjalan tanpa penunggu dan mode normalnya adalah
  bekerja. Yang ini kebalikannya: ia tidak menulis apa pun sampai diberi
  `--apply`. Kesalahan mahal di sini bukan "lupa pratinjau", melainkan
  "sudah pratinjau, lalu tidak pernah membaca residunya" — oleh operator yang
  sebentar lagi menghapus tabel sumbernya.

  **Yang otomatis hanya satu kasus, dan itu disengaja.** Sebuah iklan pindah bila
  `image_url`-nya sudah merupakan URL publik salah satu objek media tenant itu
  yang **terdaftar** di registry. Selain itu — remote, malformed, object key milik
  tenant lain, atau byte di bucket yang tidak diklaim baris registry mana pun —
  menjadi residu, dilaporkan lengkap dengan URL-nya untuk diunggah ulang manusia
  lewat media library.

  Dua jalan pintas yang ditolak, dan alasannya:

  - **Mengambil URL eksternal dari server.** Itu primitif SSRF, dan tempat
    terburuk untuk membangunnya adalah skrip migrasi data yang dijalankan sekali,
    di bawah tekanan waktu, oleh operator yang sedang mengawasi jumlah baris
    alih-alih egress. Repo ini sudah memutuskan sikapnya soal ini di jalur
    discovery OIDC (ADR-0031).
  - **Mendaftarkan objek yang ada di bucket tapi tanpa baris registry.** Itu akan
    membuat skrip migrasi mencetak baris `verified` untuk byte yang tidak pernah
    ia ambil, sniff, atau batasi ukurannya — persis pernyataan yang menjadi alasan
    keberadaan pipeline unggah. Peran `awcms_worker` bahkan tidak diberi INSERT
    yang memungkinkannya (`sql/079`).

  Rincian lain:

  - `--apply` **wajib** disertai `--placement-key=<key>`. Sistem lama tidak punya
    konsep slot, yang baru menuntut satu dari dua belas, dan tidak ada di data
    lama yang menyatakan mana. Job menolak menebak.
  - Idempoten lewat `source_legacy_ad_id` di bawah unique index PARSIAL dengan
    `NULLS NOT DISTINCT` (`sql/079`). Keduanya load-bearing: tanpa `NULLS NOT
DISTINCT` sebuah run kedua menggandakan seluruh iklan `global`; tanpa
    predikat parsial, index itu justru menolak pekerjaan editorial biasa. Kedua
    sisi dibuktikan dengan mutasi terhadap PostgreSQL 16 nyata.
  - Job tidak menulis satu pun statement sendiri — semuanya di
    `application/legacy-ad-ingest-directory.ts`, milik modul pemilik tabel
    (`modules:table-writes:check`).
  - Tidak ada tabel yang dihapus. Menghapus `awcms_blog_ads` adalah keputusan
    manusia yang sudah membaca laporan residu, bukan efek samping dari job yang
    menghasilkannya.

  Ditemukan sambil jalan: seluruh blok `NEWS_MEDIA_R2_*` tidak pernah ada di
  `.env.example`, jadi operator yang menyalin berkas itu tak punya cara menemukan
  lima variabel wajib `media_library`. Sekarang terdokumentasi.

- 3f9a2ab: ADR-0044 §4 Fase 2, langkah ketiga: jalur TULIS iklan free-URL ditutup, dan
  gerbang kesiapan yang membuat penghapusan tabel bisa dibuktikan alih-alih
  dipercaya.

  `POST /api/v1/blog/ads` dan `PATCH /api/v1/blog/ads/{id}` sekarang menjawab
  **410 ENDPOINT_RETIRED**, tanpa auth dan tanpa sentuhan basis data. Keduanya
  menyimpan `imageUrl` teks bebas — URL apa pun yang diketik admin, dirender
  langsung ke `<img src>` halaman publik. Itulah bypass managed-media yang ditutup
  ADR-0036, dan ia terbuka selama masih ada rute yang bisa menulisnya.

  **Urutannya yang menjadi isi perubahan ini.** Job ingest memindahkan apa yang
  ada saat ia berjalan. Jalur tulis yang masih terbuka membiarkan editor membuat
  iklan free-URL di jendela antara ingest dan penghapusan — iklan yang tidak
  bermigrasi ke mana pun dan lenyap saat tabelnya hilang, tanpa satu pun laporan
  menyebut ia pernah ada.

  Menutup `POST` saja tidak cukup: `PATCH` bisa menulis ulang `imageUrl` pada
  iklan yang sudah ada — bypass yang sama lewat rute yang lebih senyap, dan yang
  tidak menghasilkan baris baru untuk diperhatikan siapa pun.

  `GET` dan `DELETE` sengaja bertahan. Operator yang menyelesaikan laporan residu
  harus bisa membaca baris yang disebut laporan itu, dan mempensiunkan yang tidak
  ingin ia buat ulang — `blog:ads:drop-readiness` menghitung iklan yang
  soft-delete sebagai sudah-diputuskan.

  **`bun run blog:ads:drop-readiness`** menjawab "bolehkah kedua tabel lama
  dihapus sekarang?" dari data, dan keluar non-nol selama jawabannya belum.
  Migrasi penghapusan tak bisa dibatalkan dan membawa serta iklan situs hidup;
  seluruh pengaman epik ini menjadi hiasan bila langkah terakhirnya diambil atas
  dasar ingatan seseorang bahwa ia sudah menjalankan ingest. Kolom
  `source_legacy_ad_id` (`sql/079`) membuatnya jadi sebuah join.

  Iklan lama terhitung sudah-diputuskan bila ada baris penerus yang menyebutnya,
  ATAU bila ia soft-delete. Selain itu memblokir. **Tidak ada flag override** —
  gerbang yang bisa disuruh lulus adalah gerbang yang tak perlu dipenuhi siapa
  pun.

  Catatan proses: mutasi pertama saya terhadap query kesiapan (menghapus predikat
  `p.tenant_id = a.tenant_id`) **lolos ketujuh test** — RLS diam-diam mengerjakan
  apa yang diklaim predikat itu. Dua mekanisme diklaim, dan test yang tak bisa
  membedakannya hanya membuktikan setidaknya satu ada. Test kedelapan menjalankan
  penilaian yang sama sebagai peran admin yang melewati RLS sepenuhnya, sehingga
  predikatnya menjadi satu-satunya penghalang — dan mutasi itu kini merah.

- 267749e: feat(blog-content): blog pages can be published (ADR-0057)

  `pages.publish`, `pages.archive`, `pages.restore` and `pages.purge` have been
  seeded since `sql/036` and enforced by nothing. That was not a spare catalogue
  row: `createBlogPage` wrote a literal `'draft'`, `updateBlogPage` never touched
  `status`, and the scheduled-publish job reads only posts — so **no code path
  could publish a page**, while public page search filtered on
  `status = 'published'` and always returned nothing.

  Four guarded, audited, `Idempotency-Key`-bearing routes close it:
  `POST /api/v1/blog/pages/{id}/publish`, `/archive`, `/restore`, `/purge`.
  Publish runs the same content-quality checklist posts do, which the page
  preview endpoint has been reporting with nothing to gate.

  The page lifecycle is deliberately narrower than posts' — no `review`, no
  `scheduled`, since no `pages.schedule` permission was ever seeded. `purge`
  reports the ad placements it leaves inert rather than refusing or cascading.

  Also adds `bun run access:permissions:enforcement:check`: every declared
  permission must have an `authorizeInTransaction` guard or a recorded reason.
  It found five further gaps beyond pages, all now recorded and tracked.

  No migrations — the columns, CHECK, index and catalogue rows already existed.

- 505a5e4: `GET /api/v1/blog/posts` dapat traversal stabil ber-cursor — build feed tidak
  lagi berhenti di 100 post.

  Endpoint ini hanya punya `?limit=` (maks 100) dan tanpa cursor, jadi tidak ada
  cara membaca lebih dari 100 post. Adapter `awcms-astro` **melempar** saat
  menyentuh batas itu alih-alih memotong diam-diam, sehingga situs dengan lebih
  dari 100 artikel tidak bisa di-build sama sekali.

  Yang TIDAK dilakukan: menambahkan `?cursor=` ke urutan yang sudah ada.
  Default-nya `updated_at DESC` — benar untuk tabel admin dan tidak sah sebagai
  kunci keyset, karena menyunting sebuah post memindahkannya: satu baris bisa
  melintasi batas halaman di antara dua permintaan lalu terlewat atau muncul dua
  kali, dan tak ada apa pun yang bisa mendeteksinya. Sebuah cursor hanya sah di
  atas urutan yang tidak berubah oleh tulisan yang dibalapinya.

  Jadi `?order=created_at` memilih traversal stabil (kolom immutable) dan
  `?cursor=` hanya berlaku bersamanya; `?cursor=` di atas urutan default **ditolak
  400** dengan alasannya, bukan diam-diam dilayani. Default endpoint tidak berubah
  sama sekali — tabel admin tetap urut `updated_at`.

  `nextCursor` dicetak di lapisan yang masih memegang teks presisi mikrodetik,
  tidak pernah diturunkan ulang dari `Date` JS di rute. Itu bukan kehati-hatian
  teoretis: `timestamptz` menyimpan mikrodetik, `Date` hanya milidetik, dan driver
  MEMBULATKAN KE BAWAH — cursor dari `Date` menunjuk instant yang lebih awal dari
  barisnya sendiri dan melewatkan setiap baris yang berbagi milidetik itu (Issue
  #158; terukur: 105 baris → halaman 2 berisi 4, batch-insert → halaman 2 berisi
  0).

  Diverifikasi terhadap PostgreSQL nyata dengan kasus terburuknya: 25 post
  di-insert dalam SATU statement sehingga berbagi `created_at` sampai mikrodetik.
  Mutation-proven — mengganti sumber cursor jadi `new Date(row.created_at)`
  memerahkan 3 dari 5 test.

  `BlogPostSummary` mendapat field `createdAt` (aditif).

- 300a407: Add `?locale=` to `GET /api/v1/blog/posts`.

  This closes item 2 of `awcms-astro`'s ADR-0021 hold list, which recorded on 2 August 2026 that the filter was still absent and that the build therefore had to pull **every** locale and pair them up client-side — correct, and wasteful for a single-language site.

  Exact match, not a prefix: `en` does not sweep in `en-GB`. A `LIKE 'en%'` implementation would look right until someone published a regional variant they did not want served.

  Absent means every locale, which stays the correct default for the admin table — hiding a translation because the operator did not name its language would be the surprising answer. An **empty** `?locale=` is a 400 rather than being read as absent: a caller that meant to filter and silently got the unfiltered feed builds a site containing every translation of every article, and nothing anywhere fails.

  The shape is deliberately **not** validated beyond non-empty and a 35-character bound. `awcms_blog_posts.locale` is plain `text NOT NULL DEFAULT 'id'` and the write path accepts any non-empty string, so a read filter stricter than the write path would make a stored locale unreachable — a row that exists, that the admin table shows, and that no query can select.

  All three list functions take it (`listBlogPosts`, `listBlogPostsPage`, `listBlogPostsFullPage`), because the route branches between them on `view`/`order` and a filter wired into two of the three would stay invisible until someone changed a query string. `listBlogPosts` collapses its two-branch `status ? … : …` into the single `${param}::text IS NULL` statement its paged siblings already use — two optional filters written the old way is four copies of one SELECT, and a third would make it eight.

  Verified against a real database (`tests/integration/blog-post-locale-filter.integration.test.ts`, six tests) because the failure mode of a parsed-but-unapplied parameter is a 200 with the wrong rows — the same shape as the `view=full` defect this endpoint already shipped once. Mutation-proven: dropping the SQL predicate turns all six red, and dropping the parameter at one of the three route call sites turns the pure contract test red.

- a526e69: Give `business_scope_hierarchy` a real provider: `tenant_admin` resolves `office` scopes against `awcms_offices` (ADR-0060).

  `POST /api/v1/identity/business-scope/assignments` is permission-gated, SoD-evaluated, audited, idempotency-keyed and RLS-protected — and until now it refused **every input in every deployment**. Its only composition root injected a NO-OP adapter that resolved every scope to `resolved: false`, and the reserved `tenant` scope type is rejected by the validator as unassignable (#180 review F2), so both roads led to a denial. Everything downstream was dead with it: no assignment rows to read, so `businessScopeFacts` was never populated, the expiry job never had anything to expire, and SoD's `same_scope_only` matching never had a scope to match.

  The NO-OP was correct when written — ADR-0011/0014 expected a DERIVED application to inject its own hierarchy resolver — and then ADR-0034 deleted that pathway and ADR-0055 confined development to this repo. Its `providedBy` named `organization_structure`, a module ADR-0016 accepted and nobody ever wrote here. What was missing was never the hierarchy: `awcms_offices` has had `parent_office_id` since `sql/002`, FORCE RLS since `sql/017`, and a composite cross-tenant-proof parent FK since `sql/020`.

  The new adapter resolves the `office` scope type and nothing else. Only LIVE rows resolve — not soft-deleted, not `inactive`, same tenant only — and dead rows are skipped anywhere in a chain, so a live office under a deactivated parent gets a shorter ancestor chain rather than borrowing coverage through a resource its tenant switched off. Every bound REFUSES rather than truncates (cycle, depth, result count): a truncated list still claims `resolved: true`, which would answer a coverage question from part of the graph with no signal the rest existed.

  One read-path hardening ships with it: `resolveBusinessScopeFacts` minted a covers-everything fact from `scope_type = 'tenant'` alone. It now requires that row to name this tenant. No supported path can write such a row, which is exactly why the check belongs there — a row carrying it came from outside the service and passed no validation at all.

  The NO-OP adapter is deleted (zero callers once the root is rewired); `optional: true` stays on the consumption, so a tenant with no offices still works and still fails closed. Zero migrations, zero new permissions, no change to any existing endpoint's behaviour — a route must still opt into scope-gated authorization explicitly, and none does today.

- 1551473: `POST /api/v1/comments/admin/{id}/delete` — the moderator half of a transition
  this module has implemented since ADR-0041 (ADR-0058 §B).

  `applyModerationAction` has accepted `"delete"` all along, it is legal from all
  four non-terminal statuses, and the moderation queue can already filter on
  `deleted` — so moderators could see soft-deleted comments without being able to
  delete one. The only actor who could reach that state was the comment's own
  author, inside the edit window.

  This is the one irreversible moderator action, and it stays that way: `deleted`
  remains terminal and recovering a deleted comment remains an operator/database
  action. It is accepted because the state was already reachable, the row, body
  and append-only moderation history all survive, and every other moderator
  action is reversible and keeps the body in the queue — leaving no in-band
  answer for content that must be pulled permanently. Bulk moderation
  deliberately does not gain it.

  `delete` now also resolves the comment's open reports, alongside
  `approve`/`reject`/`spam`: a deleted comment cannot be acted on again, so
  leaving them open would inflate the queue's report count forever. No existing
  caller is affected — nothing could reach that branch with `delete` before.

  Permission-enforcement coverage moves from 202/205 with 3 exceptions to 203/205
  with 2, and the two that remain are exactly the revocations ADR-0058 §C/§D
  decided.

- 0385fb1: Terbitkan kosakata blok `content_json` sebagai kontrak yang bisa dibaca mesin,
  dan patok ketiga tempat ia dinyatakan agar tak bisa menyimpang diam-diam.

  Sampai perubahan ini kosakata itu hidup di dua tempat: tipe TypeScript
  `ContentBlock` (tak terlihat siapa pun di luar `tsc`) dan **satu kalimat prosa**
  di salah satu dari lima kemunculan `contentJson` di OpenAPI — empat sisanya
  hanya menyebut `type: object`. Konsumen yang membaca kontrak punya peluang empat
  dari lima untuk tidak mempelajari apa pun tentang isi field itu.

  Akibatnya nyata dan sudah terjadi: `awcms-astro` menurunkan ulang kosakata itu
  dengan membaca, lalu keliru dalam tiga hal sekaligus — mengarang tipe
  `ordered_list` yang tak ada, dan menjatuhkan `gallery` serta `video_news` karena
  keduanya tak punya field `text` sementara fallback-nya merender `text`. Tidak
  ada yang gagal di mana pun. Daftar bernomor keluar berbutir dan bagian bermedia
  lenyap dari halaman yang tayang.

  Kosakata yang hanya hidup di prosa akan diturunkan ulang, dan penurunan ulang
  itulah tempat ia patah.

  - `CONTENT_BLOCK_TYPES` — kosakata sebagai nilai RUNTIME, disatukan dengan union
    `ContentBlock` lewat assertion saling-assignable. Menambah varian ke union
    tanpa menambahnya ke konstanta (atau sebaliknya) **memerahkan typecheck**,
    bukan sebuah test yang mungkin tak dijalankan orang. Terbukti dua arah.
  - Skema `BlogContentBlock` + `BlogContentJson` di OpenAPI: `oneOf` enam varian
    lengkap dengan field-nya, dirujuk dari **kelima** kemunculan `contentJson`.
    Dua bentuk yang paling mudah salah tebak diberi catatan eksplisit — urutan
    adalah FIELD pada `list` (bukan tipe `ordered_list`), dan `gallery`/
    `video_news` TIDAK punya field `text`.
  - `tests/content-block-contract.test.ts` memaku kontrak OpenAPI dan `switch`
    renderer ke konstanta yang sama, plus menegaskan setiap tipe merender sesuatu
    yang tak kosong dan tak ada varian HTML mentah. Diuji dengan mutasi: kontrak
    menyebut tipe berbeda (1 merah), satu `contentJson` kembali `type: object`
    polos (1 merah), renderer berhenti menangani `gallery` (2 merah).

- c244697: Tutup dua celah keamanan yang asesmen 4 Agustus 2026 (§9.1, §9.2) temukan, keduanya
  di lapisan yang tak punya pemeriksa sendiri.

  **`AUTH_COOKIE_SECURE` tidak lagi gagal-terbuka saat tidak diset.** Aturan produksi
  `scripts/validate-env.ts` dulu hanya menolak string literal `"false"`, sementara
  runtime menyetel `secure: process.env.AUTH_COOKIE_SECURE === "true"`. Ejaan salah
  (`"1"`/`"TRUE"`/`"yes"`) memang sudah ditolak aturan tipe `bool` — diverifikasi
  dengan menjalankan validator, bukan membacanya — sehingga yang benar-benar lolos
  tepat satu keadaan, dan ia justru keadaan **bawaan**: variabel tidak diset sama
  sekali. Produksi seperti itu mengirim cookie sesi tanpa atribut `Secure` sambil
  `bun run config:validate` melaporkan konfigurasi bersih. Aturannya kini `!== "true"`
  dengan pesan yang menyebutkan nilai terbaca. Non-produksi sengaja tidak dituntut:
  dev berjalan di `http://`, dan `environments.md` sudah mencatat itu sebagai selisih
  per-environment yang disengaja.

  **`Cross-Origin-Opener-Policy` dan `Cross-Origin-Resource-Policy` kini dikirim**
  (`same-origin`, keduanya tanpa gerbang produksi — tidak seperti HSTS, keduanya tidak
  menunggu TLS). Keduanya "dianjurkan" OWASP Secure Headers Project dan berlaku di sini
  justru karena repo ini punya sesi manusia dan 42 halaman ber-render: COOP memutus
  tautan browsing-context-group ke window mana pun yang membuka kita, dan CORP menutup
  jalur penyematan `no-cors` yang CORS sendiri tidak tutup. Tidak ada kapabilitas yang
  hilang — repo ini tak pernah memancarkan `Access-Control-Allow-Origin`, gambar artikel
  disajikan origin R2 yang berbeda, dan Turnstile berjalan di frame anak yang tidak
  diatur COOP.

  Kedua perbaikan mutation-proven: mengembalikan aturan lama membuat test keadaan-ABSEN
  merah, dan asersi header menyasar NILAI-nya, bukan sekadar keberadaannya.

- 3beee6c: Core Web Vitals kini diukur di LAB — Opsi D ADR-0067, nol data pengunjung.

  Spec baru `tests/e2e/cwv-lab.e2e.ts` (harness E2E Playwright yang sudah ada,
  bukan harness kedua) mengukur **LCP** dan **CLS** halaman `/login` via
  `PerformanceObserver` ber-`buffered: true`, dengan CLS dihitung per definisi
  session-window CWV. Ambang kelulusan = ambang "baik" CWV (LCP ≤ 2500 ms,
  CLS ≤ 0,1) — sebagai batas LAB satu mesin: detektor regresi, BUKAN p75
  lapangan. INP sengaja tidak diukur/diklaim (tanpa interaksi nyata ia tidak
  bermakna di lab).

  Gerbangnya env-gated (`E2E_CWV_LAB=1`, dinyalakan job CI `e2e-smoke`); saat
  env tidak diset ia MENCETAK pernyataan skip eksplisit, dan saat berjalan LCP
  yang tidak terekam adalah kegagalan — gerbang ini tidak pernah hijau senyap.
  Script baru: `bun run perf:cwv:lab`. Tidak ada skrip klien, endpoint, tabel,
  atau sentuhan pada `visitor_analytics`; keputusan RUM (Opsi B) tetap milik
  pemilik produk — status ADR-0067 tidak berubah.

- 36d012f: Add the `/admin/data-lifecycle` console and put `data_lifecycle` in the admin sidebar.

  The module shipped its registry / legal-hold / dry-run / run-history API (ADR-0037) with no screen at all, so the entire surface was reachable only by `curl` and its own README recorded the screen as an open follow-up. The console renders the code-declared lifecycle registry, the legal-hold ledger with a place-hold form and per-hold release, the on-demand dry-run planner with its categorized counts, and the run history that is itself retention evidence.

  Reads reuse the same application functions the JSON endpoints call, inside one `withTenantOrThrow` transaction. Writes go to the guarded `/api/v1/data-lifecycle/*` endpoints — the two hold mutations with a fresh `Idempotency-Key` per click, the dry-run with none, because that endpoint mutates nothing and requires none. Real archive and purge stay job-only; the screen has no control for them because they have no HTTP surface.

  `legal_hold.create` and `legal_hold.release` are gated **separately**: `data_lifecycle.legal_hold_maker_checker` makes holding both a `critical` SoD conflict, so gating both controls on one permission — the tidier-looking choice — would be wrong for every real operator. `tests/admin-data-lifecycle-page-contract.test.ts` pins that, plus the page's six permission keys against what the routes enforce and the descriptor declares, so a plausible-but-unseeded key (`legal_hold.delete`, `plan.read`) cannot silently hide a panel from everyone including the owner.

- 9800a0e: Buat penolakan pool database tak bisa lagi menyamar sebagai data, dan hentikan
  inversi backpressure yang sudah hidup di jalur job.

  `withTenant<T>(...): Promise<T>` mengembalikan `503 DATABASE_BUSY` (breaker
  open / work-class saturasi) dan `409` idempotency lewat `as T` — cast yang
  artinya persis "berhenti memeriksa". Header-nya menyatakan "in practice every
  real call site uses `T = Response`"; itu sudah lama tidak benar. **58 berkas di
  `src/`+`scripts/` yang bukan handler HTTP** (15 di antaranya `.astro`) dan 24
  berkas test memakainya untuk mengambil DATA; begitu tipe-nya dijujurkan,
  compiler membuktikan 30 di antaranya benar-benar membaca field dari nilai yang
  bisa berupa `Response`.

  Kerusakannya nyata, bukan teoretis. `purgeExpiredAuditEvents` berjanji
  `Promise<number>`; di bawah work-class `maintenance` (SATU slot) ia
  mengembalikan `Response`. `runBoundedBatches` berhenti "sampai satu pass
  mengembalikan `count: 0`" — dan `Response` tak pernah `=== 0`, sehingga job yang
  seluruh tujuannya mengalah justru menjalankan 50 pass penuh per tenant ke
  database yang baru saja menolak, lalu melaporkan `totalCount` sebagai string
  `"0[object Response]…"` (karena `number + Response` itu konkatenasi). Test
  mutasinya mereproduksi persis output itu.

  Sekarang ada dua bentuk, dan compiler yang memilihkan:

  - **`withTenant(...)` → `Promise<T | Response>`.** Jalur request meneruskan
    `503`-nya apa adanya, lengkap dengan `Retry-After`; 275 pemanggilan di 204
    berkas rute yang callback-nya memang sudah mengembalikan `Response` tidak
    berubah satu baris pun (`Response | Response` itu `Response`).
  - **`withTenantOrThrow<T>(...)` → `Promise<T>`.** Untuk semua yang bukan handler
    HTTP. Melempar `DatabaseBusyError` yang MEMBAWA response `503` yang sama
    (jadi kedua bentuk tak bisa menyimpang), dan kini diklasifikasi `retryable`
    oleh job runner alih-alih jatuh ke `unknown`.

  Tak ada lagi satu pun `as T` di modul itu.

  `db:tenant-context:check` (baru, di rantai `check`) menutup dua sisa yang tak
  terlihat compiler: hasil `withTenant` yang **dibuang** (`await withTenant(...)`
  sebagai statement — 503-nya lenyap tanpa jejak), dan pemanggilan dari `.astro`,
  yang tak pernah dibaca `tsc --noEmit`. Gate itu langsung menemukan tiga
  pembuangan nyata di jalur auth: dua di antaranya melewatkan audit event
  `sso_account_linked`/`mfa_challenge_issued` sambil tetap menjawab seolah sudah
  tertulis.

- 4430aa4: The root discovery surfaces are edge-cacheable, and aggregate surfaces are now
  invalidated by the modules that author them (ADR-0061 §B).

  `serveDiscovery` accepts Astro's `locals` and publishes the resolved tenant after
  `build(ctx)` produces a payload; all six routes (`/robots.txt`, `/sitemap.xml`,
  `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`) forward it. Three
  registry entries follow: `seo-robots` (600s, config-derived and the most stable),
  `seo-sitemap` (300s, index and child pages), `seo-feed` (300s, RSS/Atom/JSON with
  `?locale=` as the only permitted parameter).

  Publishing after the payload check matters here even more than it did for
  `/news/**`: `build` returns `null` for "sitemaps disabled", "feeds disabled" and
  "page out of range", all of which collapse into the same generic 404 as an
  unknown host. It also means `/sitemap-99999.xml` matches the surface but never
  publishes a tenant, so walking page numbers cannot fill the cache.

  Discovery bodies turn out to have two authors, and only one of them owned the
  surface. `PUT /api/v1/seo/config` now enqueues a purge — the tenant-wide
  `noindex` switch alone rewrites `/robots.txt`. But the bodies are aggregated from
  every `seo_facts` provider, so publishing a post changes `/sitemap.xml` without
  touching anything `seo_distribution` writes, and a module purge tags
  `t:<tenant>:m:<moduleKey>`, so `blog_content`'s purge could not reach it. Left
  alone that would have purged `/blog/{code}/feed.xml` on publish while `/feed.xml`
  — the same content — sat stale until TTL, with nothing reporting it.

  `enqueueModuleContentPurge` therefore also covers modules that declare a
  `consumes` dependency on the changing module and own a declared surface. It is
  read from the module registry, so `blog_content` never names `seo_distribution`;
  and it is limited to surface owners, because a ban on a key that tags no cached
  object matches nothing while the queue reports success.

  No migration, no permission, no OpenAPI change. With `EDGE_CACHE_MODE` unset the
  subsystem remains a no-op.

- dfd8e64: Host-resolved public surfaces can be cached at the edge (ADR-0061 §A).

  ADR-0042 §8 defines two sources for the tenant a cached object is tagged with,
  and prefers the one a route publishes on `locals.edgeCacheTenantId` — the only
  source available to a surface whose tenant comes from the request rather than
  from a path segment. That branch had no writer anywhere in the repo, so it was
  unreachable and every host-resolved surface was uncacheable by construction:
  edge caching accelerated `/blog/{tenantCode}/**` (the legacy shape) and nothing
  of the `/news/**` family that ADR-0059 made the go-forward one.

  The four `/news/**` routes now publish their resolved tenant through
  `publishEdgeCacheTenant`, and the registry declares `news-index`,
  `news-taxonomy` and `news-post` — mirroring the TTLs and reasoning of their
  `blog-*` counterparts, owned by `blog_content`, whose existing module purge
  already invalidates them.

  Publication happens only on the path that actually serves the resource. A 404 is
  a cacheable status, so publishing before the "no such post/term" branch would
  annotate a missing-resource 404 with `Surrogate-Control` while an unknown-host
  404 gets `private, no-store` — answering "does this hostname map to a live
  tenant?" from one request, through a second channel over the question the
  route family's latency padding exists to close.

  No migration, no permission, no OpenAPI change. With `EDGE_CACHE_MODE` unset
  (every deployment's default) the whole subsystem remains a no-op.

- a3d1dc2: Tegakkan bahwa setiap variabel env yang dibaca kode ada di `.env.example`.

  `tests/env-required-vars-doc.test.ts` sudah membandingkan daftar var **WAJIB**
  yang didokumentasikan dengan yang ditegakkan. Separuh yang lebih besar tak
  terjaga: var yang opsional tapi **mengubah perilaku**. Sebelas menumpuk di sana,
  termasuk:

  - **`TENANT_DOMAIN_DNS_PROVIDER`** — dua nilainya adalah "tak melakukan panggilan
    keluar sama sekali" dan "bicara ke API DNS sungguhan". Tak ada di
    `.env.example`, doc 18, maupun `validate-env.ts`.
  - **`R2_ACCOUNT_ID`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`** —
    `R2_ENABLED=false` dikirim sendirian, jadi operator yang menyalakannya tak
    punya template untuk empat kredensial yang lalu diwajibkan uploader.
  - **Empat `SITE_SEARCH_*_RATE_LIMIT_*`** — kontrol penyalahgunaan pada dua
    endpoint publik anonim, bukan sekadar tuning.
  - `FORM_DRAFT_RETENTION_DAYS`, `OBJECT_SYNC_UPLOAD_TIMEOUT_MS`, dan blok
    `TENANT_DOMAIN_CLOUDFLARE_*`.

  Yang terakhir lebih buruk dari sekadar absen: `.env.example` merujuk "the
  `TENANT_DOMAIN_CLOUDFLARE_*` settings **above**" padahal tak ada satu pun di
  seluruh berkas itu.

  Nilai default yang dicatat diverifikasi ke kode, bukan ditebak — retensi form
  draft 30 hari (bukan 90) dan timeout object-sync 10000ms (bukan 30000).

  `config:env:coverage:check` (baru, di rantai `check`) menargetkan `.env.example`,
  bukan doc 18: berkas itulah yang **disalin** operator, sementara var yang hanya
  ada di prosa harus sudah diketahui lebih dulu untuk bisa dicari. Placeholder
  ber-komentar sudah cukup — pola yang sudah dipakai `EMAIL_MAILKETING_*` — jadi
  secret tetap tak masuk repo. Batas yang dinyatakan terbuka di header gate: ia
  hanya mencocokkan `process.env.X`, jadi modul config yang mengoper
  `env: NodeJS.ProcessEnv` lalu membaca `env.X` tak terlihat.

- c244697: Postur standar keluarga dan kontrak konsumen: tiga celah asesmen putaran kedua
  ditutup, satu dinyatakan terblokir dengan alasan eksternal yang diverifikasi.

  **Kontrak konsumen `awcms-astro` dipisah `CONSUMED` vs `COMMITTED`** (§9.5).
  `CONSUMER_PATHS` semula membekukan enam permukaan karena diturunkan dengan
  mem-grep repo sebelah **tanpa membuang komentar** — tiga di antaranya prosa: sebuah
  docblock tipe, sebuah komentar yang menjelaskan kenapa build justru TIDAK memanggil
  `/auth/session`, dan sebuah pesan error yang memberi tahu manusia cara menerbitkan
  kredensial. Repo sebelah punya jawaban otoritatifnya dan menggerbanginya ("tepat
  tiga permukaan", komentar dibuang lebih dulu). Kini tiga permukaan yang benar-benar
  dipanggil dipisahkan dari dua yang **dijanjikan ADR** tetapi belum dipanggil
  (`/auth/session`, `/access/machine-credentials` — keduanya milik BFF ADR-0050 yang
  belum dibangun). `/api/v1/blog/posts/{id}` keluar dari kontrak sepenuhnya:
  ADR-0018 di repo sebelah menghapus fetch per-id, jadi membekukannya mengikat repo
  ini pada bentuk yang tak punya pembaca. Tiap entri `COMMITTED` wajib menyebut ADR
  yang menjanjikannya, dan sebuah test menegakkan bahwa ADR itu punya berkas.

  **Dua lubang `bun run skills:check` ditutup** (§9.6). Pembebasan
  `ASPIRATIONAL_SKILLS` dulu bersifat per-SKILL dan **total**: `awcms-performance`
  terdaftar dengan alasan yang menyebut PERINTAH sementara pembebasannya juga menutupi
  PATH, sehingga skill itu bisa berkata "perintah ini tidak ada" di banner-nya dan
  "gunakan suite yang sudah ada di `src/lib/performance/`" enam puluh baris kemudian —
  direktori yang tidak ada — tanpa gerbang berpendapat. Kini ada blok bertanda
  `<!-- aspirational:mulai -->` yang membatasi pembebasan ke passage yang memang
  memerlukannya; sisanya tetap digerbangi, dan `awcms-performance` keluar dari daftar.
  Lubang kedua mekanis: ekstraktor path hanya melihat path berbacktick **satu baris**,
  sehingga path yang terpotong pembungkusan markdown tak terlihat — aturan 1 sebenarnya
  berbunyi "path yang disebut DAN kebetulan muat satu baris wajib ada", dan selisih itu
  tak tertulis di mana pun. Keduanya mutation-proven.

  **ADR-0068 menuliskan pin edisi standar dan tiga divergence keluarga.**
  `awcms-astro` ADR-0028 menyatakan mengikuti edisi OWASP repo ini dan tidak
  mendahuluinya — sementara keputusan itu tidak pernah ada, karena pinnya datang lewat
  sebuah skill lalu diikuti karena sudah tertulis. `intentionalDivergences` yang kosong
  sejak ADR-0055 kini memuat tiga entri ber-`reviewDate`: HSTS `includeSubDomains`
  (benar di kedua sisi, alasan berbeda), `.astro` tak-terperiksa-tipe, dan pin edisi itu
  sendiri.

  **`astro check` TIDAK bisa ditambahkan, dan itu diverifikasi bukan diasumsikan.**
  `@astrojs/check` menuntut API programatik TypeScript 6.x; repo ini di 7.0.2, yang
  tidak menyediakannya. Dipasang, dijalankan, ditolak, lalu dependensinya dicabut lagi
  alih-alih meninggalkan 73 paket yang tak bisa berbuat apa-apa. Dicatat sebagai
  divergence bertanggal, bukan sebagai janji.

  **ADR-0067 mendapat Opsi D — pengukuran lab.** Ketiga opsi draf pertama semuanya RUM,
  sehingga seluruh keputusan bertabrakan dengan postur privasi `visitor_analytics` dan
  menunggu. Pengukuran lab (Playwright, sudah terpasang) mengumpulkan **nol** data
  pengunjung dan menjawab pertanyaan yang berbeda — "apakah perubahan ini membuat
  halaman lebih lambat" — jadi ia tidak perlu menunggu keputusan RUM.

- 703f666: Foreign-key columns must be index-reachable — the repo's first performance gate
  (ADR-0064, `sql/090`).

  The 2026-08-04 assessment measured **zero of 28 gates** touching performance, so
  an unindexed foreign key lands with CI fully green and surfaces months later as
  "the admin screen got slow".

  Postgres indexes a foreign key's referenced side automatically and its
  referencing side not at all, so a bare FK column pays twice: every parent
  `DELETE`/`UPDATE` sequentially scans the child table to enforce the constraint,
  and the parent→child join has no index either. Measured here: 182 FK columns, 14
  unreachable, with `awcms_blog_ads` carrying no index at all beyond its primary
  key.

  The rule is tenant-aware — reachable means leading an index, or being the second
  column after `tenant_id`. The literal "must lead" rule is violated by 40 of 182,
  and forty migrations on the day a gate lands is not a gate but an exemption list
  waiting to be written. Since RLS `FORCE` guarantees every tenant-scoped query
  carries `tenant_id`, a `(tenant_id, fk)` composite is the index those joins
  actually use. The residual is stated rather than hidden: that composite does not
  help enforce the constraint on a parent delete. The relaxation is bounded and
  tested both ways — a second column after anything else does not count, and
  neither does a third column after `tenant_id`.

  `sql/090` adds thirteen indexes (additive, `IF NOT EXISTS`, no data moved).
  `awcms_setup_state.tenant_id` is the single exemption: a hard singleton holding
  exactly one row.

  Zero permissions, zero OpenAPI change, zero runtime change.

- 40f645a: feat(form-drafts): add the `/admin/form-drafts` ops screen and its sidebar entry

  `form_drafts` shipped a complete admin API but no screen and no `navigation`
  entry, so the module was invisible in the admin sidebar and the only way to see
  or clear a tenant's accumulated drafts was the JSON API or the daily
  `form-drafts:purge` job.

  Adds `/admin/form-drafts`: a filter bar (module key / wizard key / status)
  driving the same filters `GET /api/v1/form-drafts` accepts, the bounded
  newest-first list, a collapsed read-only payload inspector, and a per-row
  delete that calls `DELETE /api/v1/form-drafts/{id}`. Registered in the sidebar
  under System, gated on `form_drafts.draft.read`.

  Deliberately not included: a create form, a step editor, and a submit button.
  Drafts are produced by other modules' wizards, and submitting is a domain
  transition that wizard owns — a janitor screen that flipped a draft to
  `submitted` would report work as finished while nothing downstream ran.

  No schema, endpoint, or permission change.

- 1922f79: Add the host-resolved public content family `/news/**` (ADR-0059), and make the SEO discovery base path follow the route family that actually serves.

  `tenant_domain` has mapped hosts to tenants since #219 and the discovery surfaces (`robots.txt`, sitemaps, feeds) and `/search` have been host-resolved since #223/#231 — but the content those surfaces point at could only be read through `/blog/{tenantCode}/{slug}`. A tenant on its own domain therefore published URLs carrying the very identifier the domain exists to remove. Four routes close that: `/news`, `/news/{slug}`, `/news/category/{slug}`, `/news/tag/{slug}`, resolving the tenant from the request through `withHostResolvedBlogTenant` — the same shape as `site_search`/`comments`, including the latency padding that keeps "unknown host" and "live tenant" indistinguishable in time as well as in body. The family has its own per-tenant switch, `publicRouteMode`, symmetric with the legacy family's `legacyTenantRouteEnabled`.

  The backlog asked for `/blog/{slug}`, and that shape was refused with evidence: probed in this repo, Astro reports the route "is defined in both" `src/pages/blog/[slug].ts` and `src/pages/blog/[tenantCode]/index.ts`, still builds, and lets one silently shadow the other — "a collision will result in a hard error in following versions of Astro". Resolving the ambiguity at runtime would be worse: whoever can write a post slug could shadow another tenant's listing URL. The archived `publicBasePath`/`publicLabel` settings are not adopted either, because they move a page's links without moving the route that serves them.

  `seo_distribution` now chooses its base path instead of assuming one: `/news` while the host-resolved family is live, `/blog/{tenantCode}` when a tenant switched that off but kept the legacy family, and **no provider at all** when both are off — an empty sitemap rather than one full of certain 404s. That invariant is mutation-proven against a real database.

  Also corrected, because it was recorded as a decision: the "every sitemap `<loc>` 404s for host-resolved tenants" defect in `docs/PROJECT_STATE.md` never existed. `discovery-providers.ts` has scoped the adapter to `/blog/{tenantCode}` since the module landed (#223), and the `/blog` default it was blamed on has zero callers in `src/`.

  Zero migrations, zero permissions, zero OpenAPI change. `/news/**` is deliberately not yet a declared edge-cache surface: its path is identical for every tenant, so the cache key has to carry the host first.

- 2739d31: Tambah modul `idn_admin_regions` — master data wilayah administratif Indonesia
  yang ber-versi, ter-provenance, dan bisa di-rollback (ADR-0046).

  Hampir setiap aplikasi bisnis Indonesia di atas template ini butuh wilayah resmi:
  alamat pelanggan, cabang, wilayah kerja, agregasi laporan per provinsi. Tanpa
  modul bersama, setiap aplikasi menyalin CSV-nya sendiri — versi berbeda-beda,
  tanpa asal-usul, tanpa cara membuktikan versi mana yang sedang dipakai.

  Yang mendarat:

  - **Skema ber-versi** (`sql/080`): `awcms_idn_region_datasets` (satu baris per
    impor, dengan repo/commit/checksum/nomor Kepmendagri) dan
    `awcms_idn_admin_regions` (91.599 wilayah milik satu versi). Impor berikutnya
    menulis **di samping**, bukan menimpa — itulah yang membuat rollback jadi
    pembalikan status, bukan impor ulang.
  - **Impor sebagai JOB** (`bun run idn-regions:import`, dry-run default): mem-parse
    dump upstream sebagai TEKS (tanpa mesin SQL, tanpa MySQL, tanpa jaringan) dan
    menolak impor parsial — baris tak terparse, kode ganda, induk hilang, atau satu
    tingkat kosong semuanya menggagalkan impor. Dataset baru selalu mendarat
    `validated`, tak pernah langsung `active`.
  - **Aktivasi/rollback sebagai aksi admin ter-audit** (ABAC + `Idempotency-Key`),
    dengan aturan "hanya satu dataset aktif" ditegakkan **partial unique index di
    database** — bukan pemeriksaan aplikasi yang bisa disusupi dua request
    bersamaan.
  - **Lookup API** `/api/v1/idn-regions/*`: filter tingkat/induk/nama, paginasi
    keyset, default ke dataset aktif, dan `?dataset=<code>` untuk membandingkan
    versi lama.
  - **Dataset ter-vendor** (`data/idn-admin-regions/`, ~4,2 MB): agar impor
    deterministik dan offline, dan agar "versi wilayah mana yang jalan di build
    ini" terjawab dari commit, bukan dari keadaan internet hari itu.

  Dua keputusan yang mengikat pembaca berikutnya:

  - **Kedua tabel GLOBAL** — tanpa `tenant_id`, tanpa RLS. Provinsi "Aceh" sama
    untuk semua tenant. Yang menggantikan RLS bukan kepercayaan: keduanya wajib
    terdaftar di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` sehingga privilege tiap role
    dinyatakan eksplisit (`awcms_app` SELECT + UPDATE dataset saja, `awcms_worker`
    jalur tulis, **nol DELETE untuk keduanya**), dan setiap endpoint tetap melewati
    sesi + konteks tenant + ABAC default-deny. Yang global adalah BARISNYA, bukan
    izinnya.
  - **Ini bukan API resmi Kemendagri.** Dataset komunitas (`cahyadsn/wilayah`, MIT)
    yang mengemas Kepmendagri. Caveat itu dibawa di kode, di respons API, dan di
    layar admin — bukan hanya di dokumen. Nomor keputusan direkam **per berkas**
    dari header masing-masing: berkas yang diimpor menyebut **300.2.2-2138/2025**,
    sementara `awcms-mini` merekam satu kalimat menyebut 2430 untuk semua berkas —
    koreksi yang digerbangi test provenance.

  Diverifikasi terhadap PostgreSQL 18.4 nyata: 81 migrasi bersih, impor 91.599
  baris (38 provinsi / 514 kabupaten-kota / 7.285 kecamatan / 83.762 desa-kelurahan),
  impor ulang byte identik = no-op, dan nilai turunan yang mudah salah terbukti
  benar pada baris nyata (`Desa Adat` di Papua, `Kota Administrasi` di DKI, jalur
  leluhur "Papua, Kabupaten Jayapura, Sentani, Desa Adat Yoboi").

- fc138df: Kredensial mesin baca-saja + `GET /api/v1/auth/session` — dua kontrak yang
  menahan `awcms-astro`, dibangun sebagai satu desain (ADR-0049).

  Satu-satunya bearer yang repo ini terima adalah token **sesi** ber-hash, dan
  sebuah build tidak bisa memegangnya: sesi kedaluwarsa, dicabut seluruhnya saat
  password reset, dan dirotasi step-up MFA. `.env.example` milik `awcms-astro`
  menyuruh operator mengisi "a BUILD-TIME, READ-ONLY token" — instruksi untuk
  menerbitkan sesuatu yang tidak bisa diterbitkan siapa pun, di repo mana pun di
  keluarga ini.

  **Kredensial MENGAUTENTIKASI; ia tidak pernah MENGOTORISASI.** Setiap baris
  `awcms_machine_credentials` (`sql/082`, tenant-scoped, `FORCE` RLS, FK komposit)
  terikat pada satu `awcms_tenant_users` yang sudah ada. Setelah prinsipalnya
  resolve, rantai module-enabled → RBAC → ABAC → decision log → SoD berjalan apa
  adanya. Kredensial yang membawa daftar izinnya sendiri akan menjadi permukaan
  otorisasi KEDUA — persis yang ADR-0048 §1 larang.

  Tiga pembatas, semuanya fail-closed:

  - **Menyempitkan, tak pernah melebarkan.** Izin efektif = irisan
    `allowed_permission_keys` dengan izin service account. Menambah role ke akun
    itu tidak melebarkan kredensial yang sudah terbit; daftar kosong berarti tidak
    bisa apa-apa, bukan "tanpa batas".
  - **Baca-saja**, diputus SEBELUM izin dilihat dan terlepas dari apa pun yang
    dipegang akunnya — token yang bocor tak bisa mengubah apa pun walau diarahkan
    ke `owner`.
  - **Kedaluwarsa wajib** (maks 365 hari) dan pencabutan berlaku pada permintaan
    berikutnya, karena autentikasi membaca baris yang sama. Itulah yang token buram
    ber-hash beli dan JWT bertanda tangan tidak punya jawabannya.

  **Token membawa tenant-nya sendiri** (`awcmsm_<tenantIdHex>_<rahasia>`), jadi
  klien build cukup satu env var dan header tenant tidak lagi relevan untuknya —
  menutup cacat header ADR-0047 tanpa menambah alias `X-Tenant-Code` yang setiap
  rute masa depan harus ingat menghormatinya. Hash-nya ber-ruang-nama
  `mc-sha256:`, dan `hashSessionToken()` men-dispatch pada prefix token, sehingga
  183 rute yang sudah memanggilnya mendapat dukungan ini tanpa satu pun perubahan
  tanda tangan — dan satu jenis bearer tak pernah bisa dicari di ruang nama
  jenis lain.

  `GET /api/v1/auth/session` mengembalikan klaim aman saja untuk BFF lintas-origin
  (`identityId`/`tenantId`/`displayName`/`roles`/`assuranceLevel`/`expiresAt`/`scopes`)
  — bukan duplikat `/auth/me`, yang justru mengembalikan email mentah dan diam soal
  peran/assurance/kedaluwarsa. Satu bentuk 401 untuk setiap kegagalan, termasuk
  saat yang disodorkan kredensial mesin, supaya endpoint ini tak bisa dipakai
  mengklasifikasi bearer. Ia memperkenalkan `defineSelfServiceTenantRoute` —
  seam untuk rute terautentikasi yang subjeknya pemanggil itu sendiri, sehingga
  `workClass` tetap wajib dan `api:tenant-route:check` tetap satu-arah alih-alih
  menumbuhkan allowlist kedua.

  Decision log mendapat `machine_credential_id` nullable: beberapa kredensial boleh
  menunjuk service account yang sama, jadi tanpa kolom itu "token yang MANA yang
  membaca ini" tak punya jawaban.

  Diverifikasi terhadap PostgreSQL nyata (83 migrasi bersih, 18 test integrasi) —
  dan verifikasi itulah yang menemukan jebakan yang lolos typecheck: **`Bun.SQL`
  tidak mem-bind array JS sebagai array Postgres**. `${["a","b"]}` sampai ke server
  sebagai teks `a,b` (22P02), dan bentuk satu elemen paling berbahaya karena tiba
  sebagai `a` yang terlihat seperti string biasa.

  Dicatat sebagai divergence keluarga di `awcms-family-compatibility.yaml` **saat
  mendarat**, sesuai ADR-0047 §4 — fitur fondasi pertama yang dirintis langsung di
  sini selama pembekuan `awcms-mini`/`awcms-micro`.

  Security review pra-merge menemukan dua hal dan menutup keduanya: deaktivasi
  service account kini **langsung** mematikan kredensialnya (jalur mesin
  mensyaratkan status tenant-user **dan** identitas aktif — sengaja lebih ketat
  dari jalur sesi, karena tak ada apa pun yang mencabut kredensial saat akun
  dinonaktifkan dan umurnya bisa setahun), dan respons penerbitan kini
  `private, no-store` karena badannya membawa kredensial hidup. Yang pertama
  dibuktikan dengan mengembalikan cacatnya: dua test integrasi merah, lalu hijau
  lagi setelah dipulihkan.

- 1b852b8: Revoke `media_library.media.attach` and `media_library.media.detach` (ADR-0056 §A).

  Both were seeded into the global permission catalog by `sql/052`, and `POST /api/v1/setup/initialize` grants that catalog whole to every new tenant's `owner` role. Neither was ever checked: no route, no application function, no job. They named a write that stopped existing at ADR-0036 — before that inversion, `awcms_news_media_objects.owner_resource_type`/`.owner_resource_id` held the object→content relation and attach/detach were real operations on this module's own table; after it, a media object's attachment is stated by the consumer's FK (`awcms_blog_posts.featured_media_id`, `awcms_news_portal_ad_placements.media_object_id`), so attaching means updating the consumer's row under the consumer's permission.

  `sql/087` deletes the grants first, then the catalog rows — reversed, the catalog delete hits the `awcms_role_permissions` FK. The two zero-caller functions (`attachNewsMediaObject`, `detachNewsMediaObject`) are deleted with them, and `media-object-directory.ts` keeps a marker where they were so the next reader learns why the module has no attach path rather than assuming one is missing.

  The `attached` **status** survives deliberately: `sql/041`'s CHECK still admits it and `isNewsMediaObjectSafeForPublicReference` still treats it as safe to reference, so any row already in that state keeps resolving. What is gone is the ability to write it — which nothing did. `verified` is what the finalize flow produces and it is equally referenceable.

  This is a real authorization change, and it is the narrow half of the ADR: `delete`/`restore`/`purge` are equally ungated today and are deliberately left alone here, because unlike these two they describe operator needs that currently have no answer at all. §B gives them endpoints.

  Also corrects ADR-0056 §A, whose first edition said all five dead functions were deleted — contradicting §B, which uses three of them. Two are deleted; three are kept and given a surface.

- ad5f1e6: Give `media_library`'s delete/restore/purge permissions the endpoints they never had (ADR-0056 §B), and fix a Postgres error-code check that could never be true.

  All three permissions have been in the global catalog since `sql/052`, granted whole to every tenant owner, and enforced by nothing — no route, no application function, no job. The functions behind them were written and had zero callers. So an object uploaded by mistake, orphaned, or violating policy disappeared only if the reconciliation job happened to categorise it that way, on the job's own schedule; there was no way for an administrator to remove one, and no way to undo it if they were wrong.

  - `DELETE /api/v1/media/objects/{id}` — soft delete, body `{ reason }` required and bounded at 500 characters. The reason is part of the request hash, so replaying one key with a different reason is a different request rather than a stored response describing a reason nobody sent.
  - `POST /api/v1/media/objects/{id}/restore` — the undo. A live object answers 404: "there was nothing to undo" and "it worked" must not share a response.
  - `POST /api/v1/media/objects/{id}/purge` — hard-deletes the registry row of an already soft-deleted object.

  All three are `HIGH_RISK_ACTIONS` and require `Idempotency-Key`, each under its own scope so a delete's key cannot collide with a purge's.

  **Soft delete breaks live references, deliberately.** `resolveMediaReferences` filters `deleted_at IS NULL`, so a post whose `featured_media_id` points at a deleted object resolves to nothing immediately. That is the intended outcome for the case this serves, and `restore` is what makes it recoverable. Nothing here scans for referencing rows first: that would make a System Foundation module know its own consumers.

  **`purge` clears the registry, not the R2 bytes.** The `news-media:reconcile` job owns the bucket; a second writer would mean two processes with different ideas of what is safe to remove. Accepted, stated cost: a window where the R2 object outlives its registry row, closed by the next reconciliation tick.

  `awcms_news_portal_ad_placements.media_object_id` is a hard NOT NULL FK, so purging a still-referenced object answers `409 MEDIA_OBJECT_REFERENCED`. That path runs inside a **savepoint** — in PostgreSQL a `23503` aborts the whole transaction, so catching it without one turns a caller-actionable 409 into a 500 at the COMMIT `withTenant` performs. Verified against a real database rather than reasoned about.

  That verification turned up a second thing. **The SQLSTATE is on `error.errno`, not `error.code`** — Bun sets `code` to its own `"ERR_POSTGRES_SERVER_ERROR"` for every server error alike, so `error.code === "23505"` is not a subtly wrong check but one that can never be true, leaving everything downstream of it dead. Ten sites in this repo already used `String(error.errno)`. One did not: `tenant-provisioning.ts`, where `POST /api/v1/tenants` promises `409 duplicate_tenant_code` and served a 500 on the concurrent-duplicate race the savepoint exists for (its pre-check SELECT hid the ordinary case). Fixed here rather than filed, and `tests/postgres-sqlstate-detection.test.ts` now gates it repo-wide — mutation-proven by restoring the original defect.

  `media_library` now has zero ungated permissions. ADR-0056 §C (a list function and its own route) is what remains before the screen.

- e5225e3: Add `listMediaObjects` and `GET /api/v1/media/objects/list` (ADR-0056 §C) — the last piece before `/admin/media`.

  Until now the application layer had only point lookups: `fetchNewsMediaObjectById`, `fetchNewsMediaObjectsByIds`, `fetchNewsMediaObjectByObjectKey`. There was no way to ask "what media does this tenant have", so a browse screen could not be built on the existing surface at all, whatever the permission catalog said.

  **It gets its own route rather than a mode on the resolver.** `GET /api/v1/media/objects` demands `?ids=` — it is a batch resolver built for the `awcms-astro` build to swap ids for public URLs. Teaching it a "no `ids` means list everything" branch would turn a request that is a 400 today into a dump of the entire registry: a contract change wearing the clothes of an addition, and one no existing caller could opt out of.

  `list` cannot be read as an object id, because `[id].ts` and its children now require a uuid and answer 400 otherwise. That closes the path ambiguity from the other side, so Astro's static-before-dynamic precedence is not the only thing keeping `/list` and `/{id}` apart.

  **The listing deliberately outgrows the resolver's safety rule.** It returns rows in any status — `pending_upload`, `failed`, `orphaned` — and, with `deletion=deleted|all`, soft-deleted ones. `isNewsMediaObjectSafeForPublicReference` admits only `verified`/`attached`; an administrator opens this list precisely because of the objects that are _not_ healthy, and §B's lifecycle endpoints would otherwise have no way to find their targets. `media.read` keeps it inside the tenant, and nothing returned here may be used as a public reference.

  `deletion` is three states rather than a boolean `includeDeleted`: "show me what I deleted" is the question restore and purge exist to answer, and a boolean cannot ask it. It defaults to `live`, so deleted objects are opt-in.

  Filters and cursors are **refused when malformed, never ignored** — a silently dropped filter answers 200 with a page nobody asked for, and a corrupt cursor treated as "no cursor" serves page 1 to a caller paging through page 4, forever.

  The cursor carries full-precision `created_at` text, never a JS `Date`. A media registry is one of the likeliest places to resurrect Issue #158, because a batch upload writes many rows inside a single millisecond. `tests/integration/media-object-list.integration.test.ts` inserts 107 rows in ONE statement — so they share a transaction timestamp exactly — and walks every page; reverting the cursor to `Date` loses 57 of them and turns four tests red.

  The projection omits `bucket_name`/`storage_driver` (deployment facts a browse screen has no use for) and `owner_resource_type`/`owner_resource_id` (vestigial since ADR-0036 moved attachment to the consumer's FK — shipping them would invite a screen to present them as current).

  ADR-0056 is now complete. What remains is the `/admin/media` screen itself.

- 7ff6aa9: `GET /api/v1/media/objects` — resolusi referensi media batch, sehingga artikel
  terbit tidak lagi kehilangan gambarnya di konsumen luar.

  `awcms_blog_posts` membawa `featured_media_id` dan `seo_image_media_id`, tetapi
  `media_library` **tidak mengekspos satu pun endpoint baca** — hanya upload
  session dan flag enforcement. Konsumen di luar proses karena itu bisa melihat
  bahwa sebuah post PUNYA gambar tanpa cara apa pun mengetahui URL-nya. Itulah
  sebab `article-images.ts` di `awcms-astro` mengembalikan `src: undefined` dan
  setiap artikel terbit tanpa gambarnya, sementara tidak ada satu pun yang gagal.

  Logika resolusinya bukan hal baru: `MediaLibraryPort.resolveMediaReferences`
  sudah melakukannya untuk konsumen in-process sejak ADR-0036. Ini panggilan yang
  sama lewat HTTP, dengan aturan keamanan yang sama — hanya objek `verified` /
  `attached`, satu tenant, tidak soft-deleted, yang resolve. Tanpa migrasi:
  permission `media_library.media.read` sudah diseed sejak `sql/052` sambil
  menunggu permukaannya (ADR-0026 langkah 5d).

  Dua keputusan bentuk yang tidak sepele:

  - **Batch, bukan satu-per-id.** Build feed me-resolve seluruh gambar satu halaman
    sekaligus; satu request per id membuat situs 200 post jadi ribuan round-trip,
    sementara query di bawahnya memang sudah satu `id = ANY(...)`.
  - **Id yang gagal DILAPORKAN, bukan dibuang.** Mengembalikan hanya yang berhasil
    membuat "resource ini tidak punya gambar" dan "referensi gambarnya rusak"
    menjadi respons yang sama — ambiguitas yang membuat celah ini bertahan tanpa
    disadari. Semua sebab kegagalan dilebur ke satu ember (`unresolved`) supaya
    endpoint-nya tidak jadi oracle atas sebab mana; id yang bukan uuid ditolak 400
    karena "Anda mengirim sampah" adalah fakta yang berbeda.

  Read-only, jadi kredensial mesin (ADR-0049) boleh memegangnya — inilah yang
  melengkapi build feed.

  Diverifikasi terhadap PostgreSQL nyata (7 test): objek belum-terverifikasi,
  soft-deleted, dan milik tenant lain masing-masing TIDAK PERNAH resolve; batch
  campuran resolve sebagian alih-alih gagal utuh; dan objek yang sama tetap
  resolve dari tenant pemiliknya (memastikan kegagalan lintas-tenant itu memang
  tenant scoping, bukan baris rusak).

- 2ac4708: `GET /api/v1/media/public-origin` — the origin media public URLs are served
  from, so a build client never holds a second copy of it.

  `awcms-astro` ships a strict CSP and must name the media host in `img-src` at
  BUILD time: an image resolved correctly still renders as nothing when
  `img-src 'self'` blocks the host it lives on. Reading the origin off a
  `publicUrl` does not help, because the policy is written before any object is
  fetched, and a build with no images would then emit no `img-src` at all. The
  only alternative left was copying `NEWS_MEDIA_R2_PUBLIC_BASE_URL` into the
  consumer by hand — two copies of one value that agree until one is edited, with
  a failure (images silently blocked) that names its cause nowhere.

  Reports `origin` (scheme + host + port, for the host-wide CSP form) and
  `baseUrl` (path included, for the tighter prefix form); neither choice is this
  API's to make.

  A deployment serving no public media answers `200` with `configured: false`
  rather than an error, so a LAN/offline build omits the entry instead of
  failing. A value that is set but unparseable — or on a scheme that cannot serve
  media, `data:` above all — is reported the same way and never echoed back:
  handing a consumer a malformed origin puts it in a CSP header, where a browser
  either rejects the whole policy or allows something nobody wrote down.

  Gated on `media_library.media.read`, the permission a build client already
  holds; no new authority on any credential, and machine credentials stay
  read-only (ADR-0049). No migration.

- 68da201: Lebur `news_portal` ke `blog_content` — satu modul konten, tanpa fitur hilang.

  `news_portal` sudah berhenti membawa bebannya sendiri. 11 berkas melawan 59,
  3 tabel melawan 18, nol capability disediakan, nol rute publik, dan konsumen
  WAJIB `public_content` milik `blog_content` — setiap tipe section homepage-nya
  dibangun di atas data modul itu. Seam capability ada untuk menggambarkan
  hubungan dua modul yang masuk akal berubah sendiri-sendiri; dua ini tidak bisa.

  Yang lebih menentukan: keduanya mengapalkan sistem iklan, dan yang satu
  melemahkan kontrol keamanan yang lain. `awcms_blog_ads.image_url` menerima URL
  apa pun, sementara `awcms_news_portal_ad_placements.media_object_id` adalah FK
  ke objek media terverifikasi. Selama keduanya hidup, sebuah tenant bisa
  menyalakan enforcement managed-media (ADR-0036) dan tetap menerbitkan gambar
  remote sembarangan lewat pintu yang lain.

  Tapi keduanya bukan fitur sama dengan dua ejaan. Yang lama punya penargetan
  `post`/`page` yang tidak dimiliki yang baru; yang baru punya 12 slot penempatan,
  4 mode rotasi, dan prioritas yang tidak dimiliki yang lama. Mengganti salah satu
  dengan yang lain akan menghapus kemampuan tanpa suara — jebakan yang justru
  menjadi alasan perubahan ini ditulis sebagai UNION, dan alasan penyatuan tabel
  iklan dikerjakan terpisah setelah tabel tujuannya diperlebar lebih dulu.

  Perubahan ini:

  - memindahkan 8 berkas `domain/`+`application/` ke `src/modules/blog-content/`;
  - **mempertahankan nama tabel dan path API** (`awcms_news_portal_*`,
    `/api/v1/news-portal/*`), mengikuti preseden ADR-0036 yang memindahkan
    registry media tanpa me-rename `awcms_news_media_objects`. Rename memakan
    setiap FK, policy, index, dan konsumen sambil tidak membeli apa pun yang
    descriptor dan inventori belum catat;
  - me-repoint 4 permission lewat `sql/076` dengan urutan insert → pindahkan
    grant → hapus. Urutannya adalah keseluruhan poinnya: menghapus lebih dulu
    akan mencabut kapabilitas dari setiap tenant yang memilikinya, dengan semua
    gerbang tetap hijau;
  - menaikkan `media_library` dari `optional` menjadi capability wajib bagi
    `blog_content`, karena ad placement yang diserap memegang FK nyata — itulah
    alasan `news_portal` dulu mendeklarasikannya non-optional;
  - men-DROP `awcms_news_portal_tenant_state` (`sql/077`). Penulisnya tidak pernah
    diport, jadi tabel itu inert; tabel FORCE-RLS tanpa pemilik dan tanpa penulis
    adalah klaim palsu yang berdiri di depan setiap gerbang inventori;
  - mempertahankan preset `news_portal` dengan namanya. Preset menamai niat, bukan
    modul, dan niatnya tidak berubah.

  `tests/news-portal-merge.test.ts` menjaga janji "union, bukan pengurangan":
  setiap fitur yang selamat dipaku ke sesuatu yang bisa diamati — entri registry,
  permission terdeklarasi, prefix rute yang diklaim, berkas di disk, atau urutan
  statement di migrasinya.

- 9ce56e2: Bandingkan dua registry job yang selama ini mendeskripsikan skrip yang sama tanpa
  ada yang membandingkannya.

  `JOB_WORK_CLASS_REGISTRY` menyatakan anggaran pool sebuah skrip, dan sudah
  ditegakkan ke ground truth — generatornya MENOLAK jalan saat peta dan disk
  berselisih. `ModuleDescriptor.jobs` menyatakan sebuah job untuk APA dan seberapa
  sering operator harus menjalankannya (`recommendedSchedule`), dan disajikan lewat
  `GET /api/v1/modules/{moduleKey}/jobs`. Yang pertama ditegakkan ke filesystem;
  yang kedua tidak ditegakkan ke apa pun.

  Akibatnya sebuah skrip worker bisa sepenuhnya masuk model kapasitas tapi tetap
  tak terlihat di satu-satunya permukaan yang dibaca operator untuk tahu bahwa job
  itu perlu dijadwalkan — dan dua memang begitu:

  - **`tenant-domain:dns:sync`** — modul `tenant_domain` tak mendeklarasikan `jobs`
    sama sekali. Deskriptornya ditambahkan (jadwal: tiap 15 menit; `manual` sebagai
    default tak melakukan panggilan keluar).
  - **`edge-cache:purge`** — tak ada modul `edge_cache` untuk menggantungkan
    deskriptornya: edge cache adalah infrastruktur `src/lib/` (ADR-0043), sementara
    `ModuleDescriptor.jobs` di-key per modul. Dicatat sebagai pengecualian dengan
    alasan STRUKTURAL, bukan "belum sempat".

  `modules:jobs:check` (baru, di rantai `check`) menegakkan keduanya: tiap skrip di
  work-class registry wajib punya deskriptor dengan `recommendedSchedule` tak
  kosong. Job yang tak dijadwalkan tak pernah jalan dan tak ada yang memberi tahu —
  tak ada gate, tak ada health check, tak ada alarm.

  Tabel §Job registry di `deployment-profiles.md` dihapus alih-alih diperbarui: ia
  salinan tangan yang menua persis seperti yang diperkirakan, memuat tiga command
  ERP yang tak pernah ada sambil melewatkan sepuluh job yang benar-benar dikirim.
  §Shared worker runner juga dikoreksi — ia mengklaim ketujuh dispatcher memakai
  `runJob`, padahal `email:dispatch` dan `sync:objects:dispatch` memakai claim-lease
  per baris, yang justru MENGIZINKAN worker paralel; empat job lain belum memakai
  keduanya dan kini terdaftar apa adanya.

- 285b73d: Tenant-module matrix and per-module audit summary — the rest of #261.

  `GET /api/v1/tenant/modules/matrix` returns every module with this tenant's
  enabled state, its protected flag, and two lifecycle warnings computed by
  re-running the REAL `evaluateModuleEnable`/`evaluateModuleDisable` rather than a
  UI-side re-derivation that would drift from the endpoints. Two queries total;
  the rest is pure.

  The warnings are one-directional on purpose — `dependencyWarning` only for a
  disabled module, `reverseDependencyWarning` only for an enabled one. The other
  combinations cannot arise, and asking `evaluateModuleEnable` about an
  already-enabled module short-circuits to `MODULE_ALREADY_ENABLED`: an answer
  that looks like a check and is not one.

  No health column, unlike awcms-micro's matrix: that one is fed by a batched
  health reader this base does not have, and a per-row read would be 21 queries
  inside one transaction.

  `GET /api/v1/modules/{moduleKey}/audit` returns recent module-management
  activity for one module, guarded by `logging.audit_trail.read` — these are
  audit-log rows, so the audit-log permission governs them. The caller-supplied
  `?limit=` is clamped to 1..50, with NaN/Infinity falling back to the default.

- 1ffb11c: Tenant module presets: named profiles a tenant can be brought to in one action.

  `minimal`, `website`, `news_portal` and `back_office`. A preset ENABLES what it
  lists and DISABLES every enabled, unlisted, unprotected module — enable-only
  would make presets useless as a way to REACH a profile, since a tenant that once
  enabled `blog_content` and then applied `minimal` would stay non-minimal
  forever.

  Ported from awcms-micro (Issue #261) with its planning logic intact, but not its
  preset set: `back_office` has no counterpart there, and micro's R2/SaaS presets
  are not reproduced because the subsystems that distinguished them do not exist
  in this base — a preset naming an absent module is a dead profile.

  `GET /api/v1/tenant/modules/presets?preset=<name>` returns a dry-run plan,
  because applying one disables things and an operator should see that list first.
  `POST /api/v1/tenant/modules/presets/{presetName}/apply` executes it through the
  existing lifecycle primitives, so each change runs the real validation and a
  rejection is reported per module rather than swallowed.

  No migration and no new permission: an apply is a sequence of enables and
  disables, so it guards on `module_management.tenant_modules.disable`.

- 049e36d: Make route ownership derivable: `ModuleApiContract.routes` and
  `modules:routes:check`.

  `basePath` was the only ownership claim a descriptor could make, and
  `tenant_admin` declared `basePath: "/api/v1"` — a prefix of every route in the
  application. Resolving a route to its longest-matching `basePath` handed
  `tenant_admin` 36 routes it does not own (all of
  `/api/v1/{access,roles,users,abac,identity}`, which are `identity_access`, plus
  `/api/v1/tenant/modules`, which is `module_management`), while 30 public routes
  matched nothing at all.

  `api.routes` is a list of owned prefixes, longest-prefix wins — because
  ownership genuinely is not one prefix: `/api/v1/tenant` is split between
  `tenant_domain` and `module_management`, and public surfaces (`/blog`,
  `/robots.txt`, `/search`, `/theming`, `/login`) belong to modules too.

  `bun run modules:routes:check` (check chain + `ci.yml`) requires every file
  under `src/pages` outside `/admin/**` to resolve to exactly one module or be
  named in a reviewed `PLATFORM_ROUTES` allow-list. It also rejects `/`, `/api`
  and `/api/v1` as claims outright — a coverage-only rule cannot see them, since a
  prefix matching everything leaves nothing uncovered.

  `MODULE_CONTRACT_VERSION` 2.3.0 -> 2.4.0 (additive; `routes` omitted means
  `[basePath]`). `openapi_documented` readiness now checks every owned prefix
  rather than the display `basePath`, which for `tenant_admin` had been matching
  any path at all.

- f8d9c39: `bun run identity-access:permissions:backfill` — tutup celah yang dibuka SETIAP
  migrasi seed permission, tanpa menghidupkan kembali grant yang sengaja dicabut.

  Role `owner` sebuah tenant menerima izinnya **sekali**, saat tenant itu dibuat
  (`platform-bootstrap.ts`: `INSERT … SELECT id FROM awcms_permissions`). Migrasi
  seed berikutnya hanya memperluas katalog global. Jadi setiap tenant yang lebih
  tua dari sebuah modul akan menerima `403 ACCESS_DENIED` pada permukaan admin
  modul itu, dan tidak ada satu pun yang mengatakannya. Ini sudah terjadi di
  produksi (2026-07-26: owner kehilangan 18 permission setelah migrasi 062–070) dan
  akan terjadi lagi pada `sql/083`.

  **Kenapa "grant semua yang hilang" ditolak.** Bentuk itulah yang dianjurkan
  `environments.md` sebelumnya (`LEFT JOIN … WHERE rp.permission_id IS NULL`), dan
  ia tidak bisa membedakan "belum pernah ada saat tenant dibuat" dari "dicabut
  admin dengan sengaja" — surface role admin memang menyediakan penghapusan itu.
  Ia akan mengembalikan persis grant yang seseorang putuskan untuk dihapus, di
  seluruh tenant sekaligus, tanpa jejak. Arah kegagalannya juga yang paling buruk:
  melewatkan sebuah permission terlihat sebagai 403 yang bisa dilaporkan; memberi
  permission yang tak seharusnya tidak terlihat sama sekali.

  **Aturannya**: hanya permission yang **baris katalognya lebih baru** dari role
  owner yang di-grant. Yang lebih tua tidak mungkin merupakan tambahan yang
  terlewat — ia ada saat seed pertama, jadi ketidakhadirannya adalah keputusan.
  Perbandingannya `>` bukan `>=`: bootstrap menulis role dan grant-nya dalam satu
  transaksi, sehingga permission ber-stempel sama dengan role-nya JUSTRU bagian
  dari seed asli.

  Dry-run **default** (`--commit` untuk menulis, `--tenant <kode>` untuk rollout
  bertahap), idempoten (`ON CONFLICT DO NOTHING`), satu entri audit per tenant yang
  benar-benar berubah — dan tidak ada entri saat tak ada perubahan, karena log
  pemeliharaan yang berbunyi di setiap no-op melatih pembacanya untuk
  mengabaikannya. Role kustom tidak pernah disentuh.

  Diverifikasi terhadap PostgreSQL nyata (6 test integrasi) termasuk hal yang
  paling penting: 403 yang jadi alasan tool ini ada benar-benar hilang setelah
  backfill, sementara permission yang sengaja dicabut **tetap** ditolak sesudahnya.
  Aturannya mutation-proven: mengganti seleksinya jadi "semua yang hilang"
  memerahkan 3 test unit dan 4 test integrasi.

- 5702ab1: Ownership-based grants now run through the authorization chokepoint (ADR-0063).

  Three handlers — `PATCH /api/v1/blog/posts/{id}`,
  `POST /api/v1/blog/posts/{id}/submit-review` and `PATCH /api/v1/blog/pages/{id}`
  — decided permissions themselves from `fetchGrantedPermissionKeys` plus a domain
  rule, never calling `authorizeInTransaction`. That skipped the ABAC evaluator,
  the ADR-0053 platform-scope gate, ADR-0060 business-scope facts and #181 SoD. The
  visible consequence: a tenant's explicit ABAC `deny` was honoured on some routes
  and silently ignored on these three.

  None of the three was sloppiness. They enforce the product rule that an author
  may edit their own unpublished content **even without** holding the permission —
  an authorization axis the permission catalogue cannot express — while the
  chokepoint returns `denied` before any domain rule is consulted. Putting it in
  front would have deleted the author path: a functional regression that looks like
  a security tightening.

  `authorizeInTransaction` therefore gains `ownershipGrant`, which **widens** the
  permission set being evaluated instead of short-circuiting the decision. Tenant
  isolation, an ABAC deny, business scope and SoD can all still refuse. Machine
  credentials are excluded, since a credential authenticates and never authorizes.
  The decision log labels ownership allows `ownership_grant:<reason>` so an auditor
  can tell them from RBAC allows.

  New gate `bun run access:chokepoint:check` holds the class: every handler calling
  `fetchGrantedPermissionKeys` must go through the chokepoint or be a reasoned
  exemption keyed `<file>#<METHOD>`. It slices **per handler**, because a per-file
  reading is what produced the original mis-analysis — `blog/posts/[id].ts` calls
  the chokepoint in `GET` and `DELETE` while `PATCH` did not. Two exemptions:
  pre-authentication login, and the self-introspection endpoint that calls
  `evaluateAccess` directly.

  Behaviour changes in one direction only: an action that previously slipped past
  ABAC can now be refused by a tenant's own policy.

  No migrations, no new permissions, no OpenAPI change.

- 6ed60e0: Add email password reset — the flow this repo has shipped a template for since
  `sql/014` and never had a caller for.

  `email`'s `auth.password_reset` category, default template, and declared
  variables (`userName`/`resetUrl`/`expiresInMinutes`) have existed unused all
  along, so an operator who locked themselves out had no in-band recovery. Two
  public endpoints (`POST /api/v1/auth/password/{forgot,reset}`), two pages
  (`/forgot-password`, `/reset-password`), and one table (`sql/073`,
  `awcms_password_reset_tokens`, RLS `FORCE`, only a `sha256` of a 256-bit CSPRNG
  token ever stored) close it. Adapted from awcms-micro Issue #496.

  **Neither endpoint is an oracle.** `forgot` returns one fixed 200 body for
  every outcome — unknown identifier, inactive identity or tenant-user, SSO-only
  identity, a non-mailable identifier, and a queued email are indistinguishable.
  `reset` returns one generic rejection for not-found, expired, already-used,
  deactivated-since-issue and password-login-disabled-since-issue. The specific
  reason survives only in the tenant-scoped, RLS-protected audit trail.

  **Single use is enforced by the database, not by JavaScript.** Redemption reads
  the token `FOR UPDATE`; without that lock two requests carrying the same link
  both observe `used_at IS NULL` and both reset the password. That is
  mutation-proven — removing the lock turns the concurrency test red.

  **An SSO-only identity cannot recover a password**, checked on the request path
  and re-read at redemption so a live link does not survive the tenant turning
  password login off. Without it, reset would be a supported, unauthenticated way
  to mint a working password on a tenant that deliberately disabled them.
  Break-glass identities are exempt, matching `login.ts`.

  **A completed reset revokes every session of that identity**, `aal2` included,
  and clears the lockout counters — the link holder proved control of the mailbox.

  **Delivery goes through a new `auth_notification` capability port**, not an
  `INSERT` into `awcms_email_messages`. That table belongs to `email` (ADR-0013
  §6) and the micro original wrote into it directly; it also cannot be a
  `dependencies` edge, because `email` already depends on `identity_access` and
  the reverse would close a cycle. A tenant with no active template reports
  `delivery_unavailable` — logged and audited for the operator, invisible to the
  caller.

  Optional hardening: with `AUTH_URL_PARAM_ENCRYPTION_KEY` set, the emailed link
  carries one opaque AES-256-GCM `?p=` value instead of `?token=…&tenantId=…`.
  Unset, it falls back to plain params — the token is a 256-bit CSPRNG value
  either way, so this tightens a deployment rather than gating the feature.

  Also: `/login`'s auth styles move to a shared `src/styles/auth.css` and its
  tenant picker to `tenant-admin`'s `tenant-picker-directory.ts`, both now used by
  all three auth pages instead of being copied twice.

- a30eb06: Add PLATFORM-scoped permissions, and bring back the region-dataset console at `/admin/idn-regions`.

  ADR-0051 made a rule normative — an action whose effect crosses tenant boundaries must have a platform-scoped gate and must not sit in the catalogue seeded to tenant roles — but the primitive that rule needs did not exist. ADR-0052 therefore could not guard region-dataset activation/rollback; it could only delete them. This builds the gate (ADR-0053) and restores the surface behind it.

  `awcms_permissions` gains a `scope` column (`tenant` | `platform`, default `tenant`), declared in code as `ModulePermissionDescriptor.scope` (`MODULE_CONTRACT_VERSION` 2.5.0, additive). The blanket grant in `bootstrapPlatformTenant` — `SELECT id FROM awcms_permissions`, which is what handed cross-tenant authority to every tenant owner in the first place — now filters on it, so the next platform permission is safe the moment it is declared rather than the moment someone remembers. The owner backfill excludes them too.

  Platform authority belongs to the platform tenant, resolved `PLATFORM_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE` → `awcms_setup_state.tenant_id`, and held by that tenant's `owner` role. `authorizeInTransaction` refuses a platform-scoped permission unless the acting tenant is that tenant — decided before permissions are looked up, and fail-closed when none resolves, so a grant row that reached the wrong tenant is inert rather than sufficient. The trigger is read from the code declaration, not the database column: were both the database, one `UPDATE` would remove the gate along with the grant filter and nothing would go red.

  Tenancy mode (`single`/`multi`) is derived from the active-tenant count, never configured — a stored flag would have to be flipped by whoever provisions tenant number two, and forgetting means the deployment keeps behaving as if one tenant owned everything. The mode never relaxes a gate.

  While `PLATFORM_TENANT_ID` is unset, `PUBLIC_DEFAULT_TENANT_ID` is a security control: repointing which site renders on an unmatched host also repoints platform authority. That is a deliberate trade-off, made separable without a migration by the dedicated variable, and made visible by a new `security:readiness` check that reports which tenant holds the authority and warns when it is not the bootstrap tenant.

- bc0ab66: `POST /api/v1/profiles/{id}/restore` — the counterpart `DELETE
/api/v1/profiles/{id}` shipped without (ADR-0058 §A).

  `sql/003` gave `awcms_profiles` `restored_at`/`restored_by` and an index on
  `(tenant_id, deleted_at)`, and `party-directory.ts` exported `softDeleteParty`
  with nothing to undo it. Nothing in the repo could write either column, so a
  soft-deleted profile was permanent while `profile_management.restore` sat
  seeded in the catalogue and enforced by nothing.

  The precondition is the `WHERE … deleted_at IS NOT NULL`, not a read before the
  write: two concurrent restores that both read first would both proceed and
  audit two restorations of one profile. `delete_reason` is kept — why the
  profile was deleted stays true after it is restored. A profile that does not
  exist and a profile that is not soft-deleted answer the same 404, so the route
  cannot be used to probe which profile ids exist.

  Permission-enforcement coverage moves from 201/205 with 4 exceptions to 202/205
  with 3.

- a21f684: Beri `--dry-run` pada dua job retensi destruktif yang selama ini tak punya, dan
  hentikan headernya mengklaim kemiripan yang tidak ada.

  `form-drafts:purge` **menghapus baris secara fisik**; `comments:retention`
  meng-NULL-kan kolom identitas penulis **secara tak terbalikkan** lalu menghapus
  langganan yang tak pernah dikonfirmasi. Keduanya menyatakan di headernya sendiri
  bahwa mereka meniru `scripts/audit-log-purge.ts` — yang sudah punya pratinjau
  sejak dikirim. Keduanya tidak. Jadi satu-satunya cara mengetahui radius ledakan
  run pertama adalah menjalankannya.

  Dua hal yang membuat pratinjau ini bukan sekadar penghitung:

  - **Satu fungsi cutoff, dipakai bersama.** `resolveFormDraftRetentionCutoff` dan
    `resolveCommentsRetentionCutoff` diekstrak, lalu jalur nyatanya ikut memakai —
    dua salinan `now - days * 86400000` akan menyimpang begitu salah satunya
    diedit, dan pratinjau yang tak sepakat dengan run yang dipratinjaunya lebih
    buruk daripada tak ada.
  - **Legal hold ditanya, dan dilaporkan.** Deskriptor yang di-hold membuat run
    nyata tak menyentuh apa pun; pratinjau yang mengabaikannya akan melaporkan
    backlog yang tak akan pernah disentuh run mana pun — justru angka yang paling
    mungkin ditindaklanjuti operator. `comments:retention` melaporkan
    `heldTenants` supaya "tak ada yang perlu dikerjakan" bisa dibedakan dari
    "sedang di-hold".

  Header keduanya juga dikoreksi: alih-alih mengklaim meniru job yang memakai
  `runJob`, keduanya kini menyatakan apa yang memang TIDAK mereka punya (advisory
  lock, telemetry `JobResult`, cancellation kooperatif) dan bahwa karenanya
  keduanya harus dijadwalkan dari SATU entri cron. Migrasi ke `runJob` tetap
  dilacak di isu #291.

- 5935dc7: Revoke `blog_content.seo.configure` and `blog_content.posts.export`
  (ADR-0058 §C/§D, `sql/089`), completing the ADR and emptying the
  permission-enforcement exception list.

  Both were seeded by `sql/036` and declared by the descriptor, and neither ever
  had an enforcer. They are revoked rather than surfaced for different reasons:
  `seo.configure` is a second authorisation axis over
  `seo_default_title`/`seo_default_description`, which
  `blog_content.settings.configure` already governs through
  `PATCH /api/v1/blog/settings`; `posts.export` has no export machinery anywhere
  in the repo, so building one to justify a catalogue row would be the tail
  wagging the dog.

  Because `POST /api/v1/setup/initialize` grants the whole catalogue to each new
  tenant's `owner` role, every tenant owner has been holding authority over two
  actions nothing checks. No behaviour changes — nothing ever read them.

  The migration deletes the role grants before the catalogue rows (the FK runs
  that way), is idempotent, and ships no rollback: restoring the grants would
  re-advertise a surface that does not exist.

  `bun run access:permissions:enforcement:check` now reports **203/203 with zero
  exceptions** — every declared permission in the repo has an enforcer.

- ac7503d: Add admin-approved self-registration — off by default, and it never stores a
  credential.

  `POST /api/v1/auth/register` records a request; `/admin/registrations` reviews
  it; approval creates the account. Two migrations (`sql/074` schema, `sql/075`
  permissions), one public page (`/register`), three guarded admin endpoints.

  **Off unless `AUTH_SELF_REGISTRATION_ENABLED=true`**, and a disabled deployment
  answers `404` — the same answer a nonexistent route gives, so the switch is not
  discoverable by probing. An always-on public endpoint that writes a row is a
  spam surface every deployment would otherwise inherit. It is a deployment-level
  gate like `AUTH_MFA_ENABLED`, so turning it on opens registration for every
  tenant; per-tenant granularity is recorded as a follow-up rather than implied.

  **The public path creates no account and accepts no password.** It writes a
  `pending` row and nothing else, rejects every privilege field (`roleIds`,
  `status`, `tenantUserId`), and the validator returns exactly two keys — proven
  twice, at runtime by asserting the returned key set and structurally by
  enumerating which fields are read off the untrusted body. Mutation-proven:
  leaking `roleIds` through the validator turns both red.

  **Approval issues a credential the applicant must claim, which is a deliberate
  departure from awcms-micro.** micro stores an argon2id hash chosen by an
  unverified stranger for an account that may never exist. Here the identity is
  created with an _unusable_ password — the hash of 32 CSPRNG bytes discarded
  immediately — and the applicant receives a password-reset link through the same
  flow `/forgot-password` uses. So no anonymous submitter's secret is ever stored,
  a rejected or abandoned request leaves no credential behind, a spam flood costs
  an INSERT rather than an argon2id hash, and the applicant proves mailbox control
  before the account works. The cost is stated rather than hidden: `approve`
  returns `delivery: "queued" | "unavailable"` so the admin screen can say when
  the link could not be sent instead of showing a success for an account nobody
  can get into.

  **Enumeration-safe.** An address that already has an account, one with a request
  already pending, an inactive tenant and a fresh request all return the identical
  200 — "this address is already registered" is the single most useful sentence an
  attacker could be handed here. The audit event records which it was, without the
  submitted address on a miss.

  **`approve` and `reject` are separate permissions** under a new
  `registration_requests` activity. `access_control` is the RBAC catalog, not the
  authority to admit a person, and `/api/v1/users` in this repo is read-only — so
  approval is the first admin path that materializes an identity at all, and
  clearing spam should not require the ability to admit anyone. `roleIds` is
  optional and defaults to none; an unknown role refuses the whole approval rather
  than granting the subset that resolved.

  **Approval is race-safe**, with `FOR UPDATE` on a `status = 'pending'`
  predicate. Mutation-proven: without the lock two concurrent reviewers trip
  `awcms_identities_tenant_login_key` mid-transaction and the second gets a 500;
  with it, a clean 404. Correctness was never at risk — the failure mode was.

  Rejection notifies nobody: a rejection email would confirm to an anonymous
  submitter that this tenant exists and reviewed them, which is exactly the
  disclosure the submit endpoint refuses to make.

  Reviewed rows are purged by the existing `data_lifecycle` GENERIC engine (90d
  default, 7d floor so the `registration_approved` audit row still points at
  something); the worker grant is `SELECT, DELETE` only — one able to write here
  could manufacture an approved registration.

- 2b92a68: Admin screen for `seo_distribution` at `/admin/seo`, plus the sidebar entry that makes it reachable.

  The module shipped a complete admin API (tenant SEO defaults, redirect rules, redirect policy, 404 governance) but no screen, and declared no `navigation` — so every one of its permissions was routed while the module stayed invisible in the sidebar. One page now carries four panels: SEO defaults, redirect policy, redirect rules (create with a read-only dry run, inline edit, activate/deactivate/archive, soft delete, and an id-addressed restore/purge panel because soft-deleted rules are excluded from the list), and the privacy-minimized 404 log (resolve / dismiss).

  Reads run server-side through the same application-layer functions the JSON routes use, inside one tenant transaction; every write goes out over `fetch` to the guarded endpoints, with a fresh `Idempotency-Key` per click on the four high-risk mutations. Permission gates are UX-only — notably the lifecycle endpoint's dynamic guard is honored: Purge is gated on `seo_distribution.redirect.delete` and activate/deactivate/archive/restore on `seo_distribution.redirect.update`. Bulk import and URL-change capture stay API-only.

- f0d90a6: Build the `awcms` half of ADR-0050: a BFF obtains a human session with a one-time handoff code, never by proxying a password.

  ADR-0049 answered half the question — a BFF that already holds a session token can ask "whose session is this". Where the token came from was still document-only. `awcms_session` is an httpOnly cookie on the `awcms` origin; a browser on the `awcms-astro` origin will never send it, and must not.

  The obvious workaround — a login form in `awcms-astro` proxying `POST /api/v1/auth/login` — was rejected twice over: a password would cross a repo that is not the identity store, and **login here is not one step**. It can answer `401 MFA_REQUIRED`, redirect into a tenant's OIDC provider, or demand a Turnstile token, so proxying means a second implementation of MFA continuation, OIDC callback, and the Turnstile widget in a second repo.

  **Two endpoints, two different principals:**

  - `POST /api/v1/auth/session-handoff/issue` — the already-authenticated human asks for a code. Self-service rather than permission-gated: the identity and assurance come from the presented **session**, never from the body, so a caller can only ever mint a code for themselves. Inventing a permission here would be the latent-authz trap this repo has shipped twice.
  - `POST /api/v1/auth/session-handoff/redeem` — a registered client, server-to-server, with a client secret. The only endpoint in this repo authenticated that way, which is why `_shared/tenant-route.ts` gains a third factory: this is the request that _obtains_ a session, so there is none to present, and a machine credential (read-only by construction) minting a human session would be an escalation path.

  **What binds the security:**

  - **Exact-match `redirect_uri` allow-list.** ADR-0050 names the open redirect here as the way this design fails. Not a prefix — `https://app.example.com` prefix-matches `https://app.example.com.evil.test` — and not an origin match either, since an attacker who can choose the path on a permitted origin is enough. Query strings and fragments are refused rather than stripped.
  - **The code carries no token.** The row stores `identity_id` plus the assurance the login actually _reached_; redemption mints a fresh session. Nothing credential-bearing is stored but the one-way hash of the code, and assurance never rises, so an `aal1` login cannot be laundered into an `aal2` session.
  - **Single-use under concurrency**, claimed with `UPDATE … WHERE redeemed_at IS NULL RETURNING …`. The read-then-write version lets two simultaneous redemptions both succeed.
  - **The spent row is kept**, so a replay is answered from evidence — a deleted row and a code that never existed are indistinguishable, and that difference is what an incident needs.
  - **One answer for every failure** (`401 HANDOFF_REJECTED`), including a malformed body: a 400 for "you forgot a field" and a 401 for "your secret is wrong" already separates well-formed guesses from malformed ones.
  - The ≤60 second TTL is a database CHECK, not only a TypeScript constant.

  **A trap the integration test caught, and reading would not have.** `created_at DEFAULT now()` is the _transaction start_ instant while `expires_at` is derived from the application clock — two different clocks, so the `expires_at <= created_at + 60 seconds` CHECK rejected perfectly ordinary codes once a transaction had been open for a moment. The application now writes both from one clock.

  Ten integration tests, including two concurrent redemptions on separate connections (mutation-proven: dropping the `redeemed_at IS NULL` guard mints two sessions from one code) and cross-tenant isolation. Eighteen pure tests over the redirect-uri and redemption decisions.

  What remains is `awcms-astro`'s: `/internal/login`, server-side BFF session storage, the portal cookie, and CSRF.

- 9c7eeb7: Rate limiting becomes a property of the deployment, and covers the whole
  authentication surface (ADR-0066).

  The limiter counted in an in-process `Map`, so with N replicas the effective
  limit was N × the configured one — anti-brute-force weakening in direct
  proportion to replica count, leaving the deployments that most need protection
  the weakest.

  `checkSharedRateLimit` counts in Redis, which the repo already had. The window
  number is part of the KEY rather than a stored timestamp, which is what makes it
  correct where the `Map` is not: two instances agree without a read-modify-write,
  so there is no race to win. `PEXPIRE` fires only on a window's first hit —
  re-setting it every hit would slide the window and let a steady attacker hold
  the key alive indefinitely. With no Redis configured it falls back to the map,
  since a single-instance deployment has nothing to share.

  **It fails OPEN when Redis is unreachable.** That is the opposite of this repo's
  default posture, so: a rate limiter is availability tooling on the login path,
  and failing closed would turn a Redis outage into "nobody can log in" — an
  attacker-triggerable denial of the whole control plane. The per-identity lockout
  is enforced atomically in PostgreSQL and is unaffected, so this is the
  source-scoped backstop rather than the last line.

  Coverage rises from eight surfaces to eleven: `session-handoff/issue`,
  `session-handoff/redeem` and `sso/{providerKey}/callback` had none. Each had
  other mitigations, so this is completeness rather than a hole — but ASVS V11.2
  wants anti-automation across the whole authentication surface.

  No migrations, no permissions, no OpenAPI change.

- c74d4d1: Per-tenant admin sidebar arrangement: reorder, hide, relabel, move between
  sections, and custom sections.

  The sidebar has been rendered from the module registry since #259. This adds the
  override layer on top of it (`sql/071`, `sql/072`), plus
  `/api/v1/tenant/navigation/sidebar` and an `/admin/sidebar-menu` editor.

  Stored as a DELTA, never a snapshot: a tenant with no rows renders exactly the
  code default, so a newly added module's nav entry appears everywhere without a
  data migration. A snapshot would freeze each tenant's sidebar at the moment they
  first touched it.

  A tenant can override, never inject. Every stored row is resolved by key against
  the code-derived model and one that matches nothing is ignored, so there is no
  path from a request body to a new menu link. Overrides are applied BEFORE
  permission and tenant-disable filtering, so relabelling or moving an entry
  cannot carry it past `requiredPermission`.

  `module_management.navigation.configure` gates the mutations. Existing tenants
  do not gain it automatically — `sql/072` carries the operator backfill note.

- 23ce7bb: Add the `/admin/site-search` operations console and put `site_search` in the admin sidebar.

  The module shipped its index/settings/diagnostics API (ADR-0040) without a screen, so the whole surface was reachable only by `curl` and `site_search` was invisible in the sidebar. The console renders index status and freshness, documents by resource type, the ten most recent index runs, and the failed-item diagnostics, and drives reconcile, rebuild, and the search-configuration form.

  Reads call the same application functions the JSON endpoints use, inside one `withTenantOrThrow` transaction. Writes go to the guarded `/api/v1/site-search/*` endpoints with a fresh `Idempotency-Key` per click, so a deliberate second run really runs instead of replaying the first run's stored response. Every permission gate on the page is UX-only — the endpoints remain the authority.

  `tests/admin-site-search-page-contract.test.ts` pins the page's six permission keys to what the routes enforce and the descriptor declares, so a plausible-but-unseeded key (`settings.configure`, `index.update`) cannot silently hide a panel from everyone including the owner.

- 40315d2: `.claude/skills/` is gated against the code it describes (ADR-0062).

  `bun run skills:check` joins the `check` chain. The exemption it retires was
  justified when written — skills carried awcms-mini adaptation notes that
  legitimately named absent tooling — but ADR-0055 removed that justification:
  once mini/micro became archives, a skill that reads as a porting instruction
  points work at a repo that does not move.

  What the exemption cost, measured when the gate was written: eleven consecutive
  ADRs (0051–0061) landed with **zero** skills referencing any of them; four
  skills for live modules pointed at `src/lib/<module>/…` for files that now live
  at `src/modules/<module>/presentation/…`; several announced admin screens as
  un-ported months after those screens shipped; and six still taught the
  mini-first pathway two days after it was retired.

  Stale skills decay in the dangerous direction. A stale doc makes a reader pause;
  a skill is followed. "This module is not in this repo" starts out true, the
  module gets built, and the sentence ages into a confident falsehood.

  Three rules, none of which read intent — each keys off the module registry:

  1. A live module's skill must cite `src/…` paths that exist. No exception list:
     a skill for shipped code has no reason to name a file that is not there.
  2. Every cited `ADR-NNNN` must resolve to a file in `docs/adr/`.
  3. A skill for code that does not exist must be listed in `ASPIRATIONAL_SKILLS`
     as `target-spec`, `historical` or `cross-cutting`, with its reason. Dead
     entries — where the module has since been built — are reported too.

  All 55 skills were brought into line: 10 wrong paths fixed, the six mini-first
  skills reframed as "build here with an admission ADR", and the edge-cache,
  media-library, blog-content and seo-distribution skills corrected against what
  actually shipped.

  Zero migrations, zero permissions, zero runtime change — no file under `src/`
  changes behaviour.

- 0b97e67: Tambah `checkSsoBreakGlassReady` ke `bun run security:readiness` (critical) —
  menutup sisi kedua jaminan break-glass yang selama ini tak ditegakkan apa pun.

  `saveTenantAuthPolicy` menolak (`409 BREAK_GLASS_REQUIRED`) menyimpan
  `sso_required=true` atau `password_login_enabled=false` tanpa minimal satu
  identity break-glass yang eligible **saat itu**. Tapi eligibility bukan properti
  policy — ia properti `awcms_identities` dan `awcms_tenant_users`. Menonaktifkan
  identity itu, atau mencabut membership tenant-nya, membuat policy yang tersimpan
  menjadi salah **tanpa policy-nya pernah ditulis ulang**; keduanya aksi
  administrasi user biasa yang tak seorang pun mengaitkannya dengan lockout SSO.
  Setelah itu tenant hanya berjarak satu outage IdP dari tidak punya jalan masuk
  sama sekali, dan seluruh check lama tetap hijau.

  Check baru menurunkan ULANG eligibility dari database untuk setiap tenant aktif
  memakai `fetchEligibleBreakGlassIdentityIds` + `evaluateBreakGlassRequirement`
  yang **sama persis** dengan jalur simpan — bukan salinan aturan kedua yang bebas
  melenceng. Satu `withTenant` per tenant (tabel policy FORCE RLS; check berjalan
  di bawah isolasi yang sama dengan aplikasi), tanpa cap/LIMIT — sebuah batas akan
  membuat tenant terkunci di luar batas tak terlaporkan sementara check mencetak
  PASS. Evidence menyebut tiap tenant bermasalah beserta pemicunya:
  `password_login_enabled=false` (login lokal MATI sekarang) atau `sso_required`
  saja (advisory, login password masih jalan), dan tak pernah mencetak
  `login_identifier`.

  Terbukti lewat mutasi, bukan diasumsikan: mengganti hitungan eligible dengan
  `breakGlassIdentityIds.length` — persis bug yang check ini cari — memerahkan 4
  test integrasi; membuang separuh `password_login_enabled` dari pemicu memerahkan
  1. Test kontrak menegakkan pemanggilan di CALL SITE, karena mutasi pertama itu
     tak menyentuh baris import sama sekali.

- ed324d3: Tegakkan ADR-0013 §6 ("no shared-table write") sebagai gate, dan hentikan satu
  pelanggaran nyata yang sudah menyimpang.

  `_shared/module-contract.ts` menyebut aturan itu **empat kali** — di dokumentasi
  `dataLifecycle`, `searchSources`, `commentableResources`, dan
  `reportingProjections` — sebagai alasan tiap seam mengoper metadata deklaratif ke
  engine pusat alih-alih menjangkau skema modul lain. Keempat seam itu menaatinya.
  SQL tulis-tangan di luar seam tak pernah diperiksa siapa pun, dan **enam tabel
  ditulis lebih dari satu modul**.

  Biayanya sudah terlihat dalam bentuk terkecil: `identity_access` punya DUA
  `INSERT INTO awcms_profiles` independen (JIT provisioning #185 dan approval
  self-registration #276) yang sudah menyimpang pada `verification_status` — dua
  akun yang dibuat berselang menit mendapat postur verifikasi berbeda tanpa ada
  yang pernah memutuskannya. Keduanya kini lewat
  `profile_identity`'s `createPersonProfileForIdentity`, dengan argumen
  `emailVerified` yang eksplisit.

  `bun run modules:table-writes:check` (baru, di rantai `check`) menegakkan
  "paling banyak satu penulis per tabel". Kepemilikan **diturunkan, bukan
  dideklarasikan**: aturannya adalah properti kode apa adanya, jadi tabel baru
  ikut tercakup tanpa perlu didaftarkan — gate tak bisa basi ke arah berbahaya.
  Rute `src/pages` diatribusikan lewat `api.routes`, jadi `INSERT` di rute milik
  sebuah modul bukan penulis kedua. Tulis dinamis (`${tableName}` milik engine
  `data_lifecycle`/`reporting`) sengaja di luar cakupan dan dinyatakan di header —
  itu justru mekanisme yang diresepkan §6.

  Satu pengecualian ber-alasan: `tenant_admin/application/platform-bootstrap.ts`,
  wizard sekali-jalan yang membuat tenant/office/profil/identity/tenant-user/role
  dalam satu transaksi sebelum modul mana pun bisa dipanggil lewat permukaan
  normalnya. Bentuk pengecualiannya `excusedOwner` (memaafkan SATU penulis
  tambahan), bukan daftar owner yang boleh — versi pertama memakai daftar owner
  dan diam-diam mengizinkan kembali tulis `identity_access` yang baru saja
  dihapus; test pertama gate ini yang menangkapnya.

- d7f16c7: Add tenant provisioning: `GET`/`POST /api/v1/tenants` and the `/admin/tenants` screen, both PLATFORM-scoped.

  Until this, a second tenant could not be created at all — `POST /api/v1/setup/initialize` claims the `awcms_setup_state` singleton, so it succeeds exactly once and nothing else touches `awcms_tenants`. Every deployment was permanently single-tenant, which also meant ADR-0053's `multi` tenancy mode was unreachable and its platform gate had never met a real second tenant.

  `createTenantWithOwner` is extracted from `bootstrapPlatformTenant` and shared by both callers. That is a security control rather than tidiness: the one thing that must never differ between them is `WHERE scope = 'tenant'` on the owner grant, and an independently written provisioning routine would carry a copy of an `INSERT` that, for most of this repo's life, did not have that filter — handing every customer authority over every other customer's served data, in a diff that reviews cleanly. `grantPlatformScope` is a parameter rather than a branch on "is this the first tenant?", so the answer is stated at the call site instead of inferred.

  Both permissions are platform-scoped. `create` obviously — adding a tenant adds a party to the deployment. `read` too, and that one is easy to miss: the directory lists EVERY tenant, so a tenant-scoped read would let any customer's owner enumerate the platform's customer list, and no RLS policy would object because `awcms_tenants` is deliberately the RLS-free root table. Because both are platform-scoped, a provisioned tenant never receives them — including the tenant created through this very endpoint.

  A duplicate `tenant_code` needs both a pre-check and a savepoint: in PostgreSQL a `23505` aborts the transaction, so catching it and carrying on does not work, and the commit `withTenant` performs on a returned 4xx would fail too. The `SELECT` answers the ordinary case; the savepoint makes the racing case recoverable instead of a 500.

  The owner password never enters the idempotency hash — that hash is stored, and a stored hash of a credential is a credential at rest.

- da21f77: Close the authorization chokepoint: `defineTenantRoute` + `api:tenant-route:check`.

  The auth/tenant opening that 204 route files copy verbatim now lives once in
  `src/modules/_shared/tenant-route.ts`. `workClass` is REQUIRED in the factory
  type with no default — 176 of those 204 files pass none today, so they share
  login's pool budget by omission rather than by decision.

  The four `/api/v1/reports/*` routes are migrated. They had hand-rolled the guard
  chain and called `evaluateAccess` with three arguments of five, which skipped
  `resolveModuleEnabled` and dynamic ABAC entirely: a tenant that disabled
  `reporting` was still served, and a `deny` policy authored through
  `/api/v1/access/policies` was silently inert. Both are now enforced, so those
  endpoints newly return `403 MODULE_DISABLED` when the module is off and honour
  ABAC. They also accept a session cookie as well as a bearer token, because
  `resolveAuthInputs` reads both.

  `bun run api:tenant-route:check` rejects any NEW route that calls `withTenant`
  directly. The 204 pre-existing routes are listed in a `NOT_YET_MIGRATED` ledger
  that can only shrink: a stale entry fails the gate too.

- a7963d8: Add `/admin/theming` — the console for the theme lifecycle the `theming`
  endpoints have been serving since ADR-0034 Fase 3 with no screen at all.

  Draft, validate, preview, publish, rollback and retire were fully implemented,
  ABAC-gated, idempotency-keyed and audited, yet reachable only by hand-writing
  `curl`, and the module declared no `navigation` — so it was also invisible in the
  sidebar. The screen and the navigation entry land together: an entry without a
  page is a permanent 404 in the menu, and a page no descriptor claims can never
  appear in it.

  **The draft editor is generated from the theme descriptor, not hand-written.**
  `ThemeDescriptor` bounds the configurable surface completely, so the form renders
  one control per declared token (typed by `token.kind` — `<select>` for
  `font_family`, a numeric input for `number`, text for colour/dimension), one
  `<select>` per slot restricted to that slot's own variants, one field per
  declared asset slot, plus section order and nav placement. A JSON textarea would
  have been the honest fallback for an open-ended config and is not needed here.
  Colour tokens stay text inputs on purpose: `<input type="color">` normalises
  every value to hex and would silently rewrite a stored `rgb()`/`hsl()` value that
  `validateColorValue` accepts. Because each theme declares its own tokens, the
  theme picker navigates to `?theme=<key>` and the server re-renders that
  descriptor's field set rather than merging a superset.

  **The gates reuse the endpoints' exact permission keys**, which is harder than it
  looks here because the screen's verbs and the seeded actions disagree: the button
  says "Roll back" and the permission is `theming.version.restore`; the button says
  "Retire" and the permission is `theming.version.archive`. Inventing the tidier
  `version.rollback`/`version.retire` that no migration seeds would hide those
  controls from everyone including the owner — the latent-authz bug this repo has
  already shipped twice. `tests/admin-theming-page-contract.test.ts` extracts the
  guard triples from the seven route sources and the `permissionKey(...)` triples
  from the page, and requires the page's set to be a subset of both what the routes
  enforce and what the descriptor declares. Mutation-proven: `version.rollback` and
  `config.publish` each turn two tests red.

  **Draft-save, publish, rollback and retire each mint a fresh `Idempotency-Key`
  per click; validate sends none.** A reused key replays the stored response
  instead of acting, so a deliberate second publish would silently do nothing;
  validate writes nothing and requires no key, and the test pins both halves.

  **Preview shows its result instead of reloading it away.** The raw preview token
  is returned exactly once, so that one action reads the response body through a
  small page-local helper rather than the shared `sendJson`, whose narrow
  `{ ok, errorCode }` return is a deliberate guard for the dozen other call sites.
  The returned URL is accepted only when it is in the documented
  `/theming/preview/` namespace, so an unexpected body can never become an
  arbitrary link. Every mutation on the page still goes through `sendJson`.

  The responsive-preview dashboard (side-by-side breakpoint rendering) remains a
  documented follow-up.

### Patch Changes

- 26db824: Correct a stale claim: `idn-admin-regions` is not screenless, so ADR-0021's criterion 1 has **zero** exceptions rather than one.

  `docs/PROJECT_STATE.md` §4 listed `idn-admin-regions` as "deliberately without a screen, see ADR-0052", the contract test added with `/admin/media` carried a matching carve-out, and PR #345's own body repeated it as fact. All three were wrong: `/admin/idn-regions` landed in #332.

  ADR-0052 moved that module's dataset **lifecycle** to operator jobs — not the whole module — and the two read permissions it kept are exactly what that screen drives. Verified against the code rather than the documents: `grep -L 'navigation:' src/modules/*/module.ts` now returns nothing at all.

  The carve-out also failed in the other direction. With `idn_admin_regions` excused, that module could have **lost** its screen and the test would still have passed — an exception written for a module that did not need one, protecting it from the check it was supposed to be under. The assertion is now a plain `toEqual([])`, mutation-proven by removing `idn-admin-regions`' navigation entry.

- d8a6c34: ADR-0050 — BFF `awcms-astro` memperoleh sesi manusia lewat **kode handoff
  sekali-pakai**, bukan dengan mem-proksi password.

  ADR-0048 sengaja meninggalkan "bagaimana layar internal login". ADR-0049
  menyelesaikan setengahnya (BFF yang sudah memegang token bisa mengintrospeksinya);
  yang belum dijawab adalah dari mana token itu datang.

  Keputusannya: `awcms` tetap satu-satunya tempat kredensial diterima. Pengguna
  login DI `awcms` — password, MFA, OIDC, Turnstile, semuanya alur yang sudah ada —
  lalu dialihkan balik membawa `code` berumur ≤60 detik yang ditukar BFF
  **server-ke-server**. Token sesi tidak pernah sampai ke browser.

  Alternatif "BFF mem-proksi password" ditolak, dan alasan yang menentukan BUKAN
  bahwa password melintasi repo lain: **login di sini bukan satu langkah**. Ia bisa
  berbalas `401 MFA_REQUIRED` + `mfaChallengeToken`, bisa dialihkan ke OIDC provider
  tenant, dan bisa mensyaratkan Turnstile. Mem-proksinya berarti mengimplementasi
  ulang ketiganya di repo kedua — salinan kedua dari alur MFA adalah tempat paling
  mahal untuk membuat kesalahan pertama.

  Dokumen, belum kode. Yang harus dibangun berikutnya dicatat eksplisit di
  §Konsekuensi, termasuk yang paling mudah salah: allow-list `redirect_uri` yang
  ketat (open-redirect di sini berarti menyerahkan kode ke penyerang) dan
  penukaran kode yang atomik di bawah kunci baris.

- 712e1bc: ADR-0058 — disposition for the four declared permissions with no enforcer.

  `profile_identity.profile_management.restore` and `comments.moderation.delete`
  get a surface: both have all of their machinery except the endpoint. The first
  leaves `softDeleteParty` without a counterpart, so `restored_at`/`restored_by`
  can never be written and a soft-deleted profile is effectively permanent. The
  second has a legal `delete` transition from all four non-terminal statuses and
  an admin queue that can filter `deleted`, while the only actor able to produce
  that state is the comment's own author.

  `blog_content.seo.configure` and `blog_content.posts.export` are revoked: the
  first is a second authorisation axis over columns `settings.configure` already
  manages, the second has no export machinery anywhere in the repo.

  Decision only — no code or migration in this change.

- d17e240: ADR-0067 (`Proposed`) — Core Web Vitals collection, put as a decision rather
  than left as an open gap.

  This is the only one of the assessment's seven recommendations deliberately not
  landed. It does not fix a defect; it adds collection of data about real
  visitors, and that collides with a posture `visitor_analytics` has already
  stated — its purge does DELETE/UPDATE-to-null with no archive step, on the
  written grounds that raw visitor detail is deliberately not retained.

  The gap it describes is real: LCP/INP/CLS are measured nowhere, so the entire
  edge-cache investment is proven against origin load and never against user
  experience.

  Three options with their real trade-offs, recommending aggregate-only — buckets
  per tenant, normalised route and day holding counts plus p75, never raw rows —
  if it is taken at all. Not taking it is a legitimate answer, better recorded as
  a decision than left open.

  Awaiting the product owner's call.

- f0d2daf: Menutup celah C12 (standar §9): enam ADR ber-status `Accepted` tanpa satu baris kode (0016 organization_structure, 0017 document_infrastructure, 0018 data_exchange, 0019 integration_hub, 0020 kontrak ERP-extension yang berkas `_shared`-nya sudah dihapus, 0021 reference_data) kini ber-status jujur `Accepted (belum diimplementasikan)` dengan catatan bertanggal, indeks ADR dwibahasa ikut diperbarui, dan gerbang murni baru `tests/adr-implementation-status.test.ts` mengikat status itu ke keberadaan artefak yang dijanjikan DUA ARAH: artefak tidak ada → kualifikasi wajib; artefak mendarat → status wajib kembali `Accepted` polos; entri peta yang mati (ADR hilang/superseded) ikut gagal; dan kualifikasi tidak boleh dipakai di luar peta.
- 74e9c45: Naikkan `astro` 7.1.1 → 7.1.3.

  Ikut memperbarui `stack.astro.declared` di `awcms-family-compatibility.yaml`.
  Manifest itu menyematkan versi stack ke `package.json` sebagai sumber
  kebenaran, jadi setiap bump Astro memerahkan `family:conformance:check`
  (`[FAIL] stack: Astro (declared ^7.1.1 vs actual ^7.1.3)`) sampai deklarasinya
  diperbarui di perubahan yang sama — persis perilaku yang diinginkan ADR-0032:
  pinning-nya bukan free-floating, jadi bump toolchain tak bisa lewat tanpa
  terlihat.

- 6f5998e: Bump the Astro stack: `astro` 7.1.3 → 7.1.6 and `@astrojs/node` 11.0.2 →
  11.0.3, together with the two `stack` entries in
  `awcms-family-compatibility.yaml` that pin them.

  The manifest is what makes this one change rather than three: `family:conformance:check`
  reads `package.json` and fails on any drift from the declared range, so either
  bump alone turns CI red until its `declared` value moves with it. That gate is
  the reason the version a consumer reads has never silently diverged from the
  version this repo actually runs.

- 58b7fd2: `GET /api/v1/blog/posts` mengembalikan apa yang kontraknya janjikan, dan
  mendapat mode `?view=full` untuk build feed.

  Kontrak OpenAPI menyatakan endpoint ini mengembalikan `BlogPost` — lengkap
  dengan `contentJson`, `excerpt`, `metaDescription`, `canonicalUrl`, dan
  `translationGroupId`. Implementasinya mengembalikan ringkasan yang tidak memuat
  satu pun dari itu. Selisih itu tidak pernah gagal di mana pun: klien yang
  mempercayai dokumen membaca field-field tersebut sebagai `undefined`.

  Akibatnya nyata dan sudah terjadi. Sebuah situs `awcms-astro` membangun hijau
  dengan **badan setiap artikel kosong** — dan karena seksi tempat artikel berada
  juga tinggal di dalam `contentJson`, **seluruh seksinya kosong juga**. Tidak ada
  error di build mana pun, tidak ada 4xx, tidak ada baris log.

  Tiga perubahan:

  - **`?view=full`** mengembalikan baris penuh (`BlogPost`) dengan cursor keyset
    yang sama, batas halaman 50 karena barisnya membawa `contentJson`. Ia
    **mensyaratkan** `order=created_at`: traversal penuh hanya sehat di atas
    urutan yang tidak berubah, dan syaratnya dinyatakan alih-alih diam-diam
    disubstitusi — sikap yang sama seperti penolakan `cursor` atas urutan mutable.
    Tanpa mode ini, satu-satunya cara membangun situs adalah menyusuri daftar lalu
    mengambil ulang setiap post satu per satu (N+1 permintaan per build, ke
    endpoint admin, pada setiap publish).
  - **`translationGroupId` kini benar-benar dikembalikan** — oleh `view=full`
    maupun `GET /api/v1/blog/posts/{id}`. Kolomnya sudah ada dan bisa ditulis
    sejak awal, tetapi tidak satu pun endpoint baca mengembalikannya, sehingga
    klien bisa menyetel pasangan terjemahan dan tidak pernah bisa membacanya lagi.
  - **Bentuk ringkasannya dinyatakan sebagai skema tersendiri**
    (`BlogPostSummary`) alih-alih dibiarkan disimpulkan pembaca. Dokumen yang
    menjanjikan lebih dari yang dikirim kode adalah dokumen yang membuat klien
    salah dengan yakin.

  Validasi query dipindahkan ke `parseBlogPostListQuery` (domain, murni) supaya
  setiap penolakan punya tes tanpa basis data — sebelumnya ia inline di route dan
  tidak bisa dijangkau tes mana pun tanpa sesi dan Postgres.

- f309d00: Naikkan `actions/checkout` 7.0.0 → 7.0.1 di keempat workflow (`ci`, `codeql`,
  `changesets`, `release`). Patch release, tanpa perubahan perilaku pada repo ini.
- f9f8b29: Anggaran ukuran aset klien, digerbangi pada `build` (menutup celah C6).

  Diukur 2026-08-05, `dist/client` berbobot 139.048 byte dalam 45 berkas (35 JS = 77.449 B, 10 CSS = 61.599 B; berkas terbesar `css/public-content.css` 16.800 B) — momen termurah untuk memasang anggaran, karena setiap momen berikutnya berangkat dari baseline yang lebih besar. `scripts/client-asset-budget.ts` gagal bila total melewati 180.000 B (baseline + ~29%) atau satu berkas melewati 21.000 B (terbesar + 25%); dua aturan karena dua mode kegagalan berbeda — akresi pelan versus satu island yang mem-bundle dependensi 200 KB. `dist/client` yang tidak ada atau kosong juga GAGAL keras ("jalankan build dulu"), bukan lolos senyap. Target `build` kini merantai `bun run build:asset-budget:check` setelah `astro build`, sehingga gerbang ikut jalan di CI Quality dan release tanpa entri rantai `check` baru. Tidak ada kelas aset yang dikecualikan: seluruh isi `dist/client` hari ini adalah app shell JS+CSS (gambar konten hidup di R2 via `media_library`), jadi pengecualian dini hanya akan jadi titik buta.

- d3c424a: Naikkan `github/codeql-action` 4.37.1 → 4.37.3 untuk `init` DAN `analyze` dalam
  satu perubahan.

  Dependabot memecah bump ini jadi dua PR (#284 `init`, #286 `analyze`) karena
  keduanya dilacak sebagai action terpisah. Dipecah, masing-masing PR menjalankan
  `init` dan `analyze` pada versi yang BERBEDA, dan job `Analyze` gagal dengan
  version mismatch — persis itu yang terjadi: kedua PR merah di `Analyze
(actions)` dan `Analyze (javascript-typescript)` sementara seluruh check lain
  hijau. Keduanya menunjuk SHA yang sama (`e4fba868`), jadi digabung di sini dan
  kedua PR dependabot ditutup.

- 94c9ed5: Bump `github/codeql-action` from 4.37.3 to 4.37.4 (`init` and `analyze`
  together).

  Dependabot raises these as two PRs because they are two action paths, and
  neither can go green alone: `init` and `analyze` must run from the SAME commit,
  so each half-bump fails both Analyze jobs with a version mismatch. Landing them
  in one commit pinned to one SHA is the only shape that passes.

- 11babb3: ADR-0069: selisih COOP/CORP dengan `awcms-astro` dicatat sebagai divergence keluarga keempat di `awcms-family-compatibility.yaml` (ber-`reviewDate` 2027-02-04). Nol perubahan runtime — pencatatan postur.
- e90a316: Stop the admin dashboard reporting a permanent false alarm when a tenant has no sync nodes.

  `shapeSyncHealth`'s `isHealthy` is deliberately `false` for a tenant with zero registered sync nodes — "there is nothing actively syncing" is the right answer for the report. The dashboard rendered that same boolean directly as an amber "Needs attention" badge, so an online-first deployment that never enrols an offline node (ADR-0035 makes sync the resilience mode, not the main path) sat at `0/0` showing a warning with no action behind it. A badge that is always lit is one operators learn to ignore, including on the day it means something.

  The dashboard now distinguishes the two states that boolean conflates: **no nodes registered** renders a muted "Not configured", while **nodes enrolled but none active**, open conflicts, or failed objects still render "Needs attention". The `GET /api/v1/reports/sync-health` contract is unchanged — `isHealthy` still answers exactly as before.

  The decision is a pure `classifySyncHealthDisplay` in `reporting/domain/sync-health.ts` rather than inline `.astro` frontmatter, so it is reachable by unit tests at all (`tsc --noEmit` does not read `.astro`).

- 0227229: Naikkan `docker/login-action` 4.4.0 → 4.5.1 di workflow `release`. Hanya dipakai
  pada jalur publikasi image; tanpa perubahan perilaku pada build/test.
- ef7c51d: Bump `docker/login-action` from 4.5.1 to 4.6.0 in the release workflow (both
  call sites).

  Release-workflow only — it authenticates the GHCR push during
  sign/attest/publish and has no effect on any PR build.

- 720dc19: Sinkronkan dokumentasi, skill agen, dan knowledge graph dengan kode pasca-Gelombang 2.

  `docs/ARCHITECTURE.md` sebelumnya masih menyebut delapan layar admin dan tidak
  menyebut password reset, self-registration, maupun `/admin/security` sama sekali —
  tiga permukaan auth yang sudah mendarat di #273/#276/#274.

  `.claude/skills/awcms-auth-online-hardening/SKILL.md` memuat peringatan bahwa
  seluruh epic hardening auth "FIKTIF, tidak ada kodenya". Audit yang menghasilkan
  peringatan itu (2026-07-18) benar untuk saat itu, tetapi MFA (#184), OIDC/SSO
  (#185), Turnstile (#186), dan admin policy UI (#274) sudah dibangun sejak itu —
  agen yang mempercayai peringatannya akan membangun ulang semuanya. Peringatan
  diganti dengan §Peta ke artefak nyata awcms yang memetakan nama/path/nomor
  migrasi milik awcms-micro ke padanan awcms, dan menandai satu-satunya item yang
  memang sengaja tidak ada (login Google-spesifik).

  `.claude/skills/README.md` menyatakan `work-class` "benar-benar tidak ada",
  padahal `db:work-class:generate`/`:check` sudah ada dan ikut di rantai
  `bun run check`. Hitungan script juga dikoreksi 63 → 67.

  `graphify-out/` di-update inkremental (231 berkas berubah; 8159 node, 21470 edge).
  `.graphify_analysis.json` dikeluarkan dari tracking: langkah terakhir pipeline
  graphify menghapusnya, jadi salinan yang ter-commit hanya bisa basi.

- 8390e71: Buat `edge-cache:surfaces:check` bisa diuji, lalu uji dia.

  Dari 21 gate di rantai `bun run check`, ini satu-satunya yang membawa logika
  substansial (278 baris) **tanpa satu pun test** — dan alasannya struktural,
  bukan kelalaian: berkasnya berakhir dengan `await main()` di scope modul, jadi
  meng-`import`-nya akan MENJALANKAN gate-nya, dan `process.exit(1)`-nya akan
  membawa serta test runner. Gate lain yang tak diuji semuanya pembungkus tipis
  (35–66 baris) di atas kolektor yang diuji terpisah.

  Itu penting justru di sini. Registry ini adalah **allow-list** yang memutuskan
  apa yang boleh disimpan shared cache; kesalahan di dalamnya adalah pengungkapan
  lintas-tenant, bukan halaman lambat. Header berkasnya sendiri menyebut daftar
  probe `MUST_NEVER_MATCH` sebagai "the check that earns this file's existence" —
  dan sampai sekarang tak ada apa pun yang pernah menyaksikan daftar itu menolak
  sesuatu.

  Perubahannya: entrypoint dijaga `import.meta.main`, tiga aturannya diekspor
  sebagai fungsi murni (`validateSurfaces`, `findCacheableForbiddenPaths`,
  `findOwnersWithoutPurges`), dan `process.exit(1)` diganti `process.exitCode`
  sehingga gate tak lagi mematikan proses pemanggilnya. 20 test menanam
  pelanggaran nyata untuk tiap aturan.

  Dibuktikan dengan menghapus **traversal guard** di `matchPublicCacheSurface` —
  persis cacat yang digambarkan header gate ini. Hasilnya: `/blog/../admin` dan
  `/blog/%2e%2e/admin` dilaporkan cocok dengan surface `blog-post`, gate exit 1,
  test merah. URL admin yang cacheable, ditangkap oleh check yang sebelumnya tak
  pernah diamati bekerja.

- 4f20773: fix(blog-content): `/admin/blog`'s Restore control could never work

  `listBlogPostsForAdmin` hard-filtered `deleted_at IS NULL`, so a soft-deleted
  post was never on screen, and the console offered no way to see the bin. The
  Restore control was therefore hung off `status === "archived"` — a different
  axis. An archived post is not soft-deleted, and `POST .../restore` requires
  `canRestorePost` (`deleted_at IS NOT NULL`), so the button was rendered exactly
  where it must answer 404, and never where it would succeed.

  The delete confirmation already promised the opposite ("It is soft-deleted —
  recoverable until it is purged"), a promise the UI could not keep.

  `listBlogPostsForAdmin` gains a `deletedOnly` filter and the screen gains a
  `?view=deleted` bin. Restore now belongs to bin rows; the lifecycle controls
  belong to live rows, because `transitionBlogPostStatus` also matches
  `deleted_at IS NULL`; Purge appears in both, because `canPurgePost` accepts
  archived or soft-deleted.

  No schema change.

- 0e8021f: Segarkan artefak graph graphify yang ter-track, dan berhenti melacak
  `.graphify_labels.json`.

  Regenerasi ini menjangkau 1.435 berkas (dari 1.412) dan menghasilkan graf yang
  lebih padat: 23.752 edge (dari 21.477) dengan ekstraksi 99% EXTRACTED (dari
  98%). Ia dihasilkan sepenuhnya dari cache — 0 token input — jadi tidak ada biaya
  ekstraksi baru yang ditambahkan.

  `.graphify_labels.json` adalah intermediate build: langkah cleanup skill
  menghapusnya di akhir setiap run, sehingga salinan yang ter-track hanya bisa
  berupa sisa run yang terputus — persis alasan `.graphify_analysis.json` sudah
  di-ignore lebih dulu. Isinya (label komunitas) sudah dirender GRAPH_REPORT.md
  §Community Hubs dan diturunkan dari `graph.json` yang memang ter-track.

- a2cc43a: Segarkan graf graphify di atas dokumen dan skill yang sudah disinkronkan.

  Jalur inkremental (`--update`): 105 berkas berubah (50 kode + 55 dokumen), 13
  berkas terhapus. Hasilnya 8.247 node · 24.098 edge · 495 komunitas, ekstraksi 98%
  EXTRACTED, biaya 791.182 token input.

  Guard penyusutan graphify (#479) menyala pada −25 node dan **benar** menyala:
  penurunan itu diverifikasi sah sebelum `force` dipakai — 13 berkas
  `src/modules/news-portal/**` beserta dua test-nya nol di disk **dan** nol di
  `git ls-tree HEAD`, sisa penghapusan modul ADR-0044 yang belum pernah masuk graf.
  Diagnostik integritas pasca-build bersih: nol dangling, nol missing-endpoint, nol
  self-loop, nol edge kolaps.

  Berkas ber-titik di `graphify-out/` (labels, penanda path, sig) tidak ikut
  ter-commit — aturan `graphify-out/.*` yang mendarat di PR sebelumnya bekerja
  persis seperti maksudnya.

- 3493656: Stop the DB-gated integration suite racing bun's 5s per-hook default, and stop
  it misreporting the result.

  `setupIntegrationDatabase()` creates an ephemeral database and applies every
  file in `sql/` as a subprocess, inside `beforeAll` — thirteen files each do
  that, and the cost grows with every migration added. The CI step now passes
  `--timeout 60000` (~30x the ~1-2s a warm setup takes, still far under the job
  timeout) in both `ci.yml` and `release.yml`.

  When it does get killed, the harness now says so. Exit 143 is 128 + SIGTERM: the
  migration did not fail, it was terminated. The old message read "db:migrate
  failed against the ephemeral integration database (exit 143)", which points a
  reader at `sql/` — the one place the problem is not. Observed on PR #259 (run
  30188228406), green on a re-run with no code change.

- 12594f5: Define the `src/lib` boundary and extend the module-boundary gate to `src/pages`
  (ADR-0043).

  `src/lib` had become a second, ungated module system: four namespaces (`seo`,
  `theming`, `comments`, `search`) carried the name of an existing module and held
  that module's code, and `seo_distribution` referred UP into `src/lib/seo` along
  a path the DAG validator cannot see. `src/lib` is now technical infrastructure
  with no domain name; module presentation/delivery code lives in
  `src/modules/<m>/presentation/`. Eight files moved with `git mv`; no behaviour,
  API, migration, event, permission or registry change.

  `modules:dag:check` fails on a `src/lib/<x>/` namespace that collides with a
  module key — exactly or via a registered domain alias (without aliases, two of
  the four real cases would have passed). `src/lib/logging/` is a recorded
  exception, and the test proves it is DETECTED and merely excused.

  `tests/module-boundary.test.ts` now also covers `src/pages` (38k lines,
  previously scanned by nothing), attributing each route to its owner via
  `api.routes`. That surfaced four hidden edges: three are now declared
  (`theming` -> `module_management`, `visitor_analytics` -> `data_lifecycle` and
  -> `module_management`) and one was removed instead — `extractReferrerDomain`
  moved to `_shared`, because a pure string-to-hostname function should not make
  SEO telemetry depend on the analytics module being enabled.

- 0403e54: Perbaiki dua diagram mermaid yang gagal di-render GitHub, dan gerbangi kelas
  cacatnya di `check:docs`.

  Saat parse gagal, GitHub tidak merender sebagian — ia mengganti **seluruh**
  diagram dengan kotak "Unable to render rich display". Dua diagram di repo ini
  gagal parse sementara `bun run check` tetap hijau, karena `checkMermaid` hanya
  memvalidasi pagar blok dan tipe diagram, tak pernah isinya.

  Grammar flowchart mermaid memperlakukan `(` sebagai token pembuka bentuk node,
  jadi kurung di posisi TEKS mematikan diagram:

  - `README.md`/`README.id.md` — label SISI `-->|online (primary)|`, yang dilihat
    langsung di halaman depan GitHub;
  - `docs/awcms/21_module_admission_governance.md` — empat label NODE rhombus
    (`Q2{... (bukan fitur produk berdiri sendiri)?}` dst.). Diagram ini rusak
    diam-diam dan tak pernah dilaporkan.

  Perbaikannya sama untuk keduanya: kutip labelnya. Bentuk silinder `[( )]` di
  README TIDAK diubah — di sana kurung adalah sintaks bentuk, bukan teks.

  Gerbangnya diperluas: untuk blok `flowchart`/`graph`, setiap `(`/`)` yang
  tersisa setelah teks ber-kutip dan pembatas bentuk (`[( )]`, `([ ])`, `(( ))`,
  `[[ ]]`, `{{ }}`) dibuang = temuan, dengan pesan yang menyebut perbaikannya.
  Aturan ini sengaja TIDAK berlaku untuk `sequenceDiagram` dkk., tempat kurung
  dalam teks memang sah.

  Setiap klaim di atas diverifikasi terhadap parser mermaid 11 NYATA — engine yang
  sama dengan yang dipakai GitHub — bukan disimpulkan dari dokumentasi: tanpa
  kutip GAGAL, dengan kutip LOLOS, bentuk ber-kurung LOLOS apa adanya, dan kurung
  di `sequenceDiagram` LOLOS. Sesudah perbaikan, 85 blok mermaid di seluruh
  markdown ter-track di-parse dengan nol rusak, dan gerbangnya menandai tepat lima
  baris cacat itu — nol temuan palsu di 85 blok tersebut.

  Cakupan gerbang dinyatakan terbuka di kode: ini pemeriksa sintaksis satu kelas
  cacat, bukan parser mermaid.

- 66c1122: Perbaiki katalog tag OpenAPI dan kepemilikan fragment — 55 operasi yang selama
  ini hilang dari referensi API kini terdokumentasi, dan dua gerbang baru mencegah
  kelas cacat ini terulang.

  `scripts/api-docs-generate.ts` mengelompokkan operasi menurut tag yang
  **dideklarasikan** di katalog root. Konsekuensinya tidak pernah terlihat: sebuah
  operasi yang membawa tag tak-terdeklarasi tidak muncul di seksi mana pun — ia
  hilang tanpa memerahkan apa pun. Itulah yang terjadi pada empat modul sekaligus.
  `docs/awcms/api-reference.md` tidak memuat **satu pun** operasi REST milik
  `blog_content` (30 path), `visitor_analytics` (12), `tenant_domain` (7), dan
  `data_lifecycle` (6), meski bundel memuat semuanya dan `bun run check` hijau.

  Sisi sebaliknya sama sunyinya: katalog masih mengumumkan tag `News Portal *`
  sebagai milik modul `news_portal` yang sudah dipensiunkan ADR-0044, dan
  `openapi/modules/news-portal.openapi.yaml` masih ada sebagai fragment untuk
  modul yang tidak lagi terdaftar. Yang membuatnya bertahan adalah tidak adanya
  aturan yang menghubungkan fragment ke registry: `api.openApiPath` milik
  `blog_content` dan `media_library` malah menunjuk **bundel** hasil generate,
  sehingga fragment asli mereka tidak diklaim siapa pun.

  Perubahan ini:

  - menambah empat tag yang kurang (`Blog Content`, `Visitor Analytics`,
    `Tenant Domains`, `Data Lifecycle`) dan meng-atribusikan ulang tag
    `News Media`/`News Portal *` ke modul pemiliknya hari ini (`media_library`,
    `blog_content`). **Nama tag dan path publik sengaja tidak diubah** — mengikuti
    alasan ADR-0044 §3/§6 dan preseden ADR-0036: merge memindahkan kepemilikan,
    bukan permukaan publik;
  - melebur `openapi/modules/news-portal.openapi.yaml` ke fragment
    `blog-content`, dan me-repoint `api.openApiPath` `blog_content` +
    `media_library` ke fragment mereka sendiri (ADR-0026: modul menunjuk
    fragmentnya, tak pernah bundel);
  - menambah dua gerbang murni di `bun run api:spec:check`:
    `collectTagCatalogProblems` (setiap operasi ber-tag, setiap tag operasi
    terdeklarasi, **dan** setiap tag terdeklarasi dipakai — separuh kedua itulah
    yang menangkap tag modul pensiunan) dan `collectFragmentOwnershipProblems`
    (satu fragment = satu modul terdaftar, dua arah, dengan
    `foundation.openapi.yaml` sebagai satu-satunya pengecualian ter-review);
  - meluruskan deskripsi `media_library` yang masih menyebut `news_portal` sebagai
    konsumen wajib yang hidup.

  Bundel yang dihasilkan **tidak berubah selain katalog tag** (11 baris tambah, 3
  kurang, nol path dan nol schema) — bukti bahwa pemindahan fragment tidak
  menyentuh kontrak yang diterbitkan. Kedua gerbang dibuktikan MERAH dengan
  mengembalikan cacat aslinya (menghapus tag `Blog Content`: 49 temuan;
  mengembalikan fragment `news-portal`: 1 temuan), lalu hijau lagi setelah
  dipulihkan.

- 75b46ed: Fix `access:permissions:enforcement:check` reporting enforced permissions as unenforced.

  The gate resolved `const NAME = "value"` bindings across the whole repo as one
  flat namespace. `MODULE_KEY` is bound in five files to four different values, so
  the "a name bound to two values is unresolvable" rule silenced it everywhere —
  including in the file that binds it one line above its own guard. The guards in
  `src/pages/api/v1/analytics/settings.ts` were therefore invisible, and
  `visitor_analytics.settings.read`/`.update` were recorded in the exception list
  as permissions nothing enforces, with a stated reason the route disproves.

  Constants now resolve file-first (`resolveConstantsForSource`); the cross-file
  table is consulted only for names a file does not bind itself, which is exactly
  the set that can only have arrived by import. A name a file binds twice to
  different values stays unresolvable. Both exception entries are removed; the
  score moves from 199/205 with 6 exceptions to 201/205 with 4.

- def014c: Naikkan `@playwright/test` 1.61.1 → 1.62.0 (devDependency). Dipakai suite E2E
  smoke yang env-gated; suite tetap hijau di CI.
- cc16c0c: Bump `@playwright/test` from 1.62.0 to 1.62.1 (dev dependency, E2E runner).

  Unlike the Astro stack, Playwright is not pinned in
  `awcms-family-compatibility.yaml`, so this bump touches nothing but the
  lockfile — a consumer of this repo binds against its contracts, not its test
  runner.

- c3af89f: Close GHSA-fxqj-rqcc-2cmp by pinning `postcss` to `^8.5.23` via `overrides`.

  `bun audit` reported one moderate advisory: PostCSS's incomplete fix of
  GHSA-6g55-p6wh-862q lets an attacker-controlled `sourceMappingURL` read
  arbitrary `.map` files when `from` is unset. It reaches this repo transitively
  through `astro › vite › postcss`, which resolved to 8.5.19.

  A dependency override rather than waiting for the upstream bump: the path is
  three levels deep, so nothing this repo declares can move it, and `overrides`
  is the same mechanism `awcms-astro` used to close its `fast-uri` advisory.

  Build-path only — PostCSS does not run at request time — so this is hygiene
  rather than an exposure. `bun audit` is now clean, and `bun install
--frozen-lockfile` still resolves unchanged.

- 4eea13e: Naikkan `prettier` 3.9.5 → 3.9.6 (devDependency). Formatter menggerbangi
  `bun run lint`; patch release ini tidak mengubah format berkas mana pun di repo
  (`lint` tetap hijau tanpa reformat).
- 3dad5ce: Record the `awcms-astro` readiness analysis and correct two stale counts in
  `docs/PROJECT_STATE.md`.

  The analysis inverts a reasonable assumption: every content and session
  contract `awcms-astro` actually calls is complete (five surfaces, all landed),
  so what holds its ADR-0021 containment is not a missing contract. The one real
  gap found is closed in the same wave, and the two that remain — a host-based
  public content route and the business-scope resolver — each need their own ADR.

  Also sharpens the host-resolved route entry from "follow-up" to what the code
  shows: `seo_distribution` emits every canonical and `<loc>` under `/blog/{slug}`
  while the only content route is `/blog/{tenantCode}/{slug}`, so for a
  host-resolved tenant every sitemap and feed URL points at a 404 with no gate
  red.

- 707baa0: Tabel inventori §2 `docs/PROJECT_STATE.md` kini di-generate dan digerbangi.

  Tabel itu basi EMPAT kali dengan CI hijau — tiga di antaranya pada baris yang sama — dan blockquote-nya sendiri sudah menyimpulkan: pola ini berhenti hanya bila tabelnya di-generate. `bun run project-state:inventory:generate` menulis blok di antara marker `<!-- project-state-inventory:mulai/selesai -->`, dan `bun run project-state:inventory:check` di rantai `check` memerahkan CI bila ia basi (dibandingkan per-konten, bukan per-byte, supaya padding prettier bukan drift).

  Baris LAMBAT di-generate: versi, jumlah modul, jumlah/rentang migrasi, ADR tertinggi + statusnya, layar admin + modul tanpa `navigation:`, jumlah/baris `.astro`, jumlah gerbang rantai `check`, `MODULE_CONTRACT_VERSION`. Baris CEPAT (changeset per tipe bump, commit sejak rilis) DIHAPUS angkanya — angka yang bergerak tiap commit di dokumen ter-versioning akan selalu basi, dan menggerbanginya memaksa tiap PR meregenerasi dokumen; sel nilainya kini menunjuk perintah di kolom kanan, yang dipertahankan (dan rentang `git rev-list`-nya ikut ter-generate dari versi `package.json`).

  Gerbangnya mutation-proven di `tests/project-state-inventory.test.ts`: satu digit dimutasi di antara marker → check gagal dan menamai barisnya; marker hilang → gagal keras; dokumen nyata dibuktikan sinkron oleh test itu sendiri.

- 600b8ba: Extend the query budgets to the heaviest admin screens and the sitemap builder (gap C5 of the second-pass assessment — the first budget file covered only the public blog read paths).

  Every `src/pages/admin/*.astro` screen was ranked by the number of read functions it calls inside `withTenantOrThrow`. Two stand above the rest and are now budgeted at their measured actuals: `/admin` — the dashboard's four report aggregations, 15 queries across nine tables — and `/admin/blog` — the editorial list at 2 queries, 3 with the revision panel, plus a paging-depth constancy check. Every other screen (including `/admin/media`) calls one read function issuing one or two queries, so a budget there would restate a single function's shape rather than guard an aggregation.

  The sitemap builder is the other classic N+1 shape: `seo_distribution`'s discovery aggregator crosses module boundaries through injected `seo_facts` providers and resolves media in batches, on a public unauthenticated surface rebuilt on every edge-cache MISS. The index build is budgeted at 4 queries and a child page at 6, both constant across a 40-post fixture.

  Budgets are ceilings set at the exact measured count — no headroom, because headroom is exactly the space a small regression hides in. Fixtures seed more rows than any budget allows (40 posts, 40 rows in each dashboard-aggregated table, 30 revisions), with time anchors taken from the database rather than a JS clock, so per-item work cannot pass unnoticed. Test infrastructure only: no ADR, no new gate in `bun run check`; the suite is DB-gated by the same `integrationEnabled` mechanism as every other integration file and runs in CI's Integration tests job.

- 3e877a7: Query budgets on the hot public read paths.

  An N+1 is invisible to every other kind of test: the rows are right, the
  assertions pass, the response is byte-identical, and only the number of round
  trips differs. It surfaces in production as latency that grows with content,
  months after the code landed.

  `tests/integration/query-budget.ts` extracts the Proxy-apply-trap the SoD suite
  already proved out into a reusable `countQueries`, and the accompanying
  integration test binds the listing, paging and feed paths to a ceiling of three
  queries against a 40-post fixture.

  The fixture size is the point: a bound asserted against one row proves nothing,
  since an N+1 and a constant-query implementation both issue about one query.
  Mutation-proven by injecting a real N+1 into `listPublicBlogPosts` — two budgets
  turn red. A fourth test guards the instrument itself, because a Proxy that
  silently stopped counting would make every budget pass vacuously.

  These are the paths the edge cache fronts, which is why the count matters: a
  cache MISS pays the full cost, and auto-activation only engages once the origin
  is already under pressure.

  No ADR: this adds no standing rule and no gate to `bun run check`.

- c2808b6: Repo-wide assessment against four axes, and the skill corrections it produced.

  [`docs/awcms/repo-assessment-2026-08-04.md`](docs/awcms/repo-assessment-2026-08-04.md)
  measures the repo against AWCMS's own development standards, its relationship
  with `ahliweb/awcms-astro`, international performance standards (ISO/IEC 25010,
  RFC 9111/5861, Core Web Vitals) and international security standards (OWASP Top
  10 2021, OWASP API Security Top 10 2023, OWASP ASVS 4.0, ISO/IEC 27001:2022
  Annex A). Every finding is verified against code, with file and line.

  Three findings change the backlog:

  - **P0 — one route bypasses the authorization chokepoint.**
    `POST /api/v1/blog/posts/{id}/submit-review` never calls
    `authorizeInTransaction`, so ABAC policy evaluation, the platform-scope gate,
    business-scope facts and SoD are all skipped for a permission that
    `PATCH /{id}` evaluates in full. An explicit ABAC `deny` on
    `blog_content.posts.update` is honoured on one route and silently ignored on
    the other. `access:permissions:enforcement:check` cannot see it: it asks
    whether a permission has an enforcer, not whether every enforcement site uses
    the chokepoint.
  - **P1 — nothing tests the contract `awcms-astro` consumes.** The frozen
    OpenAPI snapshot is the pre-#182-migration baseline; all five surfaces that
    repo actually calls landed after it. Changing any response shape is green here
    and breaks the build there.
  - **P1 — the rate limiter is an in-process `Map`**, so with N replicas the
    effective limit is N × configured. Redis is already in the repo.

  Also: zero of the 28 `check` gates measure performance, and `bun audit` reports
  one moderate transitive advisory (postcss via astro › vite).

  `skills:check` gains **rule 4**: every `bun run <target>` a skill names must
  exist in `package.json` or be declared deferred in `scripts/README.md` §Ditunda.
  Deliberately narrow — that section explicitly permits skills to name deferred
  reference targets, so the rule only catches targets that are neither. It found
  two, one of which told readers to run a refresh command that never existed while
  the real `gh` invocations sat on the same page.

  Skills corrected: `awcms-abac-guard` now leads with the chokepoint rule that the
  P0 finding shows was never written down; `awcms-performance` warns that its
  commands do not exist yet; `awcms-security-hardening` carries the three open
  findings; `awcms-github-snapshot` and `awcms-data-lifecycle` lose their ghost
  commands.

  No migrations, no permissions, no runtime change.

- d4677f2: Make `docs/awcms/repo-inventory.md` an actually-generated document (`bun run repo:inventory:generate|:check`).

  It carried a "GENERATED FILE — jangan diedit manual" banner while no generator existed, and it aged in the direction that does the most damage: the body said "belum ada tabel" and "belum ada test file" against 126 tables and 295 test files, gave the migration count as **45** in one paragraph and **89** in another, and listed **20** modules where the registry holds 21. A negative claim is the dangerous kind — "X does not exist yet" gets more wrong with time and never fails on its own.

  The derivable half is now derived and the prose half is not, following `scripts-inventory.ts` exactly: everything between the markers comes from the module registry, `sql/*.sql`, `tests/`, `src/pages/` and `docs/adr/`, and `repo:inventory:check` joins the `check` chain. The check parses the block back into rows rather than comparing bytes, because prettier owns markdown padding and the two would otherwise fight forever.

  RLS state is parsed from the migrations, not read from a database, so the inventory is available where it is most useful (CI, a fresh clone, a review). That parse is cumulative and order-sensitive on purpose: `sql/020` toggles `NO FORCE` on `awcms_offices` for a data repair and turns it back on 40 lines later, so a parser reading the first or last statement alone would report the opposite of the truth. `security-readiness.ts` remains the authority for a live deployment.

  One cross-artefact test ships with it, and it is the part with teeth: the set of tables the generator derives as RLS-free must equal the keys of `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` in `security-readiness.ts` — one side derived from the migrations, the other hand-maintained with a reason per entry. A disagreement means either a new global table shipped without declaring which privileges `awcms_app` must not hold on it, or a tenant-scoped table shipped without RLS. Today both sides are the same eleven.

- 2dc50c9: Menonaktifkan tenant user kini benar-benar mengakhiri aksesnya — seketika,
  bukan "paling lama satu masa berlaku sesi".

  `setTenantUserStatus` menulis `status = 'inactive'` dan komentar dokumennya
  sendiri menyatakan itu "revokes all of a user's access". Rantai guard tidak
  pernah membaca kolom itu: `resolveTenantContext` mencari sesi dan BARIS tenant
  user, bukan statusnya. Jadi pengguna yang baru dinonaktifkan tetap bekerja
  normal sampai sesinya kebetulan kedaluwarsa — dan satu-satunya cara
  menyadarinya adalah mencoba.

  Deaktivasi kini mencabut setiap sesi hidup identitas itu, **di dalam transaksi
  yang sama** dengan penulisan status: deaktivasi yang ter-commit sementara
  pencabutannya gagal akan meninggalkan sesi hidup persis untuk akun yang baru
  saja diputuskan untuk ditutup.

  Kredensial mesin tidak butuh sapuan terpisah — jalur prinsipal mesin (ADR-0049)
  mensyaratkan tenant user AKTIF, jadi keduanya berhenti pada instan yang sama.
  Test membuktikan keduanya bekerja terpisah: menghapus pencabutan sesi
  memerahkan 3 test, sementara test kredensial mesin tetap hijau.

  Diverifikasi terhadap PostgreSQL nyata (6 test), termasuk dua yang menjaga arah
  sebaliknya: sesi pengguna lain tidak tersentuh, dan reaktivasi **tidak**
  menghidupkan kembali sesi yang sudah dicabut — urutan deactivate/reactivate
  justru yang dipakai operator saat mencurigai sebuah sesi.

- 2f9c253: Perluas gerbang rujukan `bun run` ke README modul dan **komentar kode**, lalu
  perbaiki tujuh rujukan hantu yang selama ini hidup di balik `check` hijau.

  `checkKnownScripts` hanya membaca lima berkas markdown akar (`README*.md`,
  `AGENTS.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`). Di luar lima itu, sebuah
  perintah yang tidak pernah ada tetap bisa berdiri sebagai instruksi. Tujuh
  ditemukan:

  - Enam komentar di `src/lib/jobs/` + `src/modules/module-management/` menyuruh
    pembacanya menjalankan target `modules:sync`. Target itu **tidak pernah ada di
    repo ini** — mekanismenya `POST /api/v1/modules/sync`, dan `enableTenantModule`
    bahkan sudah memanggil `syncModuleDescriptors` sendiri supaya operator tak
    perlu mengingat apa pun.
  - `src/modules/blog-content/README.md` mendaftarkan `bun run production:preflight`
    di antara perintah verifikasi nyata. Orkestrator itu belum diport; tiga
    tahapnya yang sudah nyata (`config:validate`, `security:readiness`,
    `db:pool:health`) menggantikannya.

  Komentar kode adalah dokumentasi current-state yang paling dipercaya sekaligus
  yang paling tidak pernah diaudit — ia dibaca persis saat seseorang sedang
  memutuskan tindakan. Karena itu cakupan gerbang kini: lima berkas akar +
  `docs/PROJECT_STATE.md` + `scripts/README.md` + README modul `src/**` + seluruh
  sumber `src/`/`scripts/`. `docs/awcms/` dan `.claude/skills/` tetap di luar —
  isinya target adaptasi awcms-mini yang memang boleh menyebut tooling belum-ada —
  begitu pula `tests/`, yang fixture-nya sengaja memakai nama fiktif untuk menguji
  gerbang ini.

  Kelas cacatnya dibuktikan dua arah sebelum ditutup: mengembalikan komentar
  `modules:sync` yang asli DAN menambahkan satu rujukan hantu ke
  `docs/PROJECT_STATE.md` masing-masing memerahkan gerbang. Gerbangnya juga
  langsung menangkap komentar penjelasnya sendiri pada run pertama — kali kelima
  bentuk itu muncul di repo ini, dan alasan komentar itu kini sengaja tidak menulis
  nama target dalam bentuk `bun run …`.

  Dokumen current-state ikut disegarkan agar tidak berbohong ke arah sebaliknya:
  `docs/ARCHITECTURE.md` masih menulis "20 modul terdaftar" (21) dan **dua kali**
  menyebut `idn-admin-regions` sebagai "belum di-port" padahal modul itu sudah
  mendarat (#312) — klaim negatif yang makin salah seiring waktu tanpa pernah gagal
  sendiri. `docs/PROJECT_STATE.md` disetel ulang ke 21 modul / ADR 0000–0048, dan
  kontrak alur kerjanya tidak lagi mewajibkan mini-first yang sudah **ditangguhkan**
  ADR-0047.

- 8d4e0f2: Turunkan inventaris `scripts/README.md` dari `package.json`, dan tolak klaim
  "belum ada" untuk tooling yang sudah ada.

  README itu punya dua tabel dan keduanya salah. Yang pertama mendaftar **12 dari
  52** skrip sebagai aktif. Yang kedua menyebut lima belas tooling sebagai "belum
  diport" padahal semuanya sudah mendarat — dan sebagian sudah berada di rantai
  `bun run check`: `api:docs:check`, `modules:compose:check`,
  `db:work-class:check`, `modules:composition:inventory:*`, serta seluruh worker
  per-modul (`email:*`, `analytics:*`, `reporting:*`, `workflow:*`,
  `form-drafts:*`, `identity-access:*`).

  Keduanya butuh aturan berbeda, karena mode kegagalannya berbeda:

  - **Kelalaian** ditutup dengan menurunkan tabelnya. Blok bertanda di README kini
    dihasilkan `bun run scripts:inventory:generate` dan diperiksa
    `scripts:inventory:check` — pola generate/check yang sama dengan artefak
    `.generated` lain, karena artefak generated TANPA pasangan itu adalah klaim
    palsu yang justru lebih dipercaya daripada prosa.
  - **Klaim ABSENSI palsu** ditutup dengan aturan tersendiri: sebuah target yang
    tercatat di §Ditunda tapi ADA di `package.json` memerahkan gate. Ini arah yang
    berbahaya — klaim negatif makin salah seiring waktu dan tak pernah gagal
    sendiri, jadi pembacanya menyimpulkan `db:work-class:check` masih perlu
    dibangun lalu membangun duplikatnya.

  Pemindaian klaim absensi hanya membaca BARIS TABEL, bukan prosa: prosa di
  bagian itu menjelaskan aturannya sambil menyebut nama target nyata, dan
  memindainya utuh membuat gate melaporkan dirinya sendiri pada run pertama —
  kali keempat bentuk itu muncul di repo ini.

- ccc1fd9: Skill catalogue: correct two claims that stopped being true

  `.claude/skills/README.md` told readers `repo:inventory:*` is "genuinely absent"
  and that `package.json` has 75 scripts. Both landed since: #374 shipped
  `repo:inventory:generate`/`:check` with the generator for `awcms/repo-inventory.md`,
  and the script count is 82. A catalogue that names a real script as missing sends
  the next reader to build what already exists — the same failure shape ADR-0062
  gates for `SKILL.md`, in the one file that gate does not read.

  `awcms-jualanku-porting` carried two more. Its description said the registry is
  "still 20 modules" (it is 21), and its first binding decision described the
  ADR-0030 scope-hierarchy port as base returning `resolved: false` fail-closed —
  true until ADR-0060 gave it a provider, and misleading after. What is still open
  is narrower and now stated: the merchant scope SHAPE needs its own admission ADR.

  Verified against code, not memory: `Object.keys(scripts).length`, the module
  registry, and the ADR files themselves.

- d02b17f: Confine AWCMS development to `ahliweb/awcms` and `ahliweb/awcms-astro` (ADR-0055), and re-anchor the compatibility manifest.

  ADR-0047 froze `awcms-mini`/`awcms-micro` as references that could still be ported OUT. That half position had a running cost: the manifest still declared `standard: awcms-mini`, and its nine `intentionalDivergences` each carried a `reviewDate` that turns CI red on expiry — scheduling this repo to keep re-justifying its differences from a repo nobody develops. The backlog framed work as moving existing code rather than deciding what to build, and the four most recent foundation features (ADR-0046, -0049, -0053, -0054) were all built here anyway. The written rule had fallen behind the actual one.

  `awcms-mini` and `awcms-micro` are now archives: readable as history, never a scheduled source of ports. Wanted capabilities are built here with their own admission ADR, judged on today's need.

  The manifest stays gated and self-anchored — its 23 contract-version checks against real source constants are untouched, because the mechanism was never the problem. `intentionalDivergences` is emptied and the nine entries are preserved verbatim in `docs/awcms/family-compatibility.md`, where their ADR links are still verified to exist by `check:docs`.

  ADR-0047 §4 (record every foundation feature as a divergence as it lands) is retired: the ADR is the record, and the duplicate was only ever another thing to keep in step. Every other §3 guardrail stands — ADR for standard changes, extra security review for `auth`/`access`/`sync`, full `bun run check`, OpenAPI/AsyncAPI in sync, `FORCE` RLS, ABAC default-deny, applied migrations immutable.

  Docs-only: no runtime code changes.

- a78b774: Build the work-class registry generator + freshness gate, and retire the ghost
  artifact it was supposed to produce.

  `docs/awcms/work-class-registry.generated.json` carried a `.generated` suffix
  with no generator and no check behind it. It listed ~284 awcms-mini routes,
  mostly ghosts, while its own `_disclaimer` claimed to describe "96 real routes"
  in a repo that has 221 — the data was stale and so was the warning meant to stop
  readers trusting it. Both `docs/awcms/README.md` and the capacity runbook cited
  it.

  `bun run db:work-class:generate` / `db:work-class:check` now produce and verify
  it from this repo's own routes and jobs, wired into `bun run check` and
  `ci.yml`. Routes are derived from source (`defineTenantRoute`'s required
  `workClass`, an explicit literal on `withTenant`, or the documented default);
  jobs come from `JOB_WORK_CLASS_REGISTRY`, cross-checked against the scripts that
  actually open a worker connection.

  That cross-check refused to generate on its first run, correctly: four worker
  scripts from the awcms-micro wave (`comments-retention`, `edge-cache-purge`,
  `site-search-reconcile`, `tenant-domain-dns-sync`) had no entry and were outside
  the capacity model, and four entries described scripts that do not exist here.
  Both directions are fixed.

  `tests/generated-artifacts-have-tooling.test.ts` makes this a class of defect
  rather than one incident: any `.generated` file without a generate/check pair
  wired into the check chain now fails CI.

## 6.4.0

### Minor Changes

- 85517b8: Tutup empat temuan analisis graph: wire resolusi asset theming, lengkapi
  deklarasi permission `email`, jujurkan graf dependensi lintas-modul, dan
  tambahkan gate batas modul yang selama ini SUDAH DIASUMSIKAN ADA.

  **Logo tema akhirnya tampil.** `src/lib/theming/theme-media.ts` mengembalikan
  map kosong tanpa syarat. Itu jujur saat ditulis — ADR-0034 Fase 3 mem-port
  `theming` lebih dulu dan `media_library` belum ada — tapi header-nya tetap
  berkata begitu setelah ADR-0036 mendaratkan modulnya, sehingga no-op itu terbaca
  sebagai desain, bukan wiring yang belum selesai. Akibatnya tak pernah tercatat:
  tenant mengunggah logo, id-nya tersimpan dan valid, dan `PublicThemeLayout`
  selamanya merender fallback nama-tema. Kini resolusi lewat `MediaLibraryPort`
  — capability yang sama yang sudah dikonsumsi `blog_content` dan `news_portal`.
  Slot yang tidak resolve tetap DIHILANGKAN, bukan melempar: halaman tema publik
  tidak boleh 500 karena satu id asset basi. `theming` sekarang mendeklarasikan
  `capabilities.consumes` untuk `media_library`.

  **`email` mendeklarasikan 12 permission-nya**, verbatim dari seed `sql/014`.
  Ia satu-satunya dari 21 modul yang belum, sehingga seluruh barisnya permanen
  tampil `orphaned` di `GET /api/v1/modules/email/permissions` — false positive
  menetap yang melatih pembaca mengabaikan laporan drift. Kini 21/21.

  **Enam edge lintas-modul tak-terdeklarasi dijujurkan.** `seo_distribution`,
  `site_search`, dan `comments` meng-import modul yang tidak ada di descriptor-nya;
  semuanya kini dideklarasikan, tanpa satu pun cycle.
  `domain_event_runtime -> reporting` TIDAK bisa dideklarasikan — `reporting`
  sudah mendeklarasikan arah sebaliknya, jadi mendeklarasikannya = cycle — dan
  menjadi satu-satunya pengecualian tercatat, dengan alasan yang bisa dibantah
  reviewer.

  **`tests/module-boundary.test.ts`.** `capability-contract-versions.ts` selama
  ini membenarkan capability tanpa versi dengan kalimat "a source-boundary test
  (`tests/unit/module-boundary.test.ts`) is enough to keep provider and consumer
  in sync". **Berkas itu tidak pernah ada di repo ini** — kalimatnya ikut ter-port
  dari awcms-mini, test-nya tidak. Jaring pengaman yang dinyatakan untuk seluruh
  model capability itu imajiner. Sekarang nyata: tiap import lintas-modul wajib
  dideklarasikan sebagai dependency, sebagai capability consumption, atau
  dikecualikan eksplisit dengan alasan.

### Patch Changes

- 1d49f37: Sinkronkan docs/skill dengan #251/#252, dan catat satu split-brain `navigation`
  yang ditemukan lewat graph.

  Lima skill mengklaim hal yang sudah tidak benar setelah #251:
  `awcms-theming` masih menyebut resolusi URL asset "masih no-op" (sudah ter-wire
  lewat `MediaLibraryPort`); `awcms-module-management` masih menyebut "20 dari 21
  modul" mendeklarasikan `permissions` (kini 21/21, sehingga `orphaned` bukan lagi
  kondisi normal dan setiap kemunculannya adalah sinyal nyata); dan
  `awcms-comments`/`awcms-site-search`/`awcms-seo-distribution` masih mengiklankan
  deps "Core-only" padahal ketiganya kini mendeklarasikan modul yang memang mereka
  import.

  `ARCHITECTURE.md` kini menyebut `tests/module-boundary.test.ts` di sebelah tiga
  gate modul lainnya, dengan alasannya: ketiganya memvalidasi graf yang
  DIDEKLARASIKAN dan tak satu pun membaca satu baris `import`.
  `13_final_master_index_traceability.md` menyatakan "23 modul terdaftar" — angka
  awcms-mini; nyatanya 21.

  **Temuan graph — `navigation` punya dua sumber yang tidak pernah
  direkonsiliasi.** `ModuleDescriptor.navigation` nyata dikonsumsi (disinkronkan
  ke `awcms_module_navigation`, disajikan `navigation-registry.ts`, divalidasi
  `module-composition.ts`) dan lima modul mendeklarasikannya — tetapi sidebar
  admin merender `navSections`, array statis di `AdminLayout.astro`. Jadi
  mendeklarasikan `navigation` menghasilkan baris DB dan entri API, **bukan** link
  menu; sebaliknya `/admin/tenant` tampil di sidebar tanpa descriptor apa pun.
  Dicatat di skill pemiliknya, tidak "diperbaiki" sepihak: sisi API sudah punya
  konsumen, jadi menyatukannya adalah keputusan desain.

  Graph di-refresh ke `deb43028` (7534 node, 21084 edge, 435 community, nol import
  cycle level-berkas).

- deb4302: Refresh knowledge graph ke `85517b8b` (7534 node, 21084 edge, 434 community; nol
  import cycle level-berkas) dan koreksi satu klaim usang di `PROJECT_STATE.md`.

  Dokumen itu masih menyatakan emisi purge cache tepi "belum" terpasang untuk
  `theming` — padahal #246 sudah memasangnya di publish/rollback/retire. Sekaligus
  menjelaskan kenapa `news_portal`/`media_library` sengaja TIDAK: keduanya tidak
  memiliki surface ter-deklarasi, jadi ban untuk key-nya tak akan cocok apa pun
  sementara antrean tetap melapor sukses — dan gate `edge-cache:surfaces:check`
  akan memunculkan kewajibannya sendiri begitu salah satunya mendeklarasikan
  surface.

## 6.3.0

### Minor Changes

- 156a7b6: Emit edge-cache invalidation from `theming`, and enforce the obligation by
  surface ownership.

  `theming` owns the `theming-tokens` surface (`/theming/{tenantCode}/tokens.css`),
  so publish, rollback, and retire each change what a cached object contains.
  All three now call `enqueueModuleContentPurge` inside the same transaction as
  the change (ADR-0042 §9 / ADR-0006).

  **`news_portal` and `media_library` deliberately do not.** Neither owns a
  declared surface, so nothing cached is tagged `m:news_portal` or
  `m:media_library` — a ban for those keys matches no object while the queue
  records `sent=1`. Adding them now would be ceremony that reads as coverage and
  provides none.

  `bun run edge-cache:surfaces:check` now demands a purge call site from **every
  module that owns a declared surface**, resolving `*_MODULE_KEY` constants across
  files. Framing it by ownership rather than by a hand-kept module list means the
  obligation appears on its own the day `news_portal` or `media_library` declares
  a surface, and stays silent until then.

  The asymmetry this closes: declaring a surface is one line and takes effect
  immediately; wiring its invalidation is a separate edit in another file that
  nothing forced. Miss it and the surface caches correctly, serves correctly, and
  never updates — with no error anywhere.

### Patch Changes

- 156a7b6: Stop `Accepted` admission ADRs from reading as shipped modules.

  Five ADRs — 0016 `organization_structure`, 0017 `document_infrastructure`, 0018
  `data_exchange`, 0019 `integration_hub`, 0021 `reference_data` — are `Accepted`
  for modules with no code in this repository. `Accepted` is a decision status, not
  a delivery status, but nothing said so, and the roadmap already named the
  consequence: someone reading `docs/adr/` "will conclude `organization_structure`
  can be called. It cannot."

  Not hypothetical. ADR-0020 asserted `reference_data` is `status: "active"` in the
  registry, citing a merged PR number — true of `awcms-mini`, where the sentence
  came from, and false here. Corrected.

  Each of the five now carries an unmissable not-implemented block naming what is
  absent and pointing at Wave A of the absorption roadmap.

  `tests/adr-admission-implementation-status.test.ts` binds the two facts, which
  otherwise live in different places and move independently: an admitted module
  must be in `listModules()` **or** its ADR must carry the marker. It fails in both
  directions — landing a module while the marker remains is caught too — and it
  asserts separately that no ADR claims an absent module is active in the registry,
  since prose copied between family repos is the likely source of the next
  instance. No database, so it runs on every PR.

- bfd9638: Pin the default tenant per environment, and state the owner-account convention
  for all three phases.

  `PUBLIC_DEFAULT_TENANT_ID`/`_CODE` are now set in staging and production rather
  than left to the end of the resolution chain. Unset still worked — the chain
  terminates at `awcms_setup_state.tenant_id` — but that makes "which tenant does
  an unmatched host resolve to?" an implicit answer living in a table rather than a
  stated one, and it silently becomes the wrong answer the moment a second tenant
  exists. The consumers are real: `seo_distribution` (`/robots.txt`, sitemap, feeds)
  and `site_search`.

  `PUBLIC_TENANT_RESOLUTION_MODE` is deliberately left unset. Production does have
  an `awcms_tenant_domains` row for `awcms.ahlikoding.com`, so `host_default` would
  work — but enabling host lookup widens the reachable surface and is its own
  decision, not part of "set the default tenant".

  Documents the owner convention across development, staging and production: the
  login identifier `admin@ahlikoding.com` is shared, the password never is.
  `awcms_identities` is unique on `(tenant_id, login_identifier)`, so one address in
  three environments is three unrelated accounts with three password hashes and
  three `AUTH_JWT_SECRET`s.

  Also records the permission-seed gap where it will actually be read, with the
  backfill SQL: a seed migration reaches only tenants created after it, so landing a
  module does not grant its permissions to an existing owner — the symptom is a 403
  on a module that is plainly installed. Plus the queries that show whether "full
  access" is genuinely full, since RBAC 197/197 means nothing if an ABAC deny, an
  SoD rule, or a business-scope constraint is in play.

- 2e907a5: Samakan environment development dengan staging/produksi, dan buang variabel env
  hantu dari dokumentasi.

  Development sebelumnya bukan versi kecil produksi melainkan environment yang
  berbeda secara diam-diam: skema berhenti di migrasi 30 (produksi 70), nol
  tenant, tanpa `.env`, dan satu-satunya role ber-LOGIN adalah superuser milik
  container — sehingga `FORCE RLS` inert dan justru bug termahal (kebocoran
  tenant, 403 permission) yang paling mustahil direproduksi di sana. Dev kini
  cocok baris per baris: migrasi 70, 118 tabel, 197 permission, RLS `ENABLE`+`FORCE`
  109/118, runtime sebagai `awcms_app`, owner `owner` 197/197 — dengan perbedaan
  yang disengaja (`AUTH_COOKIE_SECURE`, `TRUSTED_PROXY_ENABLED`, `EDGE_CACHE_MODE`)
  dicatat beserta alasannya.

  Dokumentasi menyebut `AUTH_JWT_SECRET` sebagai variabel wajib di lima berkas.
  **Variabel itu tidak ada di awcms** — tidak dibaca kode mana pun, dan tidak ada
  JWT di jalur sesi (token acak buram ber-hash sha256 di `awcms_sessions`).
  Klaimnya bukan sekadar usang: ia menopang pernyataan keamanan bahwa tiga
  environment terisolasi sebagian karena masing-masing punya JWT secret sendiri.
  Operator yang mengikutinya akan menyetel variabel yang tidak berefek apa pun.
  `APP_TIMEZONE` juga tercantum wajib dan sama-sama tidak ada.

  `tests/env-required-vars-doc.test.ts` mengikat daftar wajib di
  `deployment-profiles.md` ke `RULES` di `scripts/validate-env.ts`, menolak
  kemunculan ulang `AUTH_JWT_SECRET` sebagai variabel hidup, dan memverifikasi
  kedua nama itu memang tak pernah dibaca kode — empat mutasi terbukti merah.

- 4c2459d: Sapu drift docs/skill terhadap kode, dan pasang dua gate supaya kelasnya tidak
  kembali.

  Lima klaim yang **salah**, bukan sekadar usang:

  - `awcms-data-lifecycle` menyebut `form_drafts`/`comments` "DITUNDA (modul belum
    di-port)" — keduanya sudah di-port dan keduanya adopter `delegated`. Skill itu
    juga menyebut 2 adopter padahal ada **10 deskriptor di 7 modul**; agen yang
    mengikutinya akan melewatkan guard legal-hold pada tabel yang mewajibkannya.
  - `awcms-theming` menyebut `media_library` "di-drop — belum ada di base", dan
    menerangkan ketiadaan purge preview dengan "`data_lifecycle` tidak ada di base
    ini; tak ada `awcms_worker`". Ketiganya ada.
  - `awcms-wizard-form` menyebut `form_drafts` belum di-port.
  - `awcms-module-management` melaporkan "17 modul (dari 23)" mendeklarasikan
    `permissions`, dengan daftar yang tujuh di antaranya milik awcms-mini. Angka
    nyata: **20 dari 21**, dan satu-satunya pengecualian adalah `email`.
  - Lima dokumen menyatakan total yang tertinggal (`sql/001`–`067`, "65 migrasi",
    "20 modul") — termasuk paragraf di `repo-inventory.md` yang tugasnya justru
    MENGOREKSI klaim usang. Koreksi yang ikut usang lebih buruk dari aslinya: ia
    terbaca seperti baru saja diverifikasi.

  `src/lib/theming/theme-media.ts` punya kembaran klaim itu **di kode** — header
  seam-nya menerangkan resolusi asset no-op karena `media_library` tidak ada.
  Modulnya ada, lengkap dengan adapter nyata yang sudah dipakai `blog_content` dan
  `news_portal`. Akibat yang terlihat pengguna dan sebelumnya tidak tercatat di
  mana pun: tenant bisa mengunggah logo, id-nya tersimpan, dan tema tetap merender
  fallback nama-tema. Header-nya kini menyatakan itu; wiring adapternya tetap
  pekerjaan tersendiri.

  `domain-event-runtime/infrastructure/consumer-registry.ts` juga: header-nya
  menyatakan consumer `reporting` "intentionally NOT ported (they would import
  modules that are absent)" sementara berkas yang sama meng-import `reporting` di
  baris 8. Sekaligus mencatat cycle level-modul yang tak terlihat gate mana pun —
  `reporting` mendeklarasikan `domain_event_runtime`, dan modul ini meng-import
  `reporting`; `modules:dag:check` memvalidasi deklarasi saja (registry murni,
  tanpa I/O by design), jadi import tak-terdeklarasi tak terlihat, dan
  mendeklarasikannya secara jujur justru membuat gate itu merah karena cycle.

  Dua gate baru, keduanya mutation-proven:
  `tests/module-absence-claims.test.ts` (tidak ada dokumen/skill yang boleh
  menyangkal modul terdaftar) dan `tests/doc-inventory-counts.test.ts` (total modul
  dan rentang `sql/001`–`NNN` harus cocok dengan repo).

- c44d4ee: Stop tracking graphify's dated backup directories.

  Every `graphify` rebuild writes a full copy of the curated graph to
  `graphify-out/<YYYY-MM-DD>/` — roughly 12 MB of duplicate JSON per run. The
  previous refresh happened not to commit one; `.gitignore` now makes that a rule
  rather than something whoever stages the change has to notice.

  The live artifacts beside it (`graph.json`, `graph.html`, `GRAPH_REPORT.md`,
  `manifest.json`) stay tracked — those are the reviewable output.

- 156a7b6: Make the migration layer visible to the knowledge graph, and stop tracking
  `graph.html`.

  `tree_sitter_sql` was missing, so all 70 files in `sql/` contributed **nothing**
  to the graph — the layer that holds every RLS policy, every grant, and every
  tenant-isolation predicate was simply absent. Three defects fixed this week lived
  there, and the graph could not have helped find any of them. With the grammar
  installed the graph gains 179 nodes and 153 edges, including the tables
  themselves (`awcms_tenants`, `awcms_offices`, …) rather than just file names.

  Note for anyone rebuilding: graphify keys its cache on `manifest.json`, not on
  `cache/stat-index.json`. Installing a new grammar does not invalidate anything,
  so `--update` reports every file unchanged and the new grammar never runs. The
  entries have to be dropped from `manifest.json` to force re-extraction.

  `graph.html` is no longer tracked. It silently stops being emitted once the
  corpus passes graphify's viz node limit — the committed copy then rots while
  `graph.json` beside it stays current, which is precisely the failure mode this
  repo keeps getting bitten by. It is also ~8.7 MB per rebuild on top of
  `graph.json`'s ~10 MB, doubling what each refresh adds to history permanently.
  Regenerating is one command, documented in `.gitignore` next to the rule.

## 6.2.0

### Minor Changes

- e60409d: Bring the admin shell to structural parity with awcms-micro's admin pages.

  **Admin shell (`src/layouts/AdminLayout.astro`)** — adopted from awcms-micro's `AdminLayout.astro`:

  - `.admin-shell` column wrapper + sticky topbar. The layout row's hardcoded `min-height: calc(100vh - 57px)` (a measured topbar height) is replaced by `flex: 1`, so added topbar chrome can no longer desync it.
  - **`TenantBadge`** (`src/components/TenantBadge.astro`) names the active tenant in the topbar. Rendered as a plain non-interactive badge, never a `<select disabled>` — awcms scopes an identity to exactly one tenant, so there is nothing to switch to, and a disabled control would advertise a capability with no server-side enforcement behind it. `availableTenants` is kept as the seam for a real, server-computed switcher later.
  - **`ThemeToggle`** (`src/components/ThemeToggle.astro`) cycles system → light → dark, persists to `localStorage["awcms_theme"]`, and follows the OS while in system mode. awcms already shipped `:root[data-theme="dark"]` tokens with nothing to set the attribute — dark mode existed but was unreachable. This closes the dark-mode follow-up noted in PR #215.
  - **`SyncIndicator`** (`src/components/SyncIndicator.astro`) — dot + label driven by the real `fetchSyncIndicatorActive`, a bounded `EXISTS` over `awcms_sync_nodes` rather than the full sync-health aggregation. It shares ONE transaction with the tenant-name lookup, so the whole topbar costs a single round trip per `/admin/*` render.
  - **`LocaleBadge`** (`src/components/LocaleBadge.astro`) fills micro's `LanguageSwitcher` slot. awcms has no gettext catalog, so a `<select>` with one option would be a control that cannot do anything; the badge states the served language without pretending to offer a choice.
  - **Avatar + roles + log-out cluster** in the topbar. The avatar is a plain tile, not a link — micro's points at `/admin/profile`, which awcms does not have.
  - **Two-level sidebar** (section heading → owning module → links: General; Identity → Profile Identity / Identity & Access; System → Tenant Admin / Tenant Domain / Module Management / Email; Operations → Visitor Analytics) replacing one flat list, with the app version pinned to the footer. Grouping is presentation only — every route still runs its own ABAC guard, and a visible link grants nothing.
  - **Breadcrumb** above the page slot.

  **Dashboard (`src/pages/admin/index.astro`) — rebuilt, and not only cosmetically.** It previously rendered `Astro.locals.ssrContext` alone (tenant id, role count, permission count) plus quick links, with no database read at all — a page about your SESSION rather than your TENANT. It now renders the same four reports awcms-micro's dashboard does, every one of which already existed in this repo's `reporting` module and had simply never been surfaced in the UI:

  - Accent-barred KPI tiles: active users, active offices, allow-decisions in the window, and active/total sync nodes with a "Needs attention" badge when sync is unhealthy.
  - Detail cards for Tenant Activity, Access & Audit, and Sync Health, with alert styling on non-zero denies, open conflicts, and failed objects.
  - A Module Usage table (18 rows against a fresh tenant).

  Reads are gated on `reporting.dashboard.read`, so "you may not see this" stays distinguishable from "there is nothing here", and a report failure degrades to a notice rather than 500-ing the first page every admin lands on. The session cards remain below as the fallback view, preserving the `#admin-dashboard-heading` / `#dashboard-tenant-id` hooks asserted by `tests/e2e/admin-offices.e2e.ts`.

  **CSP change — `script-src` is now unconditional.** The theme-init script must run synchronously in `<head>` or the shell flashes the wrong theme, which a deferred Astro-bundled module cannot do. It is therefore the one `is:inline` script in this repo, admitted by SHA-256 (`src/lib/security/theme-init-script.ts`), not by `'unsafe-inline'` — a hash authorises one exact byte sequence. `script-src 'self' '<hash>'` is now always emitted instead of appearing only for Turnstile; the LAN/offline guarantee that no third-party origin appears is unchanged. Verified in a real browser-shaped render, not just by `curl`: the bytes Astro emits hash to exactly the registered value (`tests/theme-init-script.test.ts` fails on drift, since a mismatch is otherwise silent — no error, no log, just a blocked script).

  Deliberately NOT ported from awcms-micro, each because the backing capability does not exist here: `LanguageSwitcher` (no gettext catalog), `SyncIndicator` (would add a per-request reporting query), the profile icon (no `/admin/profile` route), the per-tenant sidebar-arrangement subsystem, and micro's JS drawer — awcms's CSS-only checkbox drawer is kept, since it needs no script at all and swapping it for JS would be a regression dressed as parity.

  Verified against a real PostgreSQL: all 10 admin screens render 200 through the new shell, and the tenant badge resolves its name from the database with a shape-checked fallback (this repo's `withTenant` _returns_ a 503 `Response` on circuit-open rather than throwing, so a bare `rows[0]` would have silently produced `undefined`).

- 952d616: Port the `comments` module from awcms-micro (ADR-0041) — moderation-first
  commenting over published, public resources.

  Registers the 21st base module. Content modules declare which of their resources
  accept comments through the new `ModuleDescriptor.commentableResources`
  descriptor list (`MODULE_CONTRACT_VERSION` 2.2.0 → 2.3.0, additive optional
  field); `comments` discovers them via `listModules()` and depends only on Core,
  so nothing depends on it and the DAG stays acyclic. `blog_content` contributes
  the first descriptor.

  Ships seven tables (`sql/066`, all ENABLE + FORCE RLS), eight permissions
  (`sql/067`, reusing existing `AccessAction` literals — no union widening), ten
  API routes, an SSR moderation queue at `/admin/comments`, three domain events, a
  legal-hold-aware retention sweep (`bun run comments:retention`), and a registry
  gate (`bun run comments:resources:check`).

  Because this is an unauthenticated public write surface: bodies are stored as
  plain text and escaped on render (no stored HTML, so no stored XSS); public
  submit responses are uniform, so the endpoint cannot be used as an oracle for
  blocked terms or unpublished content; author email, IP, and user-agent are only
  ever stored hashed or masked; and notification recipients are encrypted under
  their own key, with an unresolvable sentinel rather than plaintext when no key
  is configured.

  Three defects in the source were fixed rather than carried over: a
  millisecond-rounded keyset cursor that skipped rows, `published_at` being
  cleared on archive, and a worker INSERT grant justified by a retention event
  that was never written.

- 6308a84: Emit edge-cache invalidation from blog content changes (ADR-0042).

  `enqueueEdgeCachePurge` previously had no callers, so a published edit stayed
  visible at the edge until its TTL expired. The four blog write paths — create,
  update, soft-delete, and scheduled publish — now enqueue a purge inside the same
  transaction as the content change, so a rolled-back write leaves no stray purge
  and a committed one cannot lose its invalidation.

  Purges are module-scoped, not resource-scoped: cached responses carry
  tenant/surface/module surrogate keys only, so a resource-scoped ban would match
  no object and leave the page stale while reporting success.

  No-op when `EDGE_CACHE_MODE` is off, so deployments that have not adopted the
  edge cache do not accumulate queue rows.

- 8a8e25c: Port the `form_drafts` module from awcms-micro (Issue #484) — row 1 of Gelombang 1 in `docs/awcms/absorb-awcms-micro-roadmap.md`. Net-new and additive: nothing existing changes behaviour, the module DAG stays acyclic (`dependencies: ["identity_access"]`), and nothing consumes it yet.

  A generic, **domain-agnostic** server-side draft store for multi-step forms. One table holds an opaque JSONB payload plus the coordinates needed to resume it (`module_key`, `wizard_key`, `resource_type`, `resource_id`, `current_step`); what the payload MEANS stays owned by whichever module created it. `type: "system"` — shared platform mechanism, like `logging` and `data_lifecycle`.

  - **Migrations `062` (schema) + `063` (permissions).** `awcms_form_drafts`, `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation`, four indexes covering the resume/expire/purge/dry-run query paths. `awcms_worker` gets exactly SELECT/UPDATE/DELETE — no INSERT, since the purge job never creates a draft. Four permissions (`draft.{read,create,update,delete}`).
  - **Endpoints** under `/api/v1/form-drafts` — list/create, get/patch/delete, and submit. Submit requires an `Idempotency-Key`; create deliberately does not, because a retried create costs one deletable scratch row while a retried submit hands the payload to a domain action twice. Requiring a key everywhere would just train callers to generate throwaway ones.
  - **Payload safety.** 32 KB ceiling, and any key at any nesting depth resembling a secret (`password`/`token`/`secret`/`credential`/`apiKey`/`privateKey`) is **rejected outright, never silently redacted** — a caller who gets a 200 back must not have to wonder whether a field was stripped.
  - **No `submit` permission.** Submit guards on `draft.update`; a separate action would widen the `AccessAction` union and plant a latent-authz trap, since an action nobody seeds into a role denies even the tenant owner while looking correct in review.
  - **Two-phase retention** via `bun run form-drafts:purge`: expire overdue drafts to `status='expired'` (a transition, not a delete), then physically purge `expired`/`abandoned` rows past the cutoff (default 30d). Both bounded and self-auditing.
  - **Legal-hold enforcement lives in this module, not in the engine.** The `data_lifecycle` descriptor is `delegated`: that engine only READS this table for backlog visibility and never mutates it, so a hold enforced only there would stop nothing. The real gate is in `purgeExpiredFormDrafts`, which asks the injected `LegalHoldGuardPort` before its DELETE and skips the batch when held. Phase 1 is deliberately ungated — it deletes nothing.

  Verified: `tests/form-draft-validation.test.ts` (18) plus a new `tests/form-drafts-module.test.ts` (12) whose drift guards were **mutation-proven red** — renaming the lifecycle key, dropping `FORCE ROW LEVEL SECURITY`, and over-granting the worker each fail the suite. One assertion was rewritten after the first mutation run showed it was tautological (both sides read the same constant, so a rename kept it green); the descriptor key is now pinned as a literal, because a rename silently orphans every legal hold already recorded against the old key.

  Not included, and not claimed: awcms-micro's wizard COMPONENT library (`src/components/ui/`) is a separate, still-open Gelombang-0 row, and there is no integration test against a real PostgreSQL for this module yet.

- c2a981c: feat(site-search): port the `site_search` module from awcms-micro (ADR-0040)

  Adds a tenant-scoped, cross-content PostgreSQL full-text search index over
  PUBLISHED public website content, its public host-resolved query/suggest
  surface, and its ABAC-guarded admin index/settings/diagnostics API.

  - **New module `site_search`** (`type: domain`, depends only on
    `tenant_admin`/`identity_access`) owning `awcms_site_search_documents` plus
    tenant config, the index run ledger, failed-item diagnostics, and an opt-in
    minimized query log (`sql/064`, `sql/065`).
  - **New contribution seam** `ModuleDescriptor.searchSources` — content modules
    declare reviewed, pure-data source descriptors in their own `module.ts` and
    the aggregator discovers them through `listModules()`, so nothing depends on
    `site_search`. `MODULE_CONTRACT_VERSION` 2.1.0 → 2.2.0 (additive: a
    `module.ts` that omits `searchSources` stays valid). `blog_content`
    contributes `blog_content.post`.
  - **New public endpoints** `GET /api/v1/site-search/query` and `/suggest`
    (anonymous, host-resolved, rate-limited) plus the public `/search` page, and
    **new admin endpoints** `GET|PUT /api/v1/site-search/settings` and
    `/api/v1/site-search/index/{status,reconcile,rebuild,failures}`.
  - **New scheduled job** `bun run site-search:reconcile` and a new registry gate
    `bun run site-search:sources:check` (added to the `check` chain).
  - **New `AccessAction` member** `reconcile` (deliberately not high-risk; the
    route is still idempotency-keyed and audited).

  Public URLs are built with a server-resolved `:tenantCode` because this base's
  public content routes are path-tenant-scoped (`/blog/{tenantCode}/{slug}`).
  awcms-micro's inline typeahead script on `/search` is not ported: this base's
  CSP forbids inline scripts and its public pages have no bundling step, so the
  page ships the no-JS core search and `/suggest` stays available to a theme's own
  client.

  Existing tenants do not retroactively gain the six new permissions — like every
  prior permission-seed migration, only tenants created after it runs get them via
  setup initialization. Backfill `awcms_role_permissions` when deploying.

- 476e6d1: Wire the Cloudflare DNS adapter so a database row becomes a working subdomain.

  Adds `ensureServingRecord` to the `TenantDomainDnsProvider` port and a
  reconciliation job (`bun run tenant-domain:dns:sync`) that brings the managed
  Cloudflare zone into line with the active `domain_type = 'subdomain'` rows in
  `awcms_tenant_domains`.

  Reconciliation, not a create-time API call: it is idempotent, retries a failed
  record on the next pass, and heals drift introduced by hand in the dashboard —
  none of which a side effect inside the create request can do. Serving records
  are desired-state, so a drifted record is moved with `PUT` rather than joined by
  a second record that would round-robin the tenant between two targets.

  Scope: platform subdomains only. Custom domains live in the tenant's own zone
  and keep the manual/TXT verification flow. Nothing is ever deleted.

  `sql/069` grants the worker `SELECT` (only) on `awcms_tenant_domains`. Unset
  config is a no-op: there is deliberately no default serving target.

- f4ee902: Add an optional Varnish edge-cache tier with origin-pressure auto-activation (ADR-0042).

  Public, tenant-scoped, content-derived GET surfaces can now be answered by a
  cache in front of the application instead of re-running the same database work
  for every anonymous visitor. Off by default and a genuine no-op when off.

  - `src/lib/edge-cache/` — fail-closed cacheability decision, surrogate-key
    vocabulary, rolling-window pressure tracker, surface allow-list, header
    application, durable purge queue, Varnish BAN client.
  - `sql/068` — `awcms_edge_cache_purges` invalidation queue (ENABLE + FORCE RLS),
    with matching `WORKER_ROLE_GRANTS` entries.
  - `infra/varnish/` — default-deny VCL and a compose overlay.
  - `bun run edge-cache:surfaces:check` — new registry gate in `bun run check`.
  - `bun run edge-cache:purge` — scheduled invalidation worker.

  Cacheability is an allow-list: an undeclared route is never cached. The
  auto-activation ramp can only change how long something is cached, never whether
  a private response becomes cacheable.

### Patch Changes

- bc7a883: Document the awcms-mini backbone absorption programme
  (`docs/awcms/absorb-awcms-mini-backbone-roadmap.md`).

  Records an audit finding: five modules are admitted by **Accepted** ADRs in this
  repository but have no code — `organization_structure` (ADR-0016),
  `document_infrastructure` (ADR-0017), `data_exchange` (ADR-0018),
  `integration_hub` (ADR-0019) and `reference_data` (ADR-0021). ADR-0020 (ERP
  readiness contracts) is likewise Accepted with no `_shared` implementation. The
  SaaS control-plane cluster is not admitted here at all and is gated behind a new
  admission ADR.

  Documentation only — no runtime change.

- 4343f9e: Fix edge-cache invalidation, which had never worked.

  The ban expression built by `infra/varnish/default.vcl` used `(^| )key( |$)` to
  anchor a surrogate key to a whole token. Varnish parses a ban expression by
  splitting it on **whitespace** into `<field> <operator> <argument>`, so the
  literal spaces inside that regex produced the wrong token count and every ban
  was rejected with `Wrong number of arguments`.

  Nothing surfaced it. The VCL's BAN handler returns `200` regardless, so
  `sendEdgeCachePurge` recorded success, the queue row was marked done, and the
  object stayed cached until its TTL expired. The subsystem reported healthy
  invalidation while performing none — the precise failure mode ADR-0042 exists to
  prevent. It was found by putting Varnish in front of staging and watching
  `X-Cache` stay `HIT` after a purge.

  Both sides now emit `(^|[[:space:]])key([[:space:]]|$)`: same boundary semantics,
  no literal space. Quoting the regex is not an alternative — the split happens
  before quote handling (verified against Varnish 7.5).

  Also corrects `infra/varnish/docker-compose.varnish.yml`, which named
  `varnishcache/varnish:7.5`. No such Docker Hub repository exists, so adopting the
  overlay failed with `pull access denied`. The image is `varnish:7.5`.

  Guarded by two file-level assertions in `tests/edge-cache.test.ts`, because the
  runtime expression is built in VCL rather than TypeScript and no unit test of the
  origin can observe it.

- 7e338da: Fix the edge-cache purge queue's tenant-isolation policy, which read a GUC the
  application never sets — breaking every blog write when the cache was enabled.

  `sql/068` created `awcms_edge_cache_purges_tenant_isolation` against
  `current_setting('awcms.tenant_id', true)`. `withTenant()` sets
  `app.current_tenant_id`, and so do the other 108 tenant policies in `sql/`.
  `sql/068` was the only outlier.

  The consequence was not a stale cache. `current_setting` returned NULL, so the
  `WITH CHECK` predicate was NULL and every INSERT was rejected with
  `new row violates row-level security policy`. `enqueueModuleContentPurge` is
  awaited **inside** the content transaction (ADR-0042 §9 / ADR-0006) and is not
  guarded, so that rejection aborted the publish: with `EDGE_CACHE_MODE` set to
  `auto` or `on`, blog create, update, delete, and scheduled publish all returned 500. The `USING` side failed in the opposite, quieter direction — the purge
  worker matched zero rows and reported `sent=0`, which reads exactly like an empty
  queue.

  It could not surface earlier. The subsystem defaults to `off`, where the enqueue
  returns before touching the database, so no CI job, integration test, or
  deployment had ever written to this table. It appeared on the first request after
  the feature was switched on.

  `sql/070` replaces the policy. `sql/068` is left untouched — it is applied in a
  running deployment and rewriting it would change its checksum and block
  `db:migrate`.

  Adds `tests/migration-tenant-guc-consistency.test.ts`: a database-free gate that
  scans every migration's executable SQL (comments stripped, so a repair migration
  may name the wrong GUC while explaining itself) and fails on any
  `current_setting` that is not `app.current_tenant_id`. It runs in the `quality`
  job on every PR, which is where this class of typo needs to be caught — at
  authoring time, not on the day a flag is enabled in production.

- 7e338da: Fix the purge transport: Bun cannot send the `BAN` method, so no purge ever
  reached Varnish.

  `sendEdgeCachePurge` issued `fetch(endpoint, { method: "BAN" })`, the
  conventional Varnish idiom. **Bun does not transmit non-standard HTTP methods.**
  Both `fetch` and `node:http` deliver that request as `GET` — confirmed against
  Bun 1.3.14 with `varnishlog -i ReqMethod`, where the same request written
  byte-for-byte over a raw socket logs `BAN` and answers `200 Banned`.

  Every purge therefore fell past the VCL's ban branch to the origin, which 404s an
  unrouted path. On a Bun-only runtime (ADR-0002) no configuration makes the `BAN`
  method work.

  The wire protocol is now `POST /__edge-cache-purge`. The security model is
  unchanged — the method was never a control; the purge ACL, the shared token, and
  the key-charset re-validation at the edge all still apply, to both entry points.
  The VCL continues to accept a real `BAN`, so `curl -X BAN` remains available for
  operator debugging.

  Adds `tests/edge-cache-purge-client.test.ts`, the first tests this client has had.
  They run against a real `Bun.serve` and assert `request.method` **as received**,
  because that is the only formulation that can fail for the reason this failed: an
  injected `fetchImpl` observes the argument, not the wire, and would have asserted
  `method === "BAN"` and passed forever.

- f2b96da: Pin the two deployed environments to their domains: `awcms.ahlikoding.com`
  (production) and `awcms-staging.ahlikoding.com` (staging).

  Adds `docs/awcms/environments.md` (domains, per-environment `APP_ENV`/`APP_URL`,
  staging isolation rules, DNS, edge-cache settings) and references it from
  `.env.example` and `deploy-coolify.md`, which previously used only generic
  placeholders.

  `APP_URL` is called out specifically because it builds the OIDC/SSO callback URL
  — a wrong host breaks login rather than just looking wrong.

  Documentation and example configuration only; no runtime change.

- 78a530b: docs(site-search): correct the CSP rationale on the `/search` page renderer

  PR #229 landed between the site_search port and this change: `script-src` is now
  always emitted, carrying `'self'` plus the SHA-256 of the admin theme-init
  script. The renderer's comment still described the policy as `default-src 'self'`
  and implied inline scripts are categorically impossible.

  The no-`'unsafe-inline'` guarantee is unchanged, and the page's behaviour is
  unchanged — but a reader would now find a sanctioned hashed-inline script in the
  tree and conclude the comment was simply out of date. It names that pattern
  explicitly and states the reason it does not apply here: this route is a plain
  APIRoute with no build step to compute or keep such a hash in sync.

- f6d0353: Record the real state of the deployed environments: staging is live at
  `awcms-staging.ahlikoding.com` (own Coolify app and database, R2/email/sync off),
  production DNS and app already existed, and `awcms-micro-staging` has been
  removed.

  Also documents why `db:migrate` cannot run via `docker exec` on the production
  image — it is runtime-only and does not ship `scripts/` — and gives the one-shot
  container command instead. Staging has no schema until that is run.

  Documentation only.

## 6.1.0

### Minor Changes

- eb5519a: Reposisi governance AWCMS (ADR-0035, menyempurnakan positioning ADR-0034 — `docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md`): `awcms` kini diposisikan sebagai template **online-first hybrid** (online jalur utama; offline/LAN mode ketahanan), **siap ERP + SaaS terintegrasi**, dan **superset** keluarga yang **menyerap** klaster website/e-commerce, UI/UX, dan pengerasan auth `awcms-micro` langsung ke `src/modules/`. `awcms-mini` tetap hybrid offline-first (siap SaaS); `awcms-micro` tetap template website full-online ramping. Model tata kelola dipakai-langsung/tanpa-repo-turunan (ADR-0034 §2/§3) tidak berubah.

  Perubahan dokumentasi/governance saja (tanpa perubahan kode runtime): ADR-0035 baru + banner supersede-parsial di ADR-0034; reposisi README/README.id/AGENTS/PROJECT_STATE + paket `docs/awcms/` (01/06/09/10/12/13/15, alur-pengembangan-mini-first, README index, api-contribution-guide); manifest `awcms-family-compatibility.yaml` (`role` + rasional divergence Turnstile diselaraskan ke mode hybrid); dokumen peta baru `docs/awcms/absorb-awcms-micro-roadmap.md` untuk penyerapan bertahap awcms-micro.

- c25e795: Port the redirect-governance scope of `seo_distribution` from awcms-micro (ADR-0039, companion to ADR-0038 — `docs/adr/0039-seo-distribution-redirect-governance.md`), completing the module whose discovery half shipped in ADR-0038. Adds tenant-contained exact-path redirect rules (301/302/307/308), URL-change capture into audited redirect proposals, privacy-minimized 404 telemetry, and the admin API under `/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*`.

  - **Migrations 060 (schema) + 061 (permissions).** Three tenant-scoped tables (`awcms_seo_redirects`, `awcms_seo_not_found_observations`, `awcms_seo_redirect_settings`), all `ENABLE`+`FORCE ROW LEVEL SECURITY` + `tenant_isolation`; the 404 table has a `dataLifecycle` analytics_telemetry descriptor (`seo_distribution.not_found_observations`, generic purge, 30d default) with a `SELECT, DELETE ... TO awcms_worker` grant. Six new permissions (`redirect.{read,create,update,delete}`, `not_found.{read,update}`).
  - **One invasive `src/middleware.ts` edit** — the non-`/admin` branch resolves a public redirect BEFORE serving and records a best-effort 404 observation AFTER. FAIL-OPEN: the resolver swallows all faults to null (never a 500), the 404 capture never throws; the `/admin` login guard and API body-ceiling are untouched. Wiring lives in the importable `src/lib/seo/redirect-middleware.ts`.
  - **Open-redirect / loop / hijack defenses** — the frozen `classifyRedirectTarget`/`assertSafeRedirectTarget` guard is re-homed as a standalone domain helper (`redirect-target-classification.ts`), NOT re-added to the `seo_facts` port, and enforced on write AND every resolve; normalization rejects CRLF/traversal/Unicode-confusion/protocol-relative; chains are bounded + non-recursive (fail-closed on loop/over-cap); the eligibility gate excludes admin/API/auth/static/system/discovery paths.
  - **Adaptations (documented in ADR-0039):** tenant resolution is host-based-only first cut (path-tenant deferred); the legacy `/blog/{tenantCode}` → `/news` rewrite is INERT (no `/news` route family, policy off by default); `locale` is always null (awcms has no i18n seam). `seo_distribution` bumped 0.1.0 → 0.2.0.

- 0dce625: Media-library ownership inversion (ADR-0036, mengadaptasi awcms-micro ADR-0026 — `docs/adr/0036-media-library-module-admission-ownership-inversion.md`).

  **CAPABILITY RETIREMENT (bukan bump minor kapabilitas):** capability `news_media` **dipensiunkan** dan digantikan `media_library`. Penyedianya berubah (`news_portal` → `media_library` baru) **dan** kontrak port kehilangan satu method (`isFullOnlineR2ModeActiveForTenant` → `isManagedMediaEnforcementActiveForTenant`; `resolveMediaPublicBaseUrl` di-drop). `_shared/capability-contract-versions.ts` + manifest `awcms-family-compatibility.yaml` menambah `media_library: "1.0.0"`; setiap konsumen yang dipin ke `news_media` harus gagal terang-terangan.

  Perubahan NON-aditif — menyentuh modul yang sudah di-ship:

  - **Modul baru `media_library`** (System Foundation, `type: system`, `isCore: false`, deps `[tenant_admin, identity_access]`): registry media `awcms_news_media_objects` (tabel TIDAK di-rename — FK komposit keras dari ad placements), presigned upload/finalize/cancel, MIME sniffing, verifikasi R2, job `news-media:reconcile` (nama command dipertahankan), plus penyalaan enforcement (`POST/GET /api/v1/media/enforcement`, satu arah, readiness-gated + audited).
  - **`news_portal`** tidak lagi PROVIDES `news_media`; kini CONSUMES `media_library` (wajib) + `public_content`; basePath berubah ke `/api/v1/news-portal`; job reconcile & 9 permission media pindah keluar.
  - **`blog_content`** consumes `media_library` (opsional, dulu `news_media`); adaptor no-op media vestigial dihapus; gate media & 12 composition-root handler + worker menyuntik `mediaLibraryPortAdapter`.
  - **Migrasi (ADD-only, urutan load-bearing):** `052` repoint permission `news_portal.media.*` → `media_library.media.*` (INSERT→repoint grant→DELETE), `053` tabel `awcms_media_library_tenant_state` (RLS ENABLE+FORCE + backfill dari `awcms_news_portal_tenant_state`), `054` permission `media_library.enforcement.{read,enable}`.
  - Fragment OpenAPI media dipindah ke `openapi/modules/media-library.openapi.yaml` (+ path enforcement); bundle + api-reference diregenerasi.

  Diverifikasi terhadap PostgreSQL nyata: repoint permission bersih, RLS FORCE + isolasi tenant + fail-closed `awcms_app`, dan backfill lintas-tenant (role migrasi BYPASSRLS). Step 5b/5c/5d micro (`/admin/media`, srcset, PDF) ditunda.

- a777152: Port modul `blog_content` dari awcms-mini: manajemen blog/konten tenant-scoped (posts, pages, kategori/tag, riwayat revisi append-only, pencarian full-text, template/menu/widget/iklan presentasi, pengaturan blog, dan automatic internal tag linking). Menambahkan 6 migrasi baru (`sql/035`-`sql/040`, 15 tabel + seed 39 permission), ~40 route admin di `/api/v1/blog/*`, 7 route publik anonim di `/blog/{tenantCode}/...` (ADR-0009), job terjadwal `bun run blog:publish:scheduled`, serta fragment OpenAPI/AsyncAPI baru untuk modul ini.

  Dua kapabilitas opsional modul ini (`news_media` dari `news_portal`, `social_publishing` dari `social_publishing`) belum punya provider nyata di base ini — setiap titik panggil memakai adapter no-op modul sendiri (mode full-online-R2-only selalu tidak aktif, hook social-publishing selalu no-op `{ jobsCreated: 0 }`), aman dan terdokumentasi, tanpa mengimpor modul yang belum ada. Keluarga rute `/news/**` (butuh modul `tenant_domain` yang belum di-port) sengaja tidak diikutkan di port ini.

- cc52dce: Port modul `data_lifecycle` dari awcms-micro (Issue #745, ADR-0037) sebagai modul **System Foundation** net-baru aditif, PLUS re-wire kopling legal-hold dua konsumen (`visitor_analytics`, `logging`) yang di-drop saat port awalnya.

  - **Seam kontrak (aditif, MINOR):** `ModuleDescriptor.dataLifecycle?: HighVolumeTableDescriptor[]` + keluarga tipe `Lifecycle*` di `_shared/module-contract.ts` (`MODULE_CONTRACT_VERSION` 2.0.0 → 2.1.0, pin manifest keluarga diselaraskan). Registry dikontribusikan tiap modul pemilik, divalidasi `bun run data-lifecycle:registry:check` (masuk rantai `check`) + `security:readiness`.
  - **Modul** (`src/modules/data-lifecycle/`, 16 berkas): legal-hold (rules murni + service + guard-port adapter), lifecycle-registry, dry-run planner (zero-mutation), bounded archive/purge engine di worker runner bersama, archive port provider-neutral + local/offline adapter (JSONL/CSV + SHA-256), cursor/manifest/run stores, cursor-boundary safety margin (1ms, fix presisi timestamptz mikrodetik). `type: system`, deps `[tenant_admin, identity_access, logging]`, 6 permission, job `data-lifecycle:archive-purge`, satu descriptor `generic` (tabel run-history sendiri), aturan SoD maker/checker `legal_hold.create` vs `.release`.
  - **Skema** (migrasi `055` schema, `056` permission): empat tabel tenant-scoped (`awcms_data_lifecycle_legal_holds`/`_cursors`/`_archive_manifests`/`_runs`), semua `ENABLE`+`FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`, CHECK konsistensi + index; GRANT `awcms_worker` least-privilege — **SELECT-only pada legal_holds** (create/release tetap aksi admin/API), SELECT/INSERT/UPDATE pada cursors+manifests, SELECT/INSERT/DELETE pada runs. Non-destruktif (semua `IF NOT EXISTS`).
  - **Endpoint** (`/api/v1/data-lifecycle/*`): registry GET, dry-run POST (tanpa idempotency), runs GET, legal-holds GET+POST (Idempotency-Key + audit critical), legal-holds/{id}/release POST (Idempotency-Key + audit critical). Archive/purge nyata **tidak** diekspos lewat HTTP (job saja). Fragmen OpenAPI per-modul + bundle + api-reference diregenerasi.
  - **`AccessAction` baru:** `release` (HIGH-RISK — melepas hold menghapus safeguard perlindungan data).
  - **Legal hold tidak bisa di-bypass diam-diam:** dienforce pada RECORD hold aktif (bukan metadata `legalHold.applicable`), dicek SEBELUM DELETE dan tanpa syarat. Untuk deskriptor `delegated`, fungsi purge modul pemilik adalah titik enforcement nyata via `LegalHoldGuardPort` (`_shared/ports/legal-hold-guard-port.ts`, seam level-sumber, bukan capability-registry) yang di-wire di composition root.
  - **Re-wire `visitor_analytics`:** descriptor `visitor_analytics.visit_events` + param ke-5 `legalHoldGuard` pada `purgeVisitorAnalyticsData` menggerbangi HANYA DELETE step-1 `awcms_visit_events` (step 2-4 tetap tak-tergerbang); adaptor di-inject di `POST /api/v1/analytics/retention/purge` + `scripts/visitor-analytics-purge.ts`.
  - **Re-wire `logging`:** descriptor `logging.audit_events` + param **WAJIB** `legalHoldGuard` pada `purgeExpiredAuditEvents` menggerbangi DELETE audit-events; adaptor di-inject di `scripts/audit-log-purge.ts`.
  - **Ditunda:** konsumen `form_drafts`/`newsletter`/`comments` (modul belum di-port).

- a777152: Port modul `news_portal` dari awcms-mini: registry media objek R2-only tenant-scoped (`awcms_news_media_objects`) dengan alur presigned upload langsung-ke-R2 (create/finalize/cancel), homepage section composer editorial (`awcms_news_portal_homepage_sections`), ad placement preset R2-only (`awcms_news_portal_ad_placements`), state tenant mode R2-only (`awcms_news_portal_tenant_state`), dan job rekonsiliasi `news-media:reconcile`. Migrasi `sql/041`..`sql/045` (empat tabel baru RLS ENABLE+FORCE). Modul MENYEDIAKAN capability `news_media` — adapter nyata kini menggantikan no-op blog_content di seluruh composition root (route + worker `blog:publish:scheduled`) — dan MENGONSUMSI `public_content` blog_content untuk validasi referensi homepage section. Rute publik `/news/**` (butuh `tenant_domain`), halaman admin `.astro`, dan aktivasi preset (butuh subsistem preset `module_management`) sengaja di-drop dan didokumentasikan. Menambah aksi `verify` ke union `AccessAction`, grant `awcms_worker` untuk job rekonsiliasi, dan skrip `news-media:reconcile`.
- c9baa0c: Port modul `seo_distribution` — **scope discovery** — dari awcms-micro (ADR-0038, mengadaptasi awcms-micro ADR-0028; program penyerapan ADR-0035, Wave 1). Aditif net-baru; DAG tetap asiklik.

  Yang ditambahkan:

  - **Seam capability `seo_facts`** (`_shared/ports/seo-facts-port.ts`, `CAPABILITY_CONTRACT_VERSIONS["seo_facts"]="1.1.0"`): kontrak kontribusi beku (tipe fakta + guard JSON-LD terkontrol + predikat visibility + cache-key). `blog_content` kini `provides: ["public_content","seo_facts"]` lewat adaptor `application/seo-facts-port-adapter.ts` (baris `awcms_blog_posts` → `SeoResourceFacts`; noindex/non-publik/belum-terbit → `sitemap:null`/`feed:null`). `seo_distribution` `consumes` `seo_facts` (opsional) + `media_library` (opsional).
  - **Modul `seo_distribution`** (`type: domain`, v0.1.0, deps Core-only): renderer metadata terpusat (canonical/hreflang/robots/OG/Twitter/JSON-LD terkontrol, host diturunkan server dari `tenant_domain`), serializer sitemap/robots/feed, orkestrator discovery + validator cache (ETag/Last-Modified/304).
  - **Route discovery publik tak-terautentikasi** di root host: `/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json` (route Astro XML/text, bukan OpenAPI; `src/middleware.ts` TIDAK diedit).
  - **Config admin tenant** `GET`/`PUT /api/v1/seo/config` (`config.read`/`config.update`, tenant-scoped, `PUT` idempoten + di-audit) + fragment OpenAPI + tag "SEO & Distribution".
  - **Migrasi 057-059**: `awcms_seo_tenant_settings` (RLS ENABLE+FORCE + `tenant_isolation`), seed permission config, kolom config feed/sitemap.
  - Helper aditif `escapeXmlText` + varian error `text/plain` di `src/lib/html/*`; env var publik didokumentasikan (`PUBLIC_TRUST_PROXY`, `PUBLIC_TENANT_RESOLUTION_MODE`, `PUBLIC_DEFAULT_TENANT_*`).

  Ditunda ke PR lanjutan (tata-kelola redirect): aturan redirect + hook redirect middleware, tabel telemetri 404, descriptor `dataLifecycle`, dan permission `redirect.*`/`not_found.*`.

- 359bd7a: Port modul `tenant_domain` dari awcms-micro (epic #555): pemetaan
  hostname/subdomain → tenant untuk routing publik berbasis host (Wave-0 program
  penyerapan awcms-micro). Menambah tabel `awcms_tenant_domains` (migrasi 046, tenant-scoped
  `ENABLE`+`FORCE ROW LEVEL SECURITY`, unique hostname lintas-tenant, satu primary
  per tenant), seed permission `tenant_domain.domains.*` (migrasi 047), dan fungsi
  lookup host→tenant `awcms_resolve_tenant_domain_lookup` `SECURITY DEFINER`
  (migrasi 048). Fungsi ini di-own oleh role bootstrap khusus `awcms_domain_bootstrap`
  (`NOLOGIN`/`NOSUPERUSER`/`NOBYPASSRLS`, tanpa anggota) dengan policy `FOR SELECT`
  ter-scope (`USING (true)` khusus role itu) sehingga bootstrap host→tenant tetap
  resolve di deployment role-separated tempat owner migrasi **bukan** superuser
  (mis. `awcms_app`/`awcms_worker`/`awcms_setup` dari sql/019–022, dan harness
  integrasi yang men-demote owner-nya) — tanpa memberi `BYPASSRLS` ke role apa pun,
  tanpa melepas `FORCE ROW LEVEL SECURITY`, dan tanpa menyentuh policy
  `tenant_isolation`. `EXECUTE` hanya ke `awcms_app`; kolom sensitif
  (`verification_token_hash`/`verification_record_value`) tetap tak terbaca.

  API manajemen tenant-scoped di `/api/v1/tenant/domains` (list/create/read/
  update/soft-delete + `verify` dan `set-primary` yang ber-`Idempotency-Key` dan
  diaudit), layar admin `/admin/tenant/domains`, resolver host publik ADITIF
  (`lib/tenant/public-host-tenant-resolver.ts` — hidup berdampingan dengan
  routing berbasis path `/blog/{tenantCode}` ADR-0009, tidak meregresi), dan
  adapter Cloudflare DNS OPSIONAL (env-gated, aman tanpa kredensial, belum
  di-wire ke rute mana pun).

  Deferral yang didokumentasikan: rute konten publik ber-resolusi host belum
  di-wire (deferral yang sama seperti `/news/**` news_portal); `src/middleware.ts`
  tidak disentuh (jaminan login/Turnstile/CSP tak berubah). Union `AccessAction`
  identity-access diperluas dengan `set_primary`.

  **Risiko residual (harden sebelum go-live self-service custom domain).** `verify`
  saat ini mengaktifkan domain berdasarkan field in-row tanpa bukti kepemilikan
  outbound (model manual-first; adapter DNS ada tapi belum di-wire). Untuk mencegah
  pengambilalihan domain (dangling-DNS) pada custom domain bersama, aktivasi
  `custom_domain` **wajib digerbangi operator/manual** sampai bukti kepemilikan
  DNS-token (`verification_token_hash` + cek TXT/CNAME lewat adapter) di-wire.
  `verify` sudah default-deny + di-audit; risiko ini didokumentasikan di README modul
  dan skill `awcms-tenant-domain-routing`.

- 8c959ff: Port modul `visitor_analytics` dari awcms-micro (epic #617-#624) sebagai modul standalone `type: "system"` (ADR-0035 Wave 1). Menambah statistik pengunjung manusia **privacy-first** untuk rute admin & publik, online maupun offline/LAN.

  - **Skema** (migrasi 049 permission, 050 schema, 051 session-lookup index): `awcms_visitor_sessions`/`awcms_visit_events`/`awcms_visitor_daily_rollups`, semua `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`, index tenant_id-first, composite FK `(tenant_id, visitor_session_id)` lintas-tenant, dan GRANT `awcms_worker` least-privilege untuk job terjadwal.
  - **Privasi:** off by default (`VISITOR_ANALYTICS_ENABLED=false`); visitor-key/IP/user-agent disimpan hanya sebagai HMAC-SHA256 bersalt (salt wajib saat enabled — ditegakkan `validate-env`); raw IP & login snapshot opt-in terpisah; query string sensitif di-strip fail-safe.
  - **Koleksi = endpoint ingest PUBLIK** `POST /api/v1/analytics/collect` (anonim, resolve tenant dari `tenantCode` tabel `awcms_tenants` yang RLS-free — TANPA SECURITY DEFINER), **bukan** middleware: `src/middleware.ts` tidak disentuh (jaminan login/Turnstile/CSP tetap).
  - **API terautentikasi ABAC:** `GET /api/v1/analytics/{summary,realtime,sessions,events,pages,devices,locations,security,settings}`, `PATCH .../settings`, dan `POST .../retention/purge` (Idempotency-Key + audit `critical`). Raw-detail digerbangi `visitor_analytics.raw_detail.read`.
  - **Job:** `bun run analytics:rollup` & `bun run analytics:purge` (worker role, offline-safe).
  - **Dashboard** `/admin/analytics` (SSR-render).

  Adaptasi port terdokumentasi: kopling `data_lifecycle`/`LegalHoldGuardPort` DI-DROP (modul belum ada di base — purge tanpa gerbang legal-hold), dan wiring preset `news_portal_full_online_r2` DEFERRED (modul `news_portal` tidak disentuh).

  **Security hardening (DoD + security review atas port ini):**

  - **Rate-limit backstop pada beacon publik.** `POST /api/v1/analytics/collect` (unauth DB write) kini digerbangi rate limit per-IP (`checkRateLimit` yang sama dengan login/setup) SEBELUM tulis DB — mencegah flooding baris/pencemaran agregat oleh pemegang `tenantCode` publik. Kunci berbasis IP saja (tak membocorkan eksistensi tenant); `path` dibatasi panjang sebelum disimpan. Tunable `VISITOR_ANALYTICS_COLLECT_RATE_LIMIT_MAX`/`_WINDOW_SEC` (default 120/60s).
  - **Salt HMAC per-tenant (privacy-by-design).** `visitor_key_hash`/`ip_hash`/`user_agent_hash` kini di-key dengan salt deployment DAN `tenantId` (domain-separator `\0`), sehingga browser/IP/user-agent yang sama menghasilkan hash BERBEDA lintas tenant satu origin — menutup korelasi lintas-tenant di lapisan penyimpanan. Diterapkan mumpung belum ada data. `VISITOR_ANALYTICS_HASH_SALT` kini wajib ≥ 16 karakter saat modul aktif.
  - **raw_detail lewat ABAC, bukan hanya keanggotaan RBAC.** Field de-anonimisasi (`ipHash`/`ipAddress`/`userAgentHash`/`loginIdentifierSnapshot`) di `GET /sessions`, `GET /events`, dan `/admin/analytics` kini diputuskan lewat evaluator ABAC (`evaluateFieldAccessInTransaction`) sehingga kebijakan DSL `deny` atas `raw_detail.read` dihormati (deny-overrides-allow).
  - Log fragmen IP mentah pada header forwarded multi-nilai dihapus (`client-ip.ts` hanya mencatat `valueCount`, bukan nilai).

- bc7c4fa: Overhaul UI/UX seluruh surface pengguna: mobile-first responsif, animasi profesional CSS-murni, dan aksesibilitas (WCAG AA, `prefers-reduced-motion`, skip-link, target sentuh ≥44px). Semua di dalam jaminan CSP single-owner "zero third-party origin di LAN/offline" — tanpa font CDN/library eksternal; animasi = keyframes/transition CSS; styling di-serve same-origin (bundle Astro atau `public/css/*.css`), tidak ada `<style>`/`<script>` inline.

  - **Design system (fondasi)**: perkaya `tokens.css` (skala tipografi/spacing/radius/elevation, tint interaksi, token MOTION durasi+easing), tambah lapisan utility animasi reusable `motion.css` (fade/scale/slide/stagger/hover-lift/skeleton/spinner), dan shell layout admin+publik responsif dengan drawer mobile CSS-only.
  - **Login**: redesign form + auto tenant picker — 1 tenant disembunyikan/prefilled, 2–50 dropdown nama tenant, >50 fallback manual (anti mass-enumeration), fail-closed ke input manual saat pre-setup/DB error. Tanpa endpoint publik baru; kontrak DOM login dipertahankan.
  - **Admin**: 8 layar (`index`/`users`/`roles`/`offices`/`profiles`/`modules`/`abac-policies`/`email-templates`) mobile-first — tabel lebar → pola kartu/stack (`data-label` per sel), stat/quick-link beranimasi, hierarki visual & empty state konsisten. Selektor/hook E2E dipertahankan.
  - **Blog publik** (`/blog/{tenantCode}/...`): tipografi baca nyaman (measure ~65ch), kartu post grid→stack, media/tabel/kode responsif, animasi entrance halus; renderer `content_json` whitelist-based tidak dilonggarkan.

### Patch Changes

- 2a1e73e: Perbaiki logika fallback media type di `scripts/api-spec-check.ts` (CodeQL alert #140, `js/trivial-conditional`). `asRecord()` selalu mengembalikan objek non-null, sehingga operator `??` pada `asRecord(content["application/json"]) ?? Object.values(content)[0]` membuat cabang fallback jadi dead code — response error yang hanya memakai media type non-`application/json` salah dilaporkan tidak beresolusi ke envelope `ApiError`. Nullish-coalescing dipindahkan ke dalam `asRecord` agar fallback ke media type pertama benar-benar berjalan.
- 59757f1: chore: refresh the tracked graphify knowledge-graph output (`graphify-out/`)
  via `/graphify --update` after the project-state doc sync and agent-guide PDF
  removal — 6664 nodes / 19913 edges / 330 communities. Artifact-only; no runtime
  behavior change.
- 4905024: Login card entrance is now transform-only (`@keyframes auth-card-rise`,
  `translateY`) instead of the shared `.fade-in-up` utility that fades from
  `opacity: 0`. Fading the whole card — including its text — from transparent can
  let an axe-core contrast scan read semi-transparent text as a contrast
  violation if it scans mid-animation; a transform-only entrance keeps the text
  fully opaque throughout. A local `prefers-reduced-motion` guard neutralises it
  (motion.css's global reduced-motion block only targets its utility classes).
  CSS/markup only — the DOM contract and login logic are unchanged. Documented as
  the canonical rule in doc 14 §Motion / §Auth screen.
- 4c42029: feat(tooling): port `memory:docs:sync` from awcms-mini — snapshot the
  out-of-repo Claude Code agent memory into a committed `docs/awcms/agent-memory.md`
  so it survives clones/device moves (`sync`/`restore`/`check`). Adapts the doc
  path, header, password-placeholder redaction, and excludes the device-specific
  local-Postgres memory. check:docs exempts the generated mirror; prettier ignores
  it. Dev-tooling only — no runtime behavior change.
- d5ec206: chore: track the graphify knowledge-graph output (`graphify-out/`) so the repo
  graph is viewable from a clone. Regenerable cache and machine/user-specific path
  markers stay gitignored; the artifacts are excluded from prettier.

## 6.0.0

### Major Changes

- 0f39650: refactor(module-composition)!: hapus penuh jalur aplikasi-turunan (ADR-0034 §3, Fase 2)

  Menghapus permukaan yang khusus jalur aplikasi-turunan sesuai keputusan ADR-0034 §3 (awcms = template dipakai-langsung, tidak ada repo derivatif): seam `src/modules/application-registry.ts`, gerbang `bun run extension:check` (`scripts/extension-check.ts`, dari script `check` + ci.yml), konsep migration namespace turunan 900-999, dan tipe komposisi `ApplicationModuleRegistry`/`ModuleMigrationNamespace`.

  `src/modules/module-management/domain/module-composition.ts` kini memvalidasi satu registry base (`validateComposedModuleRegistry(registry)`/`composeModuleRegistry(registry)`/`buildComposedModuleInventory(registry)` menerima `readonly ModuleDescriptor[]`, bukan `{ base, application }`); check turunan-only (`prohibited_base_override`, `invalid_module_type`, `migration_namespace_overlap`) dan `mergeModuleRegistries` dihapus. Check base-load-bearing (DAG, duplicate module key, capability binding, deployment profile, navigation, job descriptor) dipertahankan. `MODULE_CONTRACT_VERSION` naik `1.3.0` → `2.0.0` (MAJOR: tipe diekspor dihapus); manifest keluarga disesuaikan.

  Fixture `tests/fixtures/derived-application-example/` direlokasi jadi test-support non-derived `tests/fixtures/example-domain-modules/` (mengekspor `exampleDomainModules`) — cakupan test #178/#180/#181/#182 dipertahankan setara. Gate `modules:compose:check` + `modules:composition:inventory:check` tetap ada (validasi registry base); `docs/awcms/module-composition-inventory.json` diregenerasi. Tanpa migration.

### Minor Changes

- f7d15bf: Dynamic ABAC policy evaluator (Issue #179, epic #177) — the stored
  `awcms_abac_policies` rows are now CONSUMED at the `authorizeInTransaction`
  chokepoint (default-deny), instead of authorization resting on RBAC + built-in
  guards alone. Ported from awcms-mini (ADR-0033).

  - **Bounded condition DSL (`domain/abac-policy.ts`).** `conditions` is a
    versioned jsonb AST (`sql/031` adds `dsl_version`/`conditions`/`priority` +
    nullable applicability columns): `allOf`/`anyOf`/`not` composition and
    `{attr, op, value|valueAttr}` leaves over a closed, server-side attribute
    allow-list (`subject.*` from the authenticated context — never the request
    body; `resource.*` from the endpoint-populated verified resource; `action`;
    `env.*` server-derived, `env.ipTrusted` fail-closed `false`) and a fixed
    operator set (`eq/ne/in/nin/lt/lte/gt/gte/exists`). No `eval`, no `new
Function`, no dynamic import, no templated SQL. The parser/validator is
    fail-closed and allow-list membership is **own-property only**
    (`hasOwnProperty`) so prototype-chain keys (`__proto__`/`constructor`/…)
    cannot slip past the unknown-attribute check (fail-OPEN closed at both the
    authoring validator and the eval-time backstop).
  - **Pure evaluator (`domain/abac-evaluator.ts`) + precedence.**
    `evaluateAccess` gains an optional 5th param `abac?: { policies, env }` (after
    `businessScopeFacts`); omitted/empty = ABAC no-op, so every pre-existing ≤4-arg
    call site is behavior-identical. Precedence after the built-in guards
    (tenant isolation, self-approval, force-decision, business-scope #180): explicit
    DENY wins (and an invalid/error policy fails closed) BEFORE the RBAC check; the
    RBAC permission is still required (an allow-policy never creates one); applicable
    ALLOW policies act as a constraint (≥1 must be satisfied). The #181 SoD
    high-risk guard remains additive after the decision.
  - **Tenant-keyed cache (`application/policy-cache.ts`)** compiled once per tenant,
    invalidated deterministically after commit by EVERY policy mutation — both the
    new DSL surface AND the pre-existing flat `/api/v1/abac/policies` CRUD (#171),
    which now also invalidates so it can never bypass the evaluator. Per-process
    invalidation is a documented limitation.
  - **Two surfaces, one table — but the evaluator consumes ONLY DSL-managed
    policies.** A new `is_dsl_managed` discriminator (`sql/031`, default `false`)
    separates the two authoring surfaces: the flat #171 CRUD (which can set neither
    applicability nor a condition) leaves rows `is_dsl_managed = false`, and the
    cache loads ONLY `is_active AND is_dsl_managed` rows — so a flat row is NEVER
    evaluated and stays inert (its exact pre-#179 behavior). This closes a
    full-tenant lockout: a flat `deny` used to present as a wildcard, always-true
    DENY that bricked every request (including the operator's own
    `access_control.configure` — no in-band recovery); the migration is now
    deploy-safe (a pre-existing inert flat `deny` is not activated on migrate).
    Only the DSL surface sets `is_dsl_managed = true` (INSERT + UPDATE).
    Defense-in-depth: the DSL validator additionally REJECTS an unscoped +
    unconditional (`{allOf:[]}`) deny. See ADR-0033 §3.
  - **Admin API.** New `GET/POST /api/v1/access/policies`,
    `GET/PUT /api/v1/access/policies/{id}`,
    `POST /api/v1/access/policies/{id}/{enable,disable}` (guarded
    `identity_access.abac_policies.{read,configure}`, audited, only valid DSL is
    stored), `POST /api/v1/access/policies/simulate` (read-only, guarded `.analyze`,
    audited without a decision-log write), and `POST /api/v1/access/evaluate`.
    Permissions seeded in `sql/032`.
  - **Simulation foreign-subject authority gate.** Simulating a DIFFERENT existing
    tenant user resolves that user's real grants — an enumeration oracle — so it
    additionally requires `identity_access.access_control.read` (AWCMS has no
    `user_management` module; reading a user record is guarded by
    `access_control.read`); the probed subject id is recorded in the audit event.
  - **Decision log** records policy code + `dsl_version` + a static reason, never
    raw attribute values. Five illustrative ERP example policies ship in
    `fixtures/abac-example-policies.json` (not seeded into the base).

- 9db1da6: Implement audit log retention — `AUDIT_LOG_RETENTION_DAYS` is no longer a
  silent no-op (Issue #146).

  The variable was documented in `.env.example`, validated as an integer >= 1 by
  `scripts/validate-env.ts`, and described in doc 18 as being "dipakai job purge
  audit log". No such job existed. An operator who set it got unbounded growth of
  `awcms_audit_events` plus false confidence — worse than having no knob at all.
  Login now writes audit events without authentication (PR #157), so the table
  grows from unauthenticated traffic too.

  New `bun run logs:audit:purge` (`scripts/audit-log-purge.ts` +
  `src/modules/logging/application/audit-purge.ts`, ported from awcms-mini):

  - Deletes `awcms_audit_events` rows past the retention cutoff for every active
    tenant, in bounded batches (`DELETE ... LIMIT 5000`, oldest first) so a large
    backlog never holds one transaction open or locks the table unpredictably.
  - **Self-auditing**: each non-empty batch records its own purge as a new audit
    event in the same transaction (counts and cutoff only) — the table can never
    be emptied to "no evidence a purge happened".
  - Retention resolves as `--retention-days=<n>` > `AUDIT_LOG_RETENTION_DAYS` >
    730 days (2 years, the midpoint of doc 04's "1-5 tahun" range).
  - `--dry-run` counts what would be purged without deleting anything, sharing
    the cutoff computation with the real path so the preview cannot drift.
  - Runs through the shared job runner: advisory lock (no two concurrent runs on
    the same backlog), timeout, correlation id threaded into each purge event,
    structured telemetry, and `status: "partial"` when a tenant's backlog was not
    fully drained.
  - Registered as a `logging` module job descriptor; recommended daily, off-peak.

  Scope: `awcms_audit_events` only. `awcms_abac_decision_logs` (~8.6M rows/day at
  100 req/s) is deliberately untouched — it needs its own retention decision, and
  quietly bundling a delete policy for it here would be the wrong way to make it.

  Unlike mini's version, `purgeExpiredAuditEvents` takes no `LegalHoldGuardPort`:
  this base has no `data_lifecycle` module or legal-hold registry, and a guard
  with nothing behind it would always answer "not held" — a fake gate is worse
  than an honest absence. When a legal-hold registry lands, this function is the
  enforcement point and the parameter should be required, not optional.

- 9af1789: Deterministic build-time module composition seam for derived ERP applications
  (Issue #178, epic #177, ADR-0025 — implementing the design in ADR-0014). A
  derived repository can now contribute its own domain modules by editing only
  `src/modules/application-registry.ts` (default `undefined` in the base), without
  ever touching `src/modules/index.ts`. The base's effective `listModules()`
  registry is byte-identical (same order + object identity) to before this change.

  - `src/modules/index.ts` refactored to `baseModules` + `listBaseModules()` +
    `modules = mergeModuleRegistries(baseModules, applicationModuleRegistry)`;
    `listModules()`/`getModuleByKey()` behavior unchanged and the array reference
    stays stable (`descriptor-sync.ts` identity check preserved).
  - `src/modules/module-management/domain/module-composition.ts` — the pure
    validation engine (`composeModuleRegistry`/`validateComposedModuleRegistry`/
    `buildComposedModuleInventory`), reusing the existing DAG validator
    (`_shared/module-dependency-graph.ts`) and job validator
    (`module-management/domain/job-registry.ts`). Rejects: duplicate module key,
    prohibited base override, `type: base/system` from an application module,
    missing/cyclic dependency, capability provider conflict/missing,
    migration-namespace overlap (base reserves `1-899`), deployment-profile
    incompatibility, navigation path conflict, and invalid job descriptor.
  - `_shared/module-contract.ts` extended additively (`MODULE_CONTRACT_VERSION`
    1.1.0 → 1.2.0): `ModuleCapabilityContract`, `ModuleDescriptor.capabilities`,
    `ModuleCompatibilityContract.deploymentProfiles`, `ModuleMigrationNamespace`,
    and `ApplicationModuleRegistry`.
  - New gates wired into `bun run check` AND `.github/workflows/ci.yml`:
    `modules:compose:check`, `modules:composition:inventory:generate`/`:check`
    (deterministic `docs/awcms/module-composition-inventory.json`, no wall-clock),
    and `extension:check` (extension-seam health).

  No SQL migration, no API/event change. Full derived-application compatibility
  manifest validation (SemVer/checksum, ADR-0015) remains scheduled for Issue
  #183; `extension:check` currently validates the composition seam only.

- cad4ccb: Business-scope hierarchy generic authorization layer (Issue #180, epic #177
  Wave 2). Ports the generic business-scope FOUNDATION from awcms-mini (SoD
  enforcement #181 and the organization-structure domain module are deliberately
  excluded, with clean seams).

  - **Schema** (`sql/027` + seed `sql/028`) — two tenant-scoped, RLS
    `ENABLE`+`FORCE` tables: `awcms_business_scope_assignments` (subject→scope
    grant with effective dating, temporary expiry, revocation) and its
    append-only `awcms_business_scope_assignment_events` lifecycle history.
    Subject/role/actor FKs are COMPOSITE `(tenant_id, …)` (with new
    `UNIQUE (tenant_id, id)` on `awcms_tenant_users`/`awcms_roles`) so a
    cross-tenant subject/role cannot be referenced even though PostgreSQL RI
    checks bypass RLS (GHSA-r7cx-c4jh-cvvw / sql/020).
  - **Capability port** — `BusinessScopeHierarchyPort` (`_shared/ports/`, ADR-0011):
    `scope_type`/`scope_id` are GENERIC references; validity/ancestry come from a
    resolver a DERIVED app provides. The base ships a default NO-OP resolver
    (`resolved: false` for every scope type), so a pure-base deployment fails
    closed (assignment create denies `scope_unresolved`; scope-gated high-risk
    actions deny). `identity_access` declares `capabilities.consumes`
    (`business_scope_hierarchy`, optional); the in-repo fixture derived module
    provides a working dummy resolver.
  - **`evaluateAccess` integration** — new optional `businessScopeFacts` parameter
    (fully backward-compatible) with exact/descendant/ancestor/tenant-wide
    coverage. Unknown/unresolved/stale scope → default-DENY for high-risk actions
    (`resolved: false` is never treated as "no restriction"). Revocation/expiry
    takes effect immediately at the next decision (effective dating is the
    authoritative gate, not `status`).
  - **API** — `GET`/`POST /api/v1/identity/business-scope/assignments` and
    `POST …/{id}/revoke` (create/revoke high-risk, `Idempotency-Key` required,
    self-grant denied, audited). New permissions
    `identity_access.business_scope_assignments.{read,create,revoke}`.
  - **Job** — `identity-access:business-scope:expiry` transitions elapsed
    assignments to `expired` (append-only events + aggregate audit per tenant).
  - Docs: ADR-0030, ERD/data-dictionary, threat model (privilege expansion,
    stale cache, hierarchy cycle, scope spoofing), identity-access README, and
    derived-application guide (how a derived app provides the hierarchy resolver).

- 296b7e3: Narrow the `awcms_app` runtime DB role's blanket DML on the global, RLS-free
  tables (Issue #160, `sql/021_awcms_db_role_grants_narrow.sql`). Closes the
  residual documented by `sql/019`: `awcms_app` can no longer `DELETE`
  `awcms_tenants`, `DELETE` `awcms_schema_migrations`, or write `awcms_permissions`
  (now read-only), and loses `DELETE` on `awcms_setup_state`. The
  `INSERT`/`UPDATE`/`SELECT` that real code paths use (setup-wizard fallback,
  tenant-settings screen, module-registry sync) are kept.

  Deployment-affecting: apply the new migration with the migration-owner
  connection string, as usual. The worker/setup role split (mini's migration 045)
  remains deferred.

  Adds a `security:readiness` grant check ("Runtime role table grants match
  least-privilege matrix") that fails when `awcms_app` is over-granted on a global
  table or, critically, when a tenant-scoped table is RLS-forced but ungranted
  (`permission denied` at runtime) — the executing-role-bound `ALTER DEFAULT
PRIVILEGES` gap that the RLS-flag check cannot see.

- 9db1da6: Tambah role runtime least-privilege `awcms_app` (`sql/019_awcms_db_role_separation.sql`) — RLS akhirnya jadi batas keamanan nyata, bukan deklarasi kosong.

  Migration 017 (PR #139) menutup bypass **pemilik tabel** lewat `FORCE ROW LEVEL SECURITY` di 23 tabel, tapi PostgreSQL melewati RLS **tanpa syarat** untuk SUPERUSER/BYPASSRLS — dan `DATABASE_URL` selama ini adalah role migration owner (biasanya superuser). Artinya setiap policy `awcms_*_tenant_isolation` di repo ini masih inert saat runtime: isolasi tenant sepenuhnya bergantung pada klausa `WHERE tenant_id` di aplikasi. Migration 019 memport bagian ke-2 migration 013 (`enforce_rls_least_privilege`) dari awcms-mini:

  - `CREATE ROLE awcms_app NOLOGIN` (idempoten, tanpa password — password itu secret, diaktifkan operator lewat `ALTER ROLE awcms_app LOGIN PASSWORD '<secret>'`), bukan superuser, bukan BYPASSRLS, bukan pemilik tabel, hanya DML.
  - Default GUC fail-closed `app.current_tenant_id = '00000000-0000-0000-0000-000000000000'`: query yang menyentuh tabel RLS di luar `withTenant()` mendapat **nol baris**, bukan error `unrecognized configuration parameter` dan bukan data tenant lain.
  - `GRANT` minimal + `ALTER DEFAULT PRIVILEGES` supaya tabel baru tidak perlu boilerplate GRANT.

  **Aksi operator (deployment-affecting):** setelah `bun run db:migrate`, aktifkan LOGIN + password untuk `awcms_app` lalu arahkan `DATABASE_URL` runtime ke role itu, dan jalankan migrasi berikutnya dengan `DATABASE_URL` ditimpa ke connection string owner. Tanpa langkah ini aplikasi tetap jalan seperti sebelumnya (sebagai owner) — tapi tanpa lapisan RLS. Lihat doc 18 §Model role database.

  Sekaligus memperbaiki artefak fiktif yang menegaskan properti keamanan yang tidak dimiliki sistem (Issue #155): `client.ts` merujuk sebuah migration `045_awcms_db_role_separation` yang tidak pernah ada di repo ini, header `sql/014` mengklaim konvensi `FORCE` "sejak migration 002" (tidak benar sampai 017), `reporting/README.md` menyebut header `X-AWCMS-Mini-Tenant-ID` (sebenarnya `X-AWCMS-Tenant-ID`), `_shared/idempotency.ts` menyebut migration 012 (di sini 009), serta doc 13/18 yang mendaftarkan migration fiktif. `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` kini didokumentasikan jujur sebagai seam pool — **bukan** role `awcms_worker`/`awcms_setup` (itu migration 045 di awcms-mini, belum diport); operator yang mengikuti klaim lama akan mendapat `permission denied` di setiap job.

- 988aaae: Add the domain-event-runtime module: a transactional, versioned domain-event
  outbox and dispatcher ported from awcms-mini. Provider-neutral, generic,
  multi-consumer infrastructure — one published event fans out to many
  registered consumers with explicit per-aggregate/order-key ordering,
  exponential backoff, dead-letter handling, and operator-safe replay.

  - New migration `009_awcms_domain_event_runtime_schema.sql`: adds
    `awcms_domain_events` (append-only outbox), `awcms_domain_event_deliveries`
    (per-(event, consumer) retry/DLQ state), `awcms_domain_event_consumer_effects`
    (generic per-consumer idempotency marker),
    `awcms_domain_event_consumer_state` (pause/resume),
    `awcms_domain_event_replays` (append-only replay audit trail), and
    `awcms_domain_event_activity_daily` (reference read-model rollup). Also
    introduces the generic `awcms_idempotency_keys` store (first high-risk
    mutation to need `Idempotency-Key`). All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE.
  - New REST endpoints under `/api/v1/domain-events` (events, deliveries,
    consumers, plus reason-required audited replay/pause/resume), all guarded
    by default-deny ABAC; replay is `Idempotency-Key`-guarded.
  - New AsyncAPI channel `awcms.domain-event-runtime.sample.recorded` with
    publish/subscribe operations.
  - New worker job `bun run domain-events:dispatch` (built on the shared job
    runner), safe in offline/LAN deployments.
  - Ships one self-contained reference event type and two representative
    consumers (a cross-module audit projector and a self-contained read-model
    activity-rollup projection). Registered in `src/modules/index.ts`.

- 66ee934: Add the email module: a reusable, provider-neutral transactional email
  service ported from awcms-mini (epic #492). Generic infrastructure —
  analogous to `sync_storage`'s object-storage port — for password reset,
  system announcements, and workflow notifications; Mailketing is one adapter,
  not a domain-specific feature.

  - New migration `014_awcms_email_schema.sql`: adds `awcms_email_templates`
    (per-locale `jsonb` bodies, soft-delete/restore), `awcms_email_messages`
    (outbox delivery queue, one row per recipient), `awcms_email_delivery_attempts`,
    and `awcms_email_suppression_list`. All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE and FK indexes. Seeds the
    `email.{template,message,suppression,notification,announcement}.*` ABAC
    permissions.
  - New `EmailProvider` port with a real Mailketing adapter and a safe `log`
    adapter, resolved at one edge; provider calls happen strictly outside any
    DB transaction (ADR-0006), via an outbox + claim/send/finalize dispatcher
    (`bun run email:dispatch`) with retry/backoff, circuit breaker, and
    dispatch-time suppression re-check.
  - New REST endpoints under `/api/v1/email`: template CRUD + restore + preview
    (`/templates`), bulk announcement/notification enqueue + dry-run preview
    (`/announcements`, two-tier ABAC, `Idempotency-Key`-guarded), delivery-queue
    diagnostics + cancel (`/messages`), and suppression-list CRUD
    (`/suppressions`). All guarded by default-deny ABAC and audited.
  - Template management with per-category variable allowlists (fail-closed),
    i18n locale variants, and XSS-safe rendering (allowlist filtering +
    HTML-escaping).
  - New AsyncAPI channels `awcms.email.message.{queued,sent,failed,suppressed,cancelled}`
    (contract-only; the structured logger is the producer).
  - New worker jobs `bun run email:dispatch`, `bun run email:provider:health`,
    and `bun run email:templates:seed-defaults`. Registered in
    `src/modules/index.ts`.

  The password-reset flow, the `reporting` email-health endpoint, and the
  `security:readiness` provider-config gate from awcms-mini are intentionally
  out of scope for this port (their host modules/scripts do not exist in this
  repo yet).

- 87b0e38: Enforce two tenant-isolation controls that were declared but never actually
  applied. Both are ports of code already proven in awcms-mini.

  **Disabling a module now blocks its endpoints.** `authorizeInTransaction` did
  not check tenant module status, so `POST /api/v1/tenant/modules/{key}/disable`
  was cosmetic: the navigation hid the module and the audit event was recorded,
  but any actor still holding the module's permissions could call its API
  directly and keep working. `resolveModuleEnabled` is now checked before
  permissions are even looked up, so a disabled module is refused with
  `403 MODULE_DISABLED` regardless of what the actor was granted, and the denial
  is recorded to the decision log as `matchedPolicy: "module_disabled"`. This
  covers all 70 guarded endpoints at once. `module_management` is `isCore` and
  cannot be disabled, so a tenant can never lock itself out of re-enabling.

  **New migration `017_awcms_enforce_rls_force.sql`** adds `FORCE ROW LEVEL
SECURITY` to the 23 tenant-scoped tables that only `ENABLE`d it (migrations
  002-008, 010-012), including `awcms_identities`, `awcms_sessions`,
  `awcms_access_assignments` and `awcms_profiles`. PostgreSQL bypasses RLS for a
  table's owner unless `FORCE`, and the app connects as the migration owner via
  `DATABASE_URL` — so those tenant-isolation policies were never evaluated, and
  isolation rested entirely on application-level `WHERE tenant_id` clauses with
  RLS as a non-functioning backstop. Every one of the 23 tables already had
  `tenant_id` and a policy, so this only starts enforcing what was declared; all
  access paths already go through `withTenant()`.

  This closes the table-owner bypass only. A SUPERUSER/BYPASSRLS connection still
  bypasses RLS regardless of `FORCE`; closing that needs the least-privilege
  `awcms_app` role, which is deployment-affecting and tracked separately.

- d58cd7b: feat(foundation): family compatibility manifest + CI conformance gate against the AWCMS-Mini standard (Issue #183)

  Adds `awcms-family-compatibility.yaml` (machine-readable, versioned, schema-validated) declaring AWCMS's conformance to the AWCMS-Mini family standard: family/module/capability/API/tenant-context/audit/idempotency/migration contract versions, validated stack versions (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL), and an explicit intentional-divergence allow-list (reason/owner/reviewDate/ADR). New `bun run family:conformance:check` gate (wired into `bun run check` + ci.yml, parity-tested) cross-references every declared version against the real source and fails on drift or an unreviewed/unbacked divergence, emitting a secret-free pass/fail evidence report. Semantic, mutation-provable contract tests pin the reusable controls (tenant-context fail-closed under FORCE RLS, response envelope, redaction, idempotency, migration immutability/checksum, module composition) so any weakening of default-deny/RLS/redaction/audit/idempotency turns conformance RED. No migration (tooling/docs only); ADR-0032; `docs/awcms/family-compatibility.md`.

- 13813bb: Audit trail dan pengerasan jalur login (Issue #145, #147).

  **Audit (#145)** — `POST /api/v1/auth/login` sebelumnya tidak menulis satu baris audit pun, sukses maupun gagal, padahal infra `recordAuditEvent` sudah dipakai 20+ endpoint lain dan `awcms_abac_decision_logs` tidak menutupi login (guard tak pernah jalan di jalur pre-auth). Post-incident, `awcms_audit_events` kosong dan `awcms_sessions` tidak menyimpan IP/UA — lebih buruk, reset `failed_login_count = 0` saat login sukses menghapus jejak brute-force yang mendahuluinya. Login kini menulis `login_succeeded`/`login_failed`, plus recorder out-of-band untuk kasus transaksi rollback (baris audit di dalamnya ikut hilang).

  Atribut audit dibatasi ke `method`/`reason`/`ipHash`/`userAgent` lewat `src/lib/security/client-fingerprint.ts` (port dari awcms-mini): `ipHash` adalah HMAC-SHA256 ber-key — stabil untuk mengelompokkan percobaan per sumber, tapi tidak reversible (sha256 tanpa key atas ruang IPv4 2^32 habis dibrute dalam hitungan detik). IP mentah tidak bisa dipersist (`redactSensitiveAttributes` menjadikannya `[REDACTED]`), dan `loginIdentifier` sengaja tidak diaudit: umumnya email/PII, dan menyimpan string dari penyerang pada percobaan gagal justru menciptakan kebocoran enumerasi.

  **Pengerasan (#147)** — empat lubang yang diwarisi dari awcms-mini:

  1. **Oracle timing** — identifier tak dikenal melewati argon2id (~0 ms) sementara yang dikenal membayar m=64MB (~75 ms), sehingga penyerang bisa memetakan akun mana yang eksis tanpa pernah menyentuh `failed_login_count` (lockout tak pernah menyala). Kini identifier tak dikenal tetap diverifikasi melawan dummy argon2id hash konstan.
  2. **Oracle pesan** — `locked` menjawab `"Account is temporarily locked."`, yang hanya mungkin muncul bila identifier eksis. Kini identik dengan `invalid_credentials`. `tenant_inactive` tetap dibedakan (tenant disebut caller di header; tidak membocorkan identity).
  3. **`X-Forwarded-For` dipercaya tanpa syarat** sebagai kunci rate limit. Pada topologi terekspos-langsung yang justru didokumentasikan repo ini, header itu dikendalikan penyerang: kirim nilai acak per request → bucket baru tiap kali → limit 20/60 detik tak pernah menyala. Kini hanya dipercaya bila `TRUSTED_PROXY_ENABLED=true` (default `false`).
  4. **Ambang env NaN mematikan kontrol secara diam-diam** — `Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5)` dengan nilai `5x` menghasilkan `NaN`, `failedLoginCount >= NaN` selalu `false`, lockout mati total tanpa peringatan. Helper `parsePositiveIntEnv` kini menolak non-finite/non-integer/`<= 0`, jatuh ke default, dan menulis `log("warning", ...)`.

  **Env baru (opsional, keduanya aman secara default):** `TRUSTED_PROXY_ENABLED` (default `false`) dan `AUTH_IP_HASH_SECRET` (meng-key HMAC `ipHash`; bila kosong/placeholder dipakai kunci acak per proses — tetap non-reversible, tapi `ipHash` tidak sebanding lintas restart/instance, dan satu warning ditulis).

  **Wajib saat upgrade:** deployment produksi harus menyetel `TRUSTED_PROXY_ENABLED`
  secara eksplisit — `bun scripts/validate-env.ts` kini menolak produksi yang
  membiarkannya kosong. Tidak ada default yang aman untuk dua topologi sekaligus:
  pada profil production repo ini (nginx TLS-termination) `false` membuat setiap
  request terlihat berasal dari IP nginx, sehingga bucket rate limit login runtuh
  jadi satu per tenant dan 20 login gagal per menit cukup untuk mengunci seluruh
  pengguna tenant tersebut; sebaliknya `true` pada app yang terekspos langsung
  membuat rate limit bisa dilucuti dengan merotasi header `X-Forwarded-For`.

- c9cef95: MFA TOTP, recovery codes, and step-up authentication (Issue #184, epic #177).
  Ported and adapted from awcms-mini. Adds encrypted-at-rest TOTP factors
  (AES-256-GCM, `AUTH_MFA_SECRET_ENCRYPTION_KEY`, no default key), single-use
  hashed recovery codes shown once, and a two-step login challenge with no
  account-enumeration oracle (the challenge branch is reached only after a valid
  password). Replay is prevented by a strictly-monotonic `last_used_step` advanced
  with a concurrency-safe compare-and-swap; recovery codes are consumed with the
  same CAS.

  Tenant enforcement policy (`optional` / `required_for_privileged` /
  `required_for_all`) is genuinely enforced at login: a valid-password identity
  that a policy requires MFA for but has no factor is issued an enrollment-scoped
  grant (never a full session) that authorizes only the enroll endpoints, then
  completes to an `aal2` session on enrollment — fail-closed but self-recoverable
  (no admin lockout).

  New: session assurance levels (`aal1`/`aal2`) on `awcms_sessions`, a
  server-controlled step-up gate (`requireStepUp`, `AUTH_MFA_STEPUP_TTL_SEC`) now
  wired to every high-risk MFA action (self-service disable, recovery-code
  regenerate, admin reset, and policy change); session rotation on an aal1→aal2
  rise (anti-fixation); a per-factor cumulative failed-verify lockout
  (`AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`) independent of source
  IP and challenge rotation; and an admin reset workflow gated on
  `identity_access.mfa_admin.reset` with a mandatory reason, `critical` audit, and
  no self-reset.

  New endpoints under `/api/v1/auth/mfa/*` (status, enroll start/verify, TOTP
  verify — public login-challenge completion, disable, recovery-codes regenerate,
  step-up, admin reset, policy get/set). Migration `sql/024` adds four
  tenant-scoped RLS-FORCE tables (factors, recovery codes, challenges, tenant
  policy) plus session-assurance columns and seeds the MFA admin permissions;
  recovery-code uniqueness is scoped per tenant. `config:validate` and
  `security:readiness` now require a valid 32-byte encryption key when
  `AUTH_MFA_ENABLED=true`. Existing login hardening is preserved unchanged.
  OIDC/SSO (#185) and Turnstile (#186) are intentionally out of scope.

- 9af1789: Modular OpenAPI contract per module + deterministic bundler and API docs
  (Issue #182, epic #177, ADR-0026).

  The monolithic `openapi/awcms-public-api.openapi.yaml` is split into source
  fragments — a root fragment (`openapi/awcms-public-api.src.yaml`: info/servers/
  tags/security + shared securitySchemes/parameters/responses + the `ApiError`/
  `ApiMeta` shared schemas) and one `openapi/modules/<module>.openapi.yaml` per
  base module (plus a `foundation` fragment for `/api/v1/health` and
  `/api/v1/database/pool`). Each module points at its fragment via
  `ModuleDescriptor.api.openApiPath`. The published bundle
  `openapi/awcms-public-api.openapi.yaml` is now GENERATED by `bun run openapi:bundle`
  (deterministic/idempotent — sorted keys, no timestamps) and stays
  CONTRACT-EQUIVALENT to the pre-migration monolith; no URL, security, request/
  response, or schema changed. The only documented, additive difference is the
  now-declared `Domain Event Runtime` tag (previously used by
  `/api/v1/domain-events/*` operations but never declared).

  New scripts wired into `bun run check` and CI: `openapi:bundle`,
  `api:docs:generate`/`api:docs:check` (generates the readable
  `docs/awcms/api-reference.md` from the bundle + AsyncAPI, with a read-only
  freshness gate), and an extended `api:spec:check` that now also enforces bundle
  freshness (committed bundle == freshly generated from fragments), the standard
  `ApiError` error envelope on every 4xx/5xx response, and that every
  `ALLOWED_PUBLIC_OPERATIONS` entry is actually used — on top of the existing
  route↔contract parity, unique `operationId`, explicit security, and
  path-parameter checks. A derived application can contribute its own module
  fragment through the `buildBundledDocument({ extraFragmentFiles })` composition
  seam (#178) without editing any base fragment; a fragment redefining a base
  path/operation/schema is rejected with `BundleConflictError`.

  No runtime behavior, database schema, or public endpoint changed; the API
  contract version (`info.version`, ADR-0008) is unchanged.

- fb602fb: Add the module-management module: a database-backed, tenant-aware module
  registry ported from awcms-mini. Provides descriptor sync into the DB
  registry, per-tenant module enable/disable with dependency validation,
  non-secret module settings (secret-shaped key/value rejection), read-only
  permission sync/status, an admin navigation registry, a documentation-only
  job/command registry, and passive/explicit module health-readiness signals.

  - New migration `008_awcms_module_management_schema.sql`: extends
    `awcms_modules` and adds `awcms_tenant_modules`, `awcms_module_dependencies`,
    `awcms_module_settings`, `awcms_module_navigation`, `awcms_module_jobs`, and
    `awcms_module_health_checks`, plus the `module_management` permission catalog.
    Tenant-scoped tables have RLS tenant-isolation policies.
  - New REST endpoints under `/api/v1/modules`, `/api/v1/tenant/modules`, and
    `/api/v1/access/modules`, all guarded by default-deny ABAC and audited.
  - Extends `_shared/redaction.ts` with `findSensitiveKeys` and
    `findSecretShapedValues` for module settings validation.

- b11cfca: Add tenant-aware OIDC/SSO with account linking fail-closed and break-glass (Issue #185, epic #177) — ported from awcms-mini (#590/#591) and hardened. Generic, provider-agnostic OIDC (Google/Entra/Keycloak) that mints an awcms opaque session, never uses the ID token as the app session, and keeps authorization on RBAC/ABAC/RLS. ADR-0028, doc `docs/awcms/oidc-sso.md`, migrations `sql/025` + `sql/026`.

  - **Schema (`sql/025`, `sql/026`)** — four tenant-scoped RLS `FORCE` tables: `awcms_auth_providers` (provider config; client secret AES-256-GCM ciphertext OR env-var reference, never plaintext), `awcms_tenant_auth_policies` (password/SSO/JIT/break-glass, one row per tenant), `awcms_external_identities` (linking keyed `(tenant_id, provider_id, issuer, subject)` — immutable `sub`, never email; tenant-bound composite FK), `awcms_oidc_auth_requests` (ephemeral: `state_hash` bearer, `nonce` + PKCE `code_verifier` plaintext single-use, validated `redirect_after`). Permission seed for `sso_providers.{read,create,update,delete}` and `sso_policy.{read,update}`.
  - **SSRF guard (`lib/auth/ssrf-guard.ts`, new)** — the issue's top risk: all discovery/JWKS/token fetches are HTTPS-only, block private/loopback/link-local/ULA/CGNAT/metadata IPv4+IPv6 (including IPv4-mapped/NAT64), validate every resolved DNS address before connecting, follow redirects manually with per-hop re-validation, and enforce a bounded timeout + response-size cap. A reviewed loopback escape hatch (`AUTH_SSO_ALLOW_INSECURE_HOSTS`) exists only for a local fake IdP in tests and is rejected in production. This reverses mini's deliberate no-IP-block decision.
  - **Auth Code + PKCE + state + nonce** — `code_verifier` server-side single-use, `code_challenge` S256; `state` hashed, single-use (`FOR UPDATE` + CAS), tenant-bound; strict redirect-URI matching; sanitized same-origin post-login redirect (no open redirect).
  - **ID-token validation fail-closed** (`domain/oidc-policy.ts` + `lib/auth/jwt-verify.ts`) — algorithm allow-list `{RS256, ES256}` matched to key type (rejects `none` and alg-confusion), WebCrypto-native signature (no `jose` dependency added — Bun-only), issuer + audience + `azp` + expiry + `iat` + nonce.
  - **JWKS/discovery cache** — bounded TTL + negative-TTL + circuit breaker keyed `${tenantId}:${providerKey}`, all OUTSIDE any DB transaction.
  - **Account linking explicit + step-up** — `POST /api/v1/auth/sso/{providerKey}/link` and `/unlink` require a valid session AND `requireStepUp` (#184); identity is taken server-side from the stepped-up session. Never auto-links by email. Auto-link and JIT provisioning are default OFF; JIT provisions at minimum privilege (no roles).
  - **Break-glass** — `saveTenantAuthPolicy` refuses `sso_required=true` / `password_login_enabled=false` without a currently-eligible break-glass owner (`409 BREAK_GLASS_REQUIRED`); login-time `isPasswordLoginDisabledForIdentity` (gated by `isSsoEnabled`, run before the MFA branch) blocks non-break-glass password login; a provider outage never locks break-glass out (separate path).
  - **Routes** — public `GET /sso/{providerKey}/start` + `/callback` (added to the reviewed `ALLOWED_PUBLIC_OPERATIONS`), authenticated `/link` + `/unlink`, admin `GET/POST /auth/sso-providers`, `GET/PATCH/DELETE /auth/sso-providers/{id}`, `GET/PATCH /auth/sso-policy` — all guarded, audited (high severity), client secret never returned.
  - **Config/readiness** — new `AUTH_SSO_*` env vars; `config:validate` requires a 32-byte key when SSO is enabled and forbids the insecure-host escape hatch in production; `security:readiness` adds `checkSsoCredentialEncryptionKeyConfigured` (critical).
  - **Tests** — unit (JWT RS256/ES256 + alg-confusion/`none`, state/nonce/PKCE/redirect allow-list, claim mapping, SSRF IP ranges + oversized/redirect/timeout) and DB integration against a fake in-process OIDC provider (config → link → login → session; cross-tenant state substitution denied; account-link collision; JWKS rotation/cache; SSRF private/metadata issuer refused; break-glass save + IdP-outage; RLS FORCE cross-tenant under the non-superuser `awcms_app` role). Mutation-proven (dropping the issuer check turns a test RED). All test secrets/keys are generated at runtime.

- 15a3721: feat(redis): add optional Bun-native Redis readiness foundation (#197)

  Adds an opt-in, fail-open Redis capability for scalable AWCMS-derived applications without changing PostgreSQL as the authoritative transactional store. The additive foundation includes typed configuration, tenant-aware key namespacing, JSON cache-aside helpers with mandatory TTL, a credential-safe Redis health CLI, unit tests without a live Redis dependency, a hardened standalone Compose deployment, and operational/security guidance for LAN and Coolify deployments.

  Redis remains disabled by default. No session, audit, workflow, durable outbox, authorization boundary, or authoritative ERP/domain state is migrated to Redis, and no third-party runtime dependency is added.

- f69ad2c: Add the reporting module: management reporting views plus a module-contributed
  read-model projection mechanism, ported from awcms-mini.

  - Five generic live read-aggregation views under `/api/v1/reports/*` (tenant
    activity, access/audit summary, sync health, module usage, email queue
    health), each gated by `reporting.dashboard.read`. The access/audit view
    counts this repo's real cross-module audit trail (`awcms_audit_events`)
    rather than the mini base's `profile_audit_logs` proxy.
  - A module-contributed read-model projection extension: modules declare
    `reportingProjections` descriptors in their own `module.ts`, and reporting's
    engine maintains them via incremental cursor-table scans or a registered
    `domain_event_runtime` consumer, with idempotent crash-safe rebuild,
    live-computed freshness/staleness signals, on-demand source reconciliation,
    and scheduled CSV/JSON exports (manifest/checksum/expiry, secure
    tenant-scoped checksum-verified download). Three projections are registered
    (access-audit summary, module-activity summary, and an event-driven
    event-activity demonstration).
  - New migration `015_awcms_reporting_projections_schema.sql`: seven
    tenant-scoped tables (projection state/cursors/metrics, rebuild runs,
    reconciliation runs, scheduled exports, export runs), all with FORCE row
    level security tenant-isolation policies, indexed foreign keys, a partial
    unique index guaranteeing at most one running rebuild per (tenant,
    projection), `timestamptz`, and `bigint` counters. Migration
    `016_awcms_reporting_permissions.sql` seeds the `reporting.dashboard.read`,
    `reporting.projections.{read,rebuild,analyze}`, and
    `reporting.exports.{read,configure,export}` permissions.
  - New REST endpoints under `/api/v1/reports/projections` and
    `/api/v1/reports/exports` (list/detail/rebuild/cancel/reconcile, scheduled
    export create/disable/trigger, run history/download). Every mutation is
    ABAC-guarded, and rebuild/cancel/create/disable/trigger require an
    `Idempotency-Key` and write an audit event.
  - New scheduled worker scripts `reporting:projections:refresh` and
    `reporting:exports:dispatch` (pure PostgreSQL / local filesystem, safe in
    offline/LAN deployments) plus the pure-code
    `reporting:projections:registry:check` gate.
  - The `_shared/module-contract` gains the optional `reportingProjections`
    field and the `ProjectionDescriptor` type family (contract version bumped to
    `1.1.0`), the domain-event-runtime consumer registry gains the reporting
    event-activity projector consumer (the one deliberate
    `domain_event_runtime -> reporting` edge), and the identity-access
    `AccessAction` union gains `rebuild`/`analyze`/`export`.

- 9db1da6: Add `bun run security:readiness` — a go-live gate that catches inert RLS and
  RLS-bypassing DB roles (Issue #142), ported from awcms-mini and adapted to
  this base.

  Nothing in this repo detected RLS regressions. Migrations 002-008 and 010-012
  shipped 23 tenant-scoped tables with `ENABLE ROW LEVEL SECURITY` but no
  `FORCE`, which PostgreSQL ignores for the table owner — the role this app
  connects as. The isolation policies were never evaluated, and every check
  stayed green for the entire time (found by manual audit, fixed by `sql/017`).

  `scripts/security-readiness.ts` runs 13 named checks, each backed by a real
  signal (a DB query, a grep over tracked files, or a call into a real domain
  function — none hardcoded to pass). Any `critical` failure exits non-zero and
  blocks go-live; `warning`/`info` findings print without blocking. The two the
  issue exists for:

  - **RLS enabled AND forced on tenant-scoped tables** (critical) — requires
    `relforcerowsecurity`, not just `relrowsecurity`. Every `awcms_%` table not
    in a documented, per-table-justified RLS-free allowlist must have both, so a
    future migration reintroducing the bug fails without anyone remembering to
    register anything.
  - **App DB connection role does not bypass RLS** (critical) — `FORCE` still
    does nothing against `rolsuper`/`rolbypassrls`, so the app's own connection
    role is inspected.

  Also: no hardcoded secret, `.env` not tracked, argon2id hashing, login
  lockout, ABAC default-deny, audit table reachable, env config valid, sync HMAC
  secret rotated, login rate limiting, and security response headers. Items that
  genuinely cannot be automated from this repo (deployment/network/backup
  concerns, per-table grant matrices) are printed as documented out-of-scope
  entries with a reason rather than dropped.

  Not wired into `bun run check`: the DB-backed checks need a migrated database
  and `ci.yml` has no Postgres service. Run it against the target deployment,
  using the app's own `DATABASE_URL` — a privileged/superuser URL makes the
  result meaningless, which the role check reports outright.

- dd86ab6: Add segregation-of-duties (SoD) conflict detection and enforcement for ERP (Issue #181, epic #177 Wave 2 authorization), ported from awcms-mini (#746) on top of the #180 business-scope hierarchy.

  - **Contract:** additive `SoDRuleDescriptor` family + `ModuleDescriptor.sodRules` (`MODULE_CONTRACT_VERSION` 1.2.0 → 1.3.0). The base ships NO domain SoD rules; a derived application contributes them through the composition seam (the in-repo fixture carries ≥5 illustrative examples).
  - **Registry gate:** `bun run identity-access:sod-registry:check` validates the composed registry (owner match, unique ruleKey, ≥2 keys, valid enums, exception-policy consistency), wired into `bun run check` and CI — SoD registry drift makes CI red.
  - **Domain/application:** a pure conflict matcher (`sod-conflict-evaluation.ts`), assignment-time evaluation re-inserted at the #180 seam, action-time fail-closed enforcement wired into `authorizeInTransaction` for high-risk actions (deny-overrides-allow), an append-only decision log, and a scope-bound/time-bound/revocable/audited exception (override) flow that can never be self-approved.
  - **Schema:** `sql/029` (`awcms_sod_conflict_exceptions` + `awcms_sod_conflict_evaluations`, tenant-scoped RLS `ENABLE`+`FORCE`, composite `(tenant_id, …)` FKs) + `sql/030` permission seed. The scheduled expiry job now also expires elapsed approved exceptions.
  - **API:** six new endpoints under `/api/v1/identity/business-scope/` — `GET conflicts`, `GET`/`POST exceptions`, and `POST exceptions/{id}/approve|reject|revoke` (OpenAPI fragment + regenerated bundle/docs).

- 296b7e3: Sync HMAC: versioned signatures + inactive-by-default node registration (security advisory GHSA-c972-3q5p-g3h4, cross-tenant sync forgery).

  - **Signature v2 binds tenant + node.** New `computeSyncSignatureV2` /
    `verifySyncSignatureV2` sign `"v2:<tenantId>:<nodeCode>:<timestamp>:<body>"`,
    so a signature minted for one tenant no longer verifies when
    `X-AWCMS-Tenant-ID` is swapped to another tenant. Nodes send
    `X-AWCMS-Signature-Version: 2`. Timing-safe compare is preserved for both
    versions.
  - **Backward-compatible with an off-switch.** `verifySyncHeaders` verifies v2
    when the version header is `2`; requests without the header fall back to the
    legacy v1 scheme (`"<timestamp>.<body>"`) — which remains **cross-tenant
    forgeable** — only while the new env `SYNC_HMAC_ALLOW_LEGACY` is not `false`
    (default allow). Setting `SYNC_HMAC_ALLOW_LEGACY=false` rejects v1 entirely.
  - **Nodes auto-register `inactive`.** First-contact sync nodes are quarantined
    `inactive` (code-only change, no migration) and require admin approval via
    `PATCH /api/v1/sync/nodes/{id}` before they can push/pull. Nodes already
    `active` are unaffected. This closes the "new node id" path independently of
    the signature.

  Not a complete close on its own: the advisory is fully closed only when
  `SYNC_HMAC_ALLOW_LEGACY=false` **and** every node has migrated to v2. This is a
  cross-repo change — the v2 material is canonical here, but **awcms-mini** and
  the node spec/skill must be updated to emit v2 before legacy is disabled in any
  deployment. v1 is deprecated-transitional. New env var `SYNC_HMAC_ALLOW_LEGACY`
  (default `true`) must be wired into shared env docs/validation.

- cd772a3: Add the sync-storage module: offline-first synchronization ported from
  awcms-mini. HMAC-authenticated node-to-node event exchange (outbox/inbox),
  optimistic-concurrency conflict tracking, and an object sync upload queue with
  an internal dispatcher.

  - New migrations `010_awcms_sync_storage_outbox_inbox_schema.sql`,
    `011_awcms_sync_storage_conflict_schema.sql`, and
    `012_awcms_object_sync_queue_schema.sql`: add `awcms_sync_nodes`,
    `awcms_sync_outbox`, `awcms_sync_inbox`, `awcms_sync_push_batches`
    (idempotency ledger keyed `(tenant_id, node_id, batch_id)`),
    `awcms_sync_aggregate_versions`, `awcms_sync_conflicts` (immutable), and
    `awcms_object_sync_queue`. All tenant-scoped tables have RLS tenant-isolation
    policies, FK-covering indexes, and the performance/listing indexes. Seeds the
    `sync_storage` permissions (node_management, conflict_resolution,
    object_queue).
  - Node-to-node endpoints (`POST /sync/push`, `POST /sync/pull`,
    `GET /sync/status`, `POST /sync/objects`, `GET /sync/objects/status`)
    authenticate via HMAC (`X-AWCMS-Node-ID`/`Timestamp`/`Signature`,
    `HMAC-SHA256("<timestamp>.<body>")`, timing-safe compare, skew-bounded
    anti-replay), gated by `AWCMS_SYNC_ENABLED`, rejecting inactive nodes with 403. Push is idempotent per batch; conflicts are recorded immutably.
  - Admin surfaces (`GET/PATCH /sync/nodes`, `GET /sync/conflicts` +
    `/{id}/resolve`, `GET /sync/object-queue` + `/{id}/retry`) are
    session-authenticated, ABAC-guarded, and audited.
  - Object storage defaults to the local driver (`STORAGE_DRIVER=local`); R2 is
    optional (`R2_ENABLED`). The internal dispatcher `bun run sync:objects:dispatch`
    drains the object queue per tenant with a claim-lease, backoff, circuit
    breaker, and timeout — provider calls happen strictly outside transactions
    (ADR-0006).
  - Adds `readTextBody` to the shared request-body reader (raw-body read for HMAC
    verification) and the `retry` action to the identity-access `AccessAction`
    union (not high-risk).

- 9db1da6: Tenant-scope the office hierarchy FK (GHSA-r7cx-c4jh-cvvw) and fix three
  correctness gaps in the office directory (Issue #149).

  **Cross-tenant hierarchy (security).** `awcms_offices.parent_office_id` was
  declared `REFERENCES awcms_offices (id)` — a FK on the primary key alone, which
  says nothing about tenancy — and `POST /api/v1/offices` passed the caller's
  `parentOfficeId` straight to the INSERT with no lookup. An admin of tenant A
  could therefore name an office id belonging to tenant B and get `200 OK`,
  grafting their tree onto another tenant's. It doubled as an existence oracle:
  a real id from another tenant returned 200 while a random uuid returned an FK
  violation (500), so the field could be used to probe whether any given office
  id existed platform-wide.

  RLS did not cover this and could not: PostgreSQL runs referential integrity
  checks as the referenced table's owner with row-level security bypassed, so the
  FK's parent lookup saw the other tenant's row even from a session pinned to
  tenant A — verified still exploitable after `FORCE ROW LEVEL SECURITY` landed
  in `sql/017`. `sql/020_awcms_offices_tenant_scoped_fk.sql` makes tenancy part
  of the constraint instead: `UNIQUE (tenant_id, id)` gives the FK a target, and
  the FK becomes `(tenant_id, parent_office_id) REFERENCES (tenant_id, id)`, so
  the referenced office must sit in the same tenant as the referencing one — an
  invariant no privilege level can talk its way around. `createOffice` now also
  resolves the parent through `fetchOfficeById(tx, tenantId, ...)` before its
  first write, turning a bad parent into a `400` instead of an FK violation
  (500), and making the unknown / other-tenant / soft-deleted cases fail
  identically so the oracle closes.

  Existing cross-tenant parent links are detached to NULL by the migration
  (making those offices roots) rather than deleted: the office rows are the
  tenant's own legitimate data, only the edge into the other tenant is not.

  **`GET /api/v1/offices` is now keyset-paginated** — previously it returned
  every office of the tenant with no `LIMIT` at all, unbounded for a retail
  tenant with thousands of outlets. It now returns at most 100 per page plus an
  opaque `nextCursor`, via the shared `_shared/keyset-pagination.ts` helper.
  **Breaking read-order change:** results are now newest-first
  (`created_at DESC`) rather than oldest-first, matching the direction the shared
  cursor encodes and every other paginated list in this base. A malformed
  `cursor` is rejected with `400` rather than silently serving page 1.

  `listOffices` compares its keyset on `date_trunc('milliseconds', created_at)`
  rather than bare `created_at`. This is load-bearing, not cosmetic: cursors
  carry a JS `Date` (milliseconds) while `timestamptz` stores microseconds, and
  the driver floors them on the way out — so a bare comparison excludes every row
  sharing the boundary row's millisecond, including rows never shown, which no
  later cursor can reach either. Measured before the guard: 105 offices, page 1
  returned 100, page 2 returned 4 — one office permanently unreachable.

  **Duplicate `officeCode` now returns `409 OFFICE_CODE_ALREADY_EXISTS`** instead
  of 500. The unique index (`awcms_offices_tenant_code_key`) already existed; the
  `23505` is now translated to a `DuplicateOfficeCodeError` and caught inside
  `withTenant`, so it neither surfaces as an unhandled `PostgresError` nor counts
  against the shared database circuit breaker. Reusing the code of a
  soft-deleted office still works — the index is partial.

  **A soft-deleted parent office is now rejected.** No FK can express this (a
  soft-deleted row is still physically present), so it rests on the application
  check; previously `parentOfficeId` could point at a soft-deleted office and
  leave a dangling hierarchy.

  Covered by `tests/office-directory-postgres.test.ts` against real PostgreSQL
  (gated on `DATABASE_URL`), including a test that asserts the constraint
  directly at the database rather than through the application — the FK has to
  hold when no application code runs at all.

- ab24355: Theming module (ADR-0034 Fase 3) — the FIRST website module implemented directly
  in the awcms base, proving ADR-0034's decision that content/website modules may
  now live in `src/modules/` here ("template dipakai-langsung"). Adapted from
  awcms-micro's `theming` (Issue #269 / awcms-micro ADR-0029). Bumps the base
  registry 10 → 11 modules.

  - **Data-only tenant theming, no uploaded code.** A THEME is trusted, reviewed,
    BUILD-TIME source (a `ThemeDescriptor` composed by `theme-registry.ts` from the
    reviewed in-repo base themes — never a database row or an uploaded artifact).
    Only a tenant's DATA configuration of a theme lives in the database
    (`awcms_theming_config_versions` draft + immutable published versions, and
    `awcms_theming_tenant_state` active pointer; sql/033, all three tables
    `ENABLE`+`FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy).
  - **Security spine — reject, never sanitize (`domain/css-value-validation.ts`).**
    Every design-token value is validated by REJECTION against strict, bounded,
    linear (no-ReDoS) grammars (hex/rgb/hsl colors, dimensions with an allowed-unit
    list, bounded numbers, font families from a per-theme allow-list whose emitted
    stack is descriptor-owned). `url(...)`, `expression()`, `@import`, `javascript:`,
    comment breakouts, `;{}<>`, backslash, and unbalanced tokens can never reach the
    emitted CSS. Token values ship as an EXTERNAL same-origin `text/css` stylesheet
    (`/theming/{tenantCode}/tokens.css`), so `style-src 'self'` is never weakened.
  - **Immutable published versions + audited lifecycle.** draft → validate → preview
    → publish → rollback/retire. Published versions are IMMUTABLE (INSERT-only engine
    - a sql/033 `BEFORE UPDATE/DELETE` trigger); rollback/retire move the active
      pointer while history stays intact. `PUT /api/v1/theming/draft`,
      `POST /api/v1/theming/{validate,preview,publish,rollback,retire}` +
      `GET /api/v1/theming` — ABAC-gated (`theming.config.*`/`theming.version.*`/
      `theming.preview.create`, seeded in sql/034), idempotency-keyed on high-risk
      mutations, and audited. Adds the `archive` action to the `AccessAction`
      union/high-risk set.
  - **Non-indexable, hashed, short-lived previews.** `awcms_theming_preview_sessions`
    stores only the SHA-256 hash of the raw preview token; every read filters
    `expires_at >= now()`; the preview surfaces are `X-Robots-Tag: noindex` +
    `private, no-store` on a URL namespace distinct from the public stylesheet.
  - **Port adaptations.** No derived-repo theme seam (the derived-application pathway
    was removed in ADR-0034 Fase 2 — themes live in the base registry). `media_library`
    is dropped (not in this base): asset-URL resolution is a documented no-op and
    assets are omitted from render, degrading safely. The `data_lifecycle` purge
    descriptor is dropped (no purge engine/worker role here); preview retention rides
    the `expires_at` read filter. Public tenant resolution is `tenantCode`-based
    (ADR-0009), not Host-based. Revokes the `no-content-website-modules` divergence
    in `awcms-family-compatibility.yaml`.

- fb1848d: Add deployment-profile-aware Cloudflare Turnstile bot protection (Issue #186,
  epic #177), ported and hardened from awcms-mini. A new full-online deployment
  gate (`AUTH_ONLINE_SECURITY_ENABLED`/`AUTH_ONLINE_SECURITY_PROFILE`) plus
  `TURNSTILE_ENABLED` activate a server-side Turnstile challenge on
  `POST /api/v1/auth/login` and `POST /api/v1/setup/initialize`. The verifier runs
  after request-shape/rate-limit checks and before password verification, outside
  any DB transaction, and validates success, action (per endpoint), hostname, and
  challenge freshness with a timeout, response-size cap, and secret/token
  redaction (the token is never logged or audited). On the full-online profile it
  fails closed with a single generic error (no account-enumeration oracle); rate
  limit and lockout keep working independently.

  Every LAN/offline deployment (the default) is unchanged: no widget, no iframe,
  no CSP origin, and no outbound verification call — `isTurnstileRequired()`
  returns false there, and `TURNSTILE_ENABLED=true` alone (without the full-online
  profile) is still fully off. When enabled, the middleware CSP opens exactly the
  one `challenges.cloudflare.com` origin in `script-src`/`frame-src`, the login
  page renders the widget, and `config:validate` + `security:readiness` +
  production preflight validate the site key, secret key, and expected hostname
  consistently while distinguishing "disabled intentionally" from "misconfigured".
  The login/setup request contract gains an optional `turnstileToken` field.

  No database migration is added — Turnstile is configuration/env only; the secret
  key lives in the environment and never touches the database, logs, audit,
  responses, or health output. MFA (#184) and OIDC break-glass (#185) login
  branches are preserved intact.

- e92c579: Add the workflow-approval module: a managed, versioned, graph-based approval
  engine ported from awcms-mini's proven `workflow-approval` module. Draft/
  publish/retire definition lifecycle with immutable published/retired versions
  and per-instance version pinning; generic nodes/transitions (sequential
  approval, bounded conditional routing, parallel/join fan-out/fan-in, notify);
  quorum/any/all approval rules; effective-dated delegation/substitution;
  escalation/timeout policies processed by a scheduled worker job; and
  administrative recovery (reassign/cancel/force-decision).

  - New migration `013_awcms_workflow_approval_schema.sql`: adds
    `awcms_workflow_definitions`, `awcms_workflow_instances`,
    `awcms_workflow_tasks`, `awcms_workflow_task_assignments`,
    `awcms_workflow_join_arrivals`, `awcms_workflow_decisions` (append-only),
    and `awcms_workflow_delegations`. All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE, FK indexes, `timestamptz`, and the 14
    workflow permission rows. The upstream `GRANT ... TO <worker-role>`
    least-privilege blocks are intentionally omitted (this base has no separate
    worker/app database roles).
  - Registers 8 domain event types (`awcms.workflow.instance.*`,
    `awcms.workflow.task.escalated`, `awcms.workflow.delegation.*`) in the
    domain-event-runtime registry, with matching AsyncAPI channels/operations,
    published via `appendDomainEvent` inside the same transaction as each state
    change.
  - Public REST surface under `/api/v1/workflows/**` (definitions CRUD +
    lifecycle, approval inbox + decisions, delegations, instance history +
    cancel, administrative recovery) with default-deny ABAC, tenant/RLS,
    `Idempotency-Key` + audit on every high-risk mutation, and OpenAPI paths.
  - New scheduled worker `bun run workflow:escalations:dispatch` (registered in
    the module job registry).
  - Extends `identity_access`'s ABAC evaluator with the self-approval /
    self-administered-force-decision denial the workflow decision endpoints rely
    on (inert for every endpoint that does not supply
    `requestedByTenantUserId`).

  The `notify` graph node's concrete notification adapter (owned by the `email`
  module in awcms-mini) is not wired yet — `notify` nodes silently no-op and
  advance until the `email` module is ported.

- 13813bb: Workflow approval: close concurrency and quorum-bypass holes

  - **Issue #140 — concurrent approvals no longer corrupt a task.**
    `fetchTaskWithInstanceForDecision` now takes `SELECT ... FOR UPDATE OF t` on
    the task row, serialising quorum evaluation per task. Previously two
    approvers deciding at the same instant each evaluated quorum against a READ
    COMMITTED snapshot blind to the other's uncommitted decision:
    `quorumRule: "all"` stranded the task `pending` forever with every assignment
    `decided` (everyone then got a 403 and the escalation worker re-escalated
    indefinitely), while `quorumRule: "any"` advanced the graph twice, producing
    duplicate downstream tasks and doubled `workflow.instance.advanced` events.

  - **Issue #152 — a cancelled instance can no longer be resurrected.** The
    `end`-node status UPDATE in `workflow-graph-engine.ts` now carries
    `AND status = 'pending'` (matching `cancelWorkflowInstance`) and rolls the
    transaction back if it matches nothing, instead of silently overwriting a
    cancellation with `approved`/`rejected`.

  - **GHSA-9qwq-cmr5-6wfc — one person can no longer satisfy a multi-person
    quorum alone.** A user who was both an original assignee and a node's
    escalation target used to accumulate two live assignment rows on one task and
    could vote twice. Migration `018` adds a partial unique index over
    `(workflow_task_id, tenant_user_id) WHERE status IN ('pending','decided')`
    (de-duplicating any existing rows first), both assignment INSERT paths became
    `ON CONFLICT DO NOTHING`, and quorum now counts
    `COUNT(DISTINCT tenant_user_id)` — people — rather than `COUNT(*)` rows.

  Behaviour change: reassigning a task to someone who has already decided it now
  fails with a `WorkflowRecoveryError` instead of granting them a second vote.

### Patch Changes

- 9da3a8c: Admin UI: author and manage ABAC policies (Issue #171). Adds
  `POST /api/v1/abac/policies` (create) and `PATCH /api/v1/abac/policies/{id}`
  (update effect/description and enable/disable toggle), both gated default-deny on
  `identity_access.access_control.configure` (the access-control administration
  permission — that activity seeds only `read`/`assign`/`configure`, and the owner
  holds only seeded permissions) and audit-logged as high-risk access-control
  changes. A duplicate `policyCode` returns 409. The
  `/admin/abac-policies` screen gains a create-policy form plus per-row Edit and
  Enable/Disable controls (UX-only gating; the endpoint ABAC guard is the
  authority).
- 7f54e83: Add admin management screens for profiles, modules, and email templates (Issue #166) — extending the admin UI to more of the requested management surface, each following the offices screen's SSR-read-then-render pattern backed by an existing awcms API.

  - **`admin/profiles.astro`** — the tenant's central profiles/parties via `listParties` (gated `profile_identity.profile_management.read`). Identifiers (masked PII) are deliberately not bulk-listed.
  - **`admin/modules.astro`** — the module catalog via `fetchModuleCatalog` (gated `module_management.modules.read`).
  - **`admin/email-templates.astro`** — tenant email templates via `listEmailTemplates` (gated `email.template.read`), including inactive.

  All three are permission-gated (clean "no access" notice otherwise), degrade to an error notice on a DB circuit-breaker `Response`, and are linked from the `AdminLayout` sidebar. The authenticated E2E (`admin-offices.e2e.ts`) now also navigates through them and asserts their tables render for the seeded owner (the module catalog assertion is data-seed-free — it lists the code-registered core modules).

  Read-only for this slice. NOTE: the other requested domains — user management, RBAC (roles/assignments), and ABAC (policies) — have no read API in awcms yet (the tables exist but no `listTenantUsers`/`listRoles`/`listAbacPolicies` application function or route is ported), so their admin screens depend on porting those backend reads from awcms-mini first, per the mini-first flow.

- 04c331f: Add module enable/disable toggle and email-template create form to the admin UI (Issue #171) — the next slice of admin write actions, each riding an EXISTING awcms endpoint (no new backend), following the create-office form's permission-gated + CSP-safe pattern.

  - **`admin/modules.astro`** — now reads the tenant's per-module ENABLEMENT state (`fetchTenantModuleEntries`, gated `module_management.tenant_modules.read`) instead of the global module catalog, so the rendered enabled/disabled column is exactly the `awcms_tenant_modules.enabled` state the toggle mutates. A per-row enable/disable toggle, shown to users holding the matching `module_management.tenant_modules.{enable,disable}` permission, posts to the existing `POST /api/v1/tenant/modules/{key}/{enable,disable}` (cookie auth). Core modules get no disable button (the endpoint 409s that); a non-core module can still fail to disable if another ENABLED module depends on it — the endpoint enforces that (409) and the UI shows a generic error. The disable endpoint requires a non-empty `reason` (recorded in the audit event), so the toggle prompts for one. The endpoints' ABAC guard + dependency/core validation remain the real authority — the button gate is UX-only.
  - **`admin/email-templates.astro`** — a create form shown to users holding `email.template.create`, posting to the existing `POST /api/v1/email/templates` (cookie auth). `templateKey` is a fixed select of the base categories (`BASE_EMAIL_TEMPLATE_CATEGORIES`); subject/body are captured for the `en` locale and sent as the `{ locale: text }` map the endpoint expects. `validateCreateEmailTemplateInput` (restricted category, localized-text shape, unsafe-HTML rejection) stays the authority.

  Both scripts are bundled EXTERNAL (they import from `admin-form-client`) so the `default-src 'self'` CSP allows them; both surface only a single generic error on failure (never internal detail, Issue #540) and guard double-submit via `lockElement`. Authed E2E added for each (`admin-modules-toggle.e2e.ts` toggles then reverts — self-reversing and retry-safe; `admin-email-templates-create.e2e.ts` is idempotent on the fixed `templateKey`). Both run in the CI `e2e-smoke` job.

  Remaining #171 scope (RBAC assign/unassign + role-permission mutation, ABAC policy authoring, edit/soft-delete/restore) needs newly-ported backend endpoints and is left to a focused follow-up cycle.

- 511fd0e: Add a create-office form to the admin offices screen (Issue #166), permission-gated on `tenant_admin.office_management.create`, posting to the existing `POST /api/v1/offices` via cookie auth; CSP-safe (external bundled script). Authed E2E covers create → row appears.

  - **`admin/offices.astro`** — renders `#office-create-form` above the existing table only when the SSR context holds `tenant_admin.office_management.create`. On submit the bundled `<script>` (imports `lockElement`/`postJson` from `admin-form-client`, forcing Astro to emit it external per the `default-src 'self'` CSP) reads `officeCode`/`officeName`/`officeType`, `POST`s to `/api/v1/offices` (cookie auth — no tenant header), reloads on success, and shows a single generic error otherwise (never internal detail, Issue #540). Double-submit is guarded via `lockElement`.
  - **E2E** — new `tests/e2e/admin-offices-create.e2e.ts`, env-gated like `admin-offices.e2e.ts`: the seeded owner fills the form with a per-run unique code and the new row appears in `#offices-table` after reload.

  The endpoint, validation, ABAC guard, and duplicate/parent handling already existed; this slice is additive UI + coverage.

- 9da3a8c: Admin offices lifecycle: soft-delete + restore (Issue #171). Adds
  `DELETE /api/v1/offices/{id}` (audited soft-delete; optional/bodyless reason)
  and `POST /api/v1/offices/{id}/restore` (audited restore, 409 when a live
  office has retaken the code). The `/admin/offices` screen gains permission-gated
  per-row inline edit (name + status via the existing PATCH), soft-delete, and a
  deleted-offices section with restore controls. Seeds the new
  `tenant_admin.office_management.delete` permission via migration
  `sql/023_awcms_seed_office_management_delete_permission.sql` (so the owner,
  granted only catalogued permissions at bootstrap, can actually delete); restore
  reuses `office_management.update`.
- 511fd0e: Add a create-profile form to the admin profiles screen (Issue #166), permission-gated on profile_identity.profile_management.create, posting to POST /api/v1/profiles via cookie auth; CSP-safe external script. Authed E2E covers create → row appears.
- b3e5145: Add user (tenant-users), RBAC (roles), and ABAC (policies) read APIs + admin management screens (Issue #166, Stage 3b) — porting awcms-mini's access-management reads, adapted to awcms's schema/scope. Completes the requested management surface (auth, user, profile, rbac, abac, module, template) as read-only admin screens.

  - **Read layer** — `src/modules/identity-access/application/access-directory.ts`: `listTenantUsers` (users + assigned role codes, `login_identifier` **masked** via `maskIdentifierValue`), `listRoles` (non-deleted roles + permission count), `listAbacPolicies` (policies; seeded-empty by default — built-in rules apply). All bounded `LIMIT 100`, tenant-filtered, inside `withTenant`.
  - **Endpoints** — `GET /api/v1/users`, `GET /api/v1/roles`, `GET /api/v1/abac/policies`, all gated on the existing `identity_access.access_control.read` permission (no new permission migration needed; mini's `user_management` activity code does not exist in awcms, so `access_control.read` is used as the gate). OpenAPI updated with matching paths + `TenantUserMasked`/`Role`/`AbacPolicy` schemas.
  - **Screens** — `admin/users.astro`, `admin/roles.astro`, `admin/abac-policies.astro`, permission-gated, linked from `AdminLayout`. The authenticated E2E now navigates all three and asserts the users table shows the owner's **masked** login identifier (never the raw address).

  Docs synced: doc 07, `identity-access/README.md`, `ARCHITECTURE.md`. Read-only for this slice; assign/create/edit (RBAC write) is a follow-up.

- 9da3a8c: Admin roles CRUD + role↔permission management (Issue #171). Adds
  `POST /api/v1/roles` (create), `PATCH`/`DELETE /api/v1/roles/{id}` (rename /
  soft-delete), `POST /api/v1/roles/{id}/restore`, and `POST`/`DELETE
/api/v1/roles/{id}/permissions` (grant / revoke), plus write controls on the
  `/admin/roles` screen (create form, per-row rename / soft-delete, restore, and
  a manage-permissions panel). All writes are HIGH-RISK: authorized on the
  existing `identity_access.access_control.configure` permission and audited.
  System roles (e.g. `owner`) cannot be soft-deleted (409). Duplicate role code
  (409) and duplicate permission grant (409) are caught inside the tenant
  transaction.
- 4e2c804: Add awcms's first admin management UI — login + admin shell + offices screen — with full E2E coverage (Issue #166, Stage 2). Ports awcms-mini's admin UI pattern, adapted to awcms's fondasi scope; the auth/session/middleware plumbing (`/admin` guard, `resolveSsrContext`, login/logout endpoints) already existed, so this is additive UI.

  - **Pages**: `login.astro` (posts to `POST /api/v1/auth/login` with `X-AWCMS-Tenant-ID`, redirects to `/admin`), `admin/index.astro` (dashboard rendered purely from `ssrContext`), `admin/offices.astro` (management screen — SSR-reads the tenant's offices via the same `listOffices` the JSON endpoint uses, permission-gated on `tenant_admin.office_management.read`, renders an accessible table + status badges). A stripped `AdminLayout` and the doc-14 design tokens (`src/styles/tokens.css`) + `admin.css` back them.
  - **CSP handled correctly** (Issue #148): the middleware stays the single CSP owner (`default-src 'self'`, covering JSON + HTML + pages). `astro.config.mjs` sets `build.inlineStylesheets: "never"` (external stylesheets) and every page `<script>` imports from `src/lib/ui/admin-form-client.ts` — which forces Astro to bundle it to an external file rather than inline it (an inline script would be CSP-blocked, silently breaking the page). Verified: the login page ships zero inline script/style.
  - **E2E**: `login.e2e.ts` (form render + the CSP "no inline script" property) validated live locally; `admin-offices.e2e.ts` drives the full authenticated loop (login → session → `/admin` → offices table + wrong-password generic-error path). The CI `e2e-smoke` job now provisions `postgres:18.4`, runs `db:migrate`, and seeds a tenant+owner through the real `POST /api/v1/setup/initialize` bootstrap.

  Read-only offices for this first slice; create/edit stays on `POST /api/v1/offices` and lands later.

- 9da3a8c: Add tenant-user activate/deactivate + role assign/unassign to the admin UI (Issue #171) — the next slice of admin write actions, backed by new guarded, audited endpoints in the identity-access module.

  - **`user-admin.ts`** (new application layer) — `setTenantUserStatus` (activate/deactivate; `awcms_tenant_users` has no `deleted_at`, so deactivate = `status='inactive'` / reactivate = `status='active'`), `assignRole` (DB-idempotent via the `(tenant_id, tenant_user_id, role_id)` unique index; a repeat assign raises 23505 → 409), and `unassignRole`. Each writes a high-risk audit event; login identifiers (PII) are never logged — the audit row references the stable `tenant_user_id`.
  - **`PATCH /api/v1/users/{id}`** (new) — set a tenant user's status. Guarded on `identity_access.access_control.configure`.
  - **`POST` / `DELETE /api/v1/access/assignments`** (new) — assign / revoke a role. Guarded on `identity_access.access_control.assign`. 23505 → 409 is caught INSIDE `withTenant`; target-not-found → 404 is raised before any write.
  - **`admin/users.astro`** — now renders per-user activate/deactivate and assign-role (with per-role remove) controls, each UX-gated on the same permission its endpoint enforces (the endpoint guard is the authority). Login identifiers stay masked in the render. The client script is external (CSP-safe) and uses the shared `sendJson` PATCH/DELETE helper.

  GUARD NOTE (no migration): the seed (`sql/005`) provides `identity_access.access_control.{read,assign,configure}` but no `.update`, and the owner role is granted only SEEDED permissions — so guarding on `update` would deny even the owner. Role assignment therefore uses the exactly-named `assign` permission; user activate/deactivate uses `configure` (the broadest identity-access admin permission), since deactivating revokes all of a user's access. A future migration adding a dedicated `access_control.update` (or a `user_management` activity) would let user-status be gated independently of role/permission administration.

- 9da3a8c: Harden the admin access-control write surface against privilege-escalation and
  lockout foot-guns (Issue #171 review follow-up):

  - **System-role permission set is immutable via the API.** `POST`/`DELETE
/api/v1/roles/{id}/permissions` now refuse `is_system` roles (409
    `ROLE_SYSTEM_PROTECTED`) — a delegated `configure` holder can no longer strip
    the seeded `owner` role's grants and lock the tenant out (parity with
    `softDeleteRole`, which already blocked system roles).
  - **System roles cannot be hand-assigned/unassigned.** `POST`/`DELETE
/api/v1/access/assignments` refuse `is_system` roles (409
    `ROLE_SYSTEM_PROTECTED`) — the `assign` permission can no longer be used to
    self-assign `owner` (escalation) or strip it from the sole owner (lockout).
  - **Deactivation lockout guards.** `PATCH /api/v1/users/{id}` refuses to
    deactivate the actor's own account (409 `CANNOT_DEACTIVATE_SELF`) or the last
    active member of a system role (409 `USER_LAST_ADMIN_PROTECTED`), so a tenant
    can never be left with no active administrator and no in-app recovery.

  All guards are checked before any write, audited on the success path only, and
  scoped to the tenant (no cross-tenant existence oracle).

- e407ffe: docs(governance): reposisi README/AGENTS & indeks ADR ke ADR-0034 (keluarga = template dipakai-langsung)

  Menyelaraskan dokumen pintu-depan dengan ADR-0034 (Fase 4a, item d + audit rujukan ADR ERP):

  - README (`.md`/`.id.md`) & AGENTS.md: narasi "repo ekstensi/turunan terpisah" → "template dipakai-langsung, modul domain (termasuk ERP) hidup langsung di `src/modules/`"; menghapus posisi jalur-turunan sebagai jalur aktif dan menandai panduan lama `derived-application-guide.md` DEPRECATED.
  - Header status ADR yang di-supersede ADR-0034: 0015 & 0022 → Superseded; 0013, 0014, 0025 → Accepted dengan catatan "jalur aplikasi-turunan di-supersede oleh ADR-0034" (bagian load-bearing base tetap berlaku).
  - Indeks ADR (`docs/adr/README.md`/`.id.md`): kolom Status kelima ADR itu diperbarui + framing folder direposisi dari ADR-0022 ke ADR-0034; regenerasi i18n-source-hash EN.

  ADR-0020 (kontrak kesiapan ERP) sengaja tidak disentuh — tetap load-bearing dan tidak di-supersede.

- fba69f8: chore(deps): bump `astro` from 7.0.9 to 7.1.1. Runtime framework patch. The
  family-compatibility manifest's `stack.astro.declared` pin is updated to `^7.1.1`
  in the same change so `family:conformance:check` stays green (declared value must
  equal the real `package.json` dependency).
- 320e8c6: chore(deps-dev): bump `@changesets/cli` from 2.31.0 to 2.31.1 (dev-only release
  tooling patch; no runtime behavior change).
- 50a7d76: chore(ci): bump `github/codeql-action` (`init` + `analyze`) from 4.37.0 to
  4.37.1. Both steps are bumped together in the same workflow — CodeQL requires
  every `github/codeql-action/*` step to run the identical version, so a split bump
  (dependabot opened `init` and `analyze` as separate PRs) fails the Analyze job
  with a version-mismatch error. This supersedes the separate `init`-only PR.
- 13813bb: Add a Content-Security-Policy to every response (Issue #148). This base
  previously set none at all.

  `src/lib/security/security-headers.ts` now emits `default-src 'self'`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, and
  `frame-ancestors 'none'` — the directive set awcms-mini uses, minus its
  `frame-src` and the Turnstile/YouTube origins it allowlists, neither of which
  has any subject in this base. `src/middleware.ts` already applies this
  builder's output to every response, so no route or middleware change was
  needed. `X-Frame-Options: DENY` stays as an independent older-browser layer.

  Set here rather than via Astro's built-in `security.csp` (the mechanism mini
  uses): Astro emits the CSP only from its page render path, and this base has
  no pages — `src/pages/` contains only API endpoints, and its two HTML
  responses (`src/lib/html/error-responses.ts`) are plain `Response`s returned
  from endpoints. A `security.csp` block in `astro.config.mjs` would therefore
  set zero headers here; `astro.config.mjs` now carries a comment recording
  that, and `security-headers.ts` documents what must be reconciled if this
  base ever gains real `.astro` pages (Astro's own header and this one do not
  compose — middleware's `headers.set` would replace Astro's).

  Rules out the "strict CSP breaks the UI" hazard rather than assuming it away:
  this base ships no `.astro` component, no inline script or style, no inline
  event handler, and no external origin, so `'self'` has nothing to break.

  Session cookies were already `httpOnly`, which stops XSS from reading a
  token; this closes the layer above it — XSS riding the session via a
  same-origin `fetch()`, and `<base href>` injection hijacking a relative form
  POST to an attacker origin.

- ad216ec: Add opt-in least-privilege `awcms_worker`/`awcms_setup` database roles (Issue #163) — the second half of the mini-045 role split; the first half (narrowing `awcms_app`) shipped as sql/021.

  `sql/022_awcms_db_worker_setup_roles.sql` creates two purpose-specific runtime roles alongside `awcms_app`:

  - **`awcms_worker`** — the seven unattended cron workers (`logs:audit:purge`, `sync:objects:dispatch`, `email:dispatch`, `domain-events:dispatch`, `workflow:escalations:dispatch`, `reporting:projections:refresh`, `reporting:exports:dispatch`). Granted exactly the per-write-path verbs each script uses across 25 tables — traced from THIS repo's actual SQL, not copied from mini (mini's worker set is visitor-analytics/blog/form-drafts, none of which exist here) — and zero access to the crown-jewel global catalogs (`awcms_permissions`, `awcms_schema_migrations`, `awcms_setup_state`, the module registry).
  - **`awcms_setup`** — the one-time `POST /api/v1/setup/initialize` bootstrap only. Granted exactly what `bootstrapPlatformTenant` writes across 11 tables, with SELECT accompanying INSERT on every `RETURNING id` (Postgres requires SELECT for a column to appear in RETURNING), `awcms_permissions` read-only, and no DELETE anywhere.

  Both are NOLOGIN + passwordless (a deployment activates LOGIN and a secret, exactly like `awcms_app`), non-superuser/non-BYPASSRLS/non-owner (so FORCE RLS applies), and carry the same fail-closed all-zero `app.current_tenant_id` default.

  **Opt-in, NOT breaking.** `getWorkerDatabaseClient`/`getSetupDatabaseClient` still fall back to `DATABASE_URL` (the `awcms_app` connection) when `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` are unset — a deployment that manages one connection string keeps working unchanged; the roles simply sit unused until an operator points a URL at one.

  A new `security:readiness` check ("Worker/setup least-privilege role grants match matrix") verifies each provisioned role holds exactly its matrix and nothing more (non-blocking when the roles are absent, i.e. on the fallback). The grant matrix, the migration's GRANTs, and the readiness check are pinned to one another by contract tests; the full matrix was validated empirically against PostgreSQL 18. Also corrects several stale comments/docs that referenced these roles as belonging to nonexistent migrations (mini's numbering 045/060/069).

  Migration only — no schema/data change, no API/event change.

- a805b2e: Add the browser E2E harness (Playwright + Bun) and a real catch-all 404 page — the first slice of porting awcms-mini's E2E layer, following the mini-first flow.

  - **Harness** (`playwright.config.ts`, `test:e2e`/`test:e2e:install` scripts, `@playwright/test` devDep) ported from awcms-mini and adapted: specs live in `tests/e2e/*.e2e.ts` (the `.e2e.ts` suffix keeps `bun test` from ever picking them up), run via `bun --bun playwright test` (Bun-only, AGENTS.md #14), against an already-running app (Playwright's `webServer` can't provision the Postgres this app boots against). See skill `awcms-browser-test`.
  - **Catch-all 404** (`src/pages/[...path].ts`) wires the previously-dormant public HTML error responses (`src/lib/html/error-responses.ts`): an unknown browser path now gets a clean, generic 404 HTML page that leaks nothing internal (Issue #540), and an unknown `/api/*` path gets the standard JSON error envelope instead of framework-default chrome. Astro ranks rest params lowest, so every real route still wins.
  - **First E2E spec** (`tests/e2e/not-found.e2e.ts`) drives a real Chromium at the 404 page and asserts the clean render + no internal-detail leak. Validated live locally (system Chrome) and wired into a new CI `e2e-smoke` job (`.github/workflows/ci.yml`) — no Postgres needed since the 404 route touches no DB.

  Foundation for the admin/management screens (login, offices, …) whose specs land with the first `.astro` pages.

- 13813bb: Perbaiki dua bug modul email yang diwarisi dari awcms-mini (Issue #143, #153).

  **#143 — lease dispatcher email tidak lagi write-only.** `claimEligibleEntries`
  menulis `next_attempt_at = leaseExpiry` sebagai lease klaim, tapi predikat
  klaimnya hanya menyaring `status IN ('queued', 'retry_wait')` — baris `sending`
  tidak pernah diklaim ulang. Dispatcher yang mati di antara CLAIM dan FINALIZE
  meninggalkan pesan `sending` selamanya: semua finalize bersyarat
  `status = 'sending'` dan `cancelEmailMessage` menolak status `sending`, jadi
  pesan itu tak terkirim, tak bisa dibatalkan, tak bisa di-retry. Predikat klaim
  kini menyertakan `OR (status = 'sending' AND next_attempt_at <= now)`, sama
  persis dengan dispatcher saudaranya `sync-storage/application/object-dispatch.ts`,
  sehingga `EMAIL_DISPATCH_LEASE_MINUTES` benar-benar dibaca. Insert
  `awcms_email_delivery_attempts` diberi `ON CONFLICT ... DO NOTHING` pada
  constraint `UNIQUE (message_id, attempt_no)`: pass yang mengklaim ulang
  menghitung `attempt_no` yang sama, dan `23505` yang tak tertangani akan
  membatalkan seluruh batch dispatch.

  **#153 — N+1 INSERT pada enqueue announcement.** `enqueueAnnouncement` kini
  memakai multi-row INSERT via `unnest` per 500 baris (pola sama dengan batch
  insert `awcms_object_sync_queue` di `src/pages/api/v1/sync/objects/index.ts`),
  bukan satu INSERT per recipient di dalam satu transaksi HTTP. Target
  `tenant`/`role` yang sebelumnya tanpa `LIMIT` kini dibatasi
  `ANNOUNCEMENT_MAX_RECIPIENTS` (5000) dengan urutan deterministik; saat cap
  tercapai, `enqueueAnnouncement` mengembalikan `truncated: true` dan mencatat log
  `warning` `email.announcement.recipients_truncated`. Dispatcher juga men-cache
  template per `template_key` dalam satu pass — satu batch 25 pesan announcement
  dengan `template_key` sama sebelumnya membuat 25 transaksi berisi 25 query
  identik.

  Response endpoint announcement bertambah field `truncated` (additive), begitu
  juga endpoint preview-nya — keduanya beserta OpenAPI-nya diperbarui. Tanpa itu
  pemanggil menerima `200 OK` berisi `recipientCount: 5000` dan tidak punya cara
  tahu bahwa sisa audiensnya tidak pernah di-enqueue; `matchedCount` di preview
  pun akan diam-diam berarti "maksimal 5000", padahal preview justru dipakai
  admin untuk menjawab "berapa yang akan terjangkau?" sebelum mengirim.

  Panggilan provider tetap di luar transaksi (ADR-0006), satu panggilan per pesan
  — cache template tidak menggabungkan pengiriman.

- 13813bb: Fix profile identifier masking and duplicate handling (Issue #144, Issue #150),
  both ported from awcms-mini.

  - `maskIdentifierValue` now masks email-shaped values the way awcms-mini's
    `maskIdentifier` does: the domain and the local part's first character stay
    readable (`budi.santoso@example.com` -> `b***********@example.com`) instead
    of collapsing every address into an identical star run ending in `.com`. The
    masked columns exist so an admin can tell recipients apart in the email
    outbox and suppression lists; the generic tail mask made
    `to_address_masked`/`recipient_masked` useless for that. The email branch is
    detected from the value itself, so the `maskIdentifierValue(value)` signature
    and every existing call site are unchanged.
  - `maskIdentifierValue` no longer leaks the last character of a short value:
    `"7788"` now masks to `****` (was `***8`) and `"12"` to `**` (was `*2`).
    A value of four characters or fewer has no non-leaking tail to show.
  - `POST /api/v1/profiles/{id}/identifiers` now answers `409
IDENTIFIER_ALREADY_EXISTS` when the identifier already exists for the tenant,
    instead of surfacing the unique-index violation as an unhandled `500`.
    `addIdentifierToProfile` translates Postgres `23505` into a new
    `DuplicateIdentifierError`; any other Postgres error is rethrown untouched.
    The route catches it inside `withTenant` so the translated error cannot count
    against the shared database circuit breaker.

- 9db1da6: Add the first `tests/integration/` suite — a real-PostgreSQL harness plus the
  priority tests ported from awcms-mini (Issue #154).

  Until now every one of this repo's `tests/*.test.ts` was a pure-unit test or a
  migration-shape assertion; nothing exercised RLS, FK, unique constraints,
  locking, or a real request path. That is the root reason several DB-layer bugs
  reached the tree undetected (RLS inert on 23 tables, PR #139). awcms-mini has
  101 integration tests; awcms had none.

  New `tests/integration/harness.ts` provisions, from the CI-supplied superuser
  `DATABASE_URL`, a throwaway database owned by a purpose-built non-superuser
  role, runs the REAL migration runner (`bun scripts/db-migrate.ts`) as that
  role, demotes it, and activates migration 019's least-privilege `awcms_app`
  role — reproducing production's exact connection posture (non-superuser,
  NOBYPASSRLS, `FORCE` RLS live). It repoints `DATABASE_URL` at the app role so
  every route handler and `getDatabaseClient()` call runs least-privilege, and
  tears the database down afterwards. Ref-counted so multiple files share one
  database within a `bun test` process.

  New tests (all gated on `DATABASE_URL`, so `bun test` without a database — as
  in `ci.yml` — skips cleanly, and they execute in `release.yml`, which provides
  a `postgres:18.4` service):

  - `db-role-separation.integration.test.ts` — pins PR #139/#141: all 23 tables
    are `ENABLE`+`FORCE`, cross-tenant SELECT/UPDATE/DELETE/INSERT are blocked
    for the owner posture, a live-catalog check catches any future table shipped
    with `ENABLE` but no `FORCE`, and the `awcms_app` grant matrix + fail-closed
    all-zero `app.current_tenant_id` default. `awcms_app` assertions skip cleanly
    and informatively if migration 019 is ever absent.
  - `module-tenant-lifecycle.integration.test.ts` — pins the PR #139 invariant
    that disabling a module actually returns `403 MODULE_DISABLED` from its own
    endpoints (not just flips a flag), plus enable/disable rules, audit, and
    cross-tenant isolation, through the real route handlers.
  - `reporting-projections.integration.test.ts` — pins the incremental
    cursor-table worker's bounded-pass/resume correctness and the event-activity
    watermark comparison, making the source references in
    `event-activity-projection.ts` and `reporting/README.md` true.
  - `object-storage-uploader.integration.test.ts` — the ADR-0006 provider path
    (checksum-mismatch pre-check, provider 5xx, timeout, circuit breaker) over a
    real loopback S3 round trip. Not database-gated — runs everywhere.

  Tests-only: no runtime code, migration, schema, or API surface changes.

- 296b7e3: Fix silent row loss in keyset pagination: the shared cursor now carries
  `created_at` at full microsecond precision instead of flooring it to
  milliseconds (Issue #158).

  `encodeKeysetCursor` used to serialise a row's `created_at` as a JS `Date`
  (`.toISOString()`), which holds only milliseconds — but `timestamptz` holds
  microseconds, and the driver had already floored them on the way out
  (`...:00.029058+00` arrives as `...:00.029Z`). A cursor built from that `Date`
  denoted an instant strictly EARLIER than the row it came from, so
  `(created_at, id) < (cursor)` skipped every row that shared that millisecond
  across a page boundary — rows that no later cursor could reach either. Measured
  against a batch of rows sharing one millisecond, page 2 came back empty.

  The fix carries the value through the cursor as full-precision UTC ISO-8601
  text (`_shared/keyset-pagination.ts`, `KEYSET_CURSOR_CREATED_AT_SQL`), keeping
  `ORDER BY (created_at, id)` on the bare column so the existing
  `(tenant_id, created_at DESC)` indexes still serve the query. `KeysetCursor.createdAt`
  is now a string, not a `Date`; the cursor stays opaque to clients and remains
  backward-compatible with any millisecond cursor already in flight.

  Endpoints corrected: `GET /api/v1/workflows/tasks`, `GET /api/v1/email/messages`,
  `GET /api/v1/sync/object-queue`, and `GET /api/v1/offices` (whose earlier local
  `date_trunc('milliseconds', …)` guard is removed now that the fix is central).
  The `GET /api/v1/email/messages` and `GET /api/v1/sync/object-queue` response
  bodies are unchanged (`{ …, nextCursor }`); only the value of `nextCursor` is
  now correct.

- 8a78ffd: Harden `checkRuntimeRoleGrants` (`bun run security:readiness`) to fail CLOSED
  for undeclared global RLS-free tables (Issue #162 / L2, from the PR #161
  security audit).

  The runtime-role grant check kept two independent structures: an
  `RLS_FREE_TABLES` set (read by `checkRlsEnabled`) and a separate
  forbidden-privilege map (read by `checkRuntimeRoleGrants`). A future global,
  RLS-free table added to the SET to make `checkRlsEnabled` pass but forgotten in
  the MAP was `continue`d as "full DML kept by design" and passed silently — the
  exact "a new global table inherits blanket DML from `ALTER DEFAULT PRIVILEGES`"
  regression this check exists to catch. Non-exploitable today (the 9 tables are
  curated correctly) but a latent trap for the next migration.

  - The two structures are merged into ONE source of truth
    (`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`, keyed by table name; `RLS_FREE_TABLES`
    is now derived from its keys). You can no longer register a table in one
    place without the other — every RLS-free table carries an explicit
    privilege declaration. The five module-registry tables that legitimately
    keep full DML get an explicit empty (`[]`) forbidden list — a visible
    "allow", not an implicit default.
  - The over-granted direction is now fail-closed: any table treated as RLS-free
    but missing an explicit declaration is asserted to hold ZERO writes. A
    forgotten registration that still holds INSERT/UPDATE/DELETE now FAILS
    `critical` with a "register the privileges awcms_app may hold" message
    instead of passing.

  Behaviour on the current, correctly-curated database is unchanged (still PASS).
  No schema, API, or event changes. Verified against a fully-migrated PostgreSQL
  18 database (sql/001..021): the 9-table default policy still passes, and a
  simulated undeclared global table holding blanket DML now fails the check.

- 1877d19: Close three gaps in `redactSecretsInText` where secret-shaped substrings
  passed through free text (error messages, stack traces) unredacted. Each shape
  was already covered by the anchored `SECRET_VALUE_PATTERNS` list in the same
  file, but was missing from the free-text `TEXT_SECRET_PATTERNS` list — so
  object values were masked while the identical secret in an error string was
  not.

  - Connection-string credentials (`scheme://user:password@host`). This is the
    highest-impact of the three: `DATABASE_URL`/`WORKER_DATABASE_URL` are DSNs,
    so the app's own database password reached `sanitizeErrorForLog` unredacted
    and was persisted to `awcms_domain_event_deliveries.last_error_message` /
    `dead_letter_reason`, then served verbatim by
    `GET /api/v1/domain-events/deliveries` — whose read path documented (and
    relied on) the invariant that write-time redaction had already run.
  - PEM private-key blocks truncated before their `-----END-----` marker (a log
    line cut off by a buffer limit). The existing paired pattern cannot match an
    unterminated block, so the raw base64 key body was emitted in full. The new
    fallback is ordered after the paired pattern, which has already consumed
    every well-formed block.
  - AWS access key ids (`AKIA…`) embedded in prose.

  Adds `tests/redaction.test.ts` pinning all three shapes plus the pattern
  ordering; the module previously had no test coverage, which is why the gaps
  went unnoticed.

- 13813bb: Fix a TOCTOU between a reporting projection rebuild and the steady-state
  incremental worker that could double-count a projection's metrics (Issue
  #151).

  `projection-incremental-worker.ts`'s rebuild guard (`isRebuildRunning`) ran
  in a `withTenant` transaction of its own, committed, and only then opened a
  separate transaction per pass. A rebuild triggered in that window reset the
  projection's cursors to NULL and its metrics to 0 _after_ the guard had
  already reported "no rebuild is running", so the incremental pass re-scanned
  the source table from the beginning while the rebuild's own passes did the
  same — both applying the same delta to the same metric row (they serialize
  on that row lock and therefore sum). The file's own header claimed the
  opposite invariant ("idempotent rebuild must never double-count").

  - New `reporting/application/projection-lock.ts`: a per-(tenant, projection)
    `pg_advisory_xact_lock`, taken as the FIRST statement of every transaction
    that writes a projection's cursor/metric rows — `runCursorStreamPass`,
    `triggerOrResumeRebuild`, `runRebuildStreamPass`, and
    `applyEventActivityProjectionIncrement`. Held by the database for the whole
    transaction and released automatically at COMMIT/ROLLBACK.
  - `runCursorStreamPass` now also re-checks `findRunningRebuild` inside that
    same locked transaction, and reports the skip as a pass result
    (`CursorStreamPassResult.skippedRebuildInProgress`) instead of the caller
    pre-checking it in an earlier, separate transaction.

  Relocating the check alone would not have been sufficient: these transactions
  run at READ COMMITTED, where every statement takes a fresh snapshot, so a
  check and an act are not atomic with respect to a concurrently committing
  writer even within one transaction. The lock is also the only mechanism that
  works across processes — the rebuild trigger runs in a web request while the
  incremental worker runs in a separate `reporting:projections:refresh`
  process, which no in-process gate can serialize.

  No migration, no API change, no event change: `pg_advisory_xact_lock` needs
  no schema. `runIncrementalUpdateForTenant`'s observable outcome shape is
  unchanged; a skipped run still reports `skippedRebuildInProgress: true` with
  `rowsProcessed: 0`.

  Also corrects stale references to
  `tests/integration/reporting-projections.integration.test.ts`
  (`projection-incremental-worker.ts`, `event-activity-projection.ts`, and the
  module README) — that file exists in awcms-mini, not here, and this
  repository has no `tests/integration/` suite at all.

- d04c96c: Fix `POST /api/v1/roles` and `POST /api/v1/offices` to return `201 Created` on success instead of `200 OK`, matching the `created()` helper already used by `POST /api/v1/abac/policies` and the REST convention for resource-creation endpoints. Updates the corresponding OpenAPI response codes to `201`.
- 9db1da6: Sapu realitas warisan awcms-mini dari `.claude/skills/` (yang DIIKUTI agen,
  sehingga skill yang salah aktif melahirkan bug) dan tambah gate otomatis yang
  menangkap kelas bug ini sekali jalan.

  - **Rujukan migration `sql/NNN` hantu** — 34 rujukan (penomoran awcms-mini yang
    terbawa saat adaptasi) dibetulkan: yang punya padanan awcms diperbaiki ke
    nomor yang benar (mis. email — migrasi mini 020/021/024 → `sql/014`), yang
    merujuk modul yang belum di-port dinyatakan tegas sebagai artefak awcms-mini
    lewat banner status per-file.
  - **Skill untuk modul yang belum di-port ditandai BACAAN SAJA** — 10 skill
    (`blog-content`, `data-lifecycle`, `document-infrastructure`, `form-drafts`,
    `idn-admin-regions`, `integration-hub`, `news-portal`, `social-publishing`,
    `visitor-analytics`, `tenant-domain-routing`) mendapat prefiks status di
    `description` + banner "BELUM di-port; ada di awcms-mini" di body, mengikuti
    pola `awcms-legacy-migration`. `awcms-profile-identity` ditandai SEBAGIAN
    (fondasi ada, lapis Issue #748 belum di-port).
  - **Rujukan role/script disetel ke realitas terkini** — `awcms_app` +
    `scripts/security-readiness.ts` kini ADA (Issue #141/#142); skill dinaikkan
    dari "belum ada" ke status akurat (mis. `awcms-new-migration` aturan 11/12,
    `awcms-port-from-mini`, `awcms-deploy`, `awcms-workflow-approval`). Role
    `awcms_worker`/`awcms_setup` dinyatakan tetap tidak ada.
  - **Gate baru `checkSqlMigrationReferences`** di `scripts/lib/docs-checks.mjs`
    (dijalankan `bun run check:docs`) menolak setiap rujukan `sql/NNN` di
    dokumentasi (termasuk `.claude/skills/`) yang berkasnya tidak ada di `sql/`.
    Escape hatch berbasis konten (penanda inline `<!-- sql-refs: awcms-mini -->`
    - daftar path), bukan nomor baris.
  - **`NAMING_EXEMPTIONS` diperbaiki dari `file:line` ke `file::identifier`**
    (berbasis konten) supaya kebal terhadap pergeseran baris — desain lama patah
    saat agen paralel menyisipkan baris di dokumen yang sama.

  Tidak ada perubahan pada kode runtime, schema, atau API.

- 911738a: docs: sinkronkan dokumentasi & skill dengan kode/DB (aftermath ADR-0034) + dokumen kontinuasi

  Menyelaraskan docs non-gate dan skill dengan realita repo (11 modul, 34 migrasi, jalur aplikasi-turunan dihapus, port #179–186 landing):

  - **docs/ARCHITECTURE.md**: 10→11 modul (+theming), sql/023→034, §Komposisi ditulis ulang tanpa jalur turunan (`application-registry.ts`/`extension:check`/namespace 900); fakta diperbarui — MFA/OIDC/SSO/Turnstile & ABAC-dinamis/business-scope/SoD dari "belum ada" → "sudah live"; OpenAPI bundler & theming dipindah dari gap.
  - **docs/awcms & docs/adr** (12 file): repo-inventory & doc 13 (angka modul/migrasi), extension-compatibility-policy (banner DEPRECATED), api-contribution-guide & 09_roadmap & release-process (framing/tooling turunan dicabut), collision slot `sql/033` (kini theming) di ADR-0003/0010, path fixture `derived-application-example`→`example-domain-modules`.
  - **.claude/skills** (7 diedit + 1 baru): new-module (buang jalur turunan + ModuleType `derived`), erp-extension-readiness (BACAAN SAJA/HISTORIS), release & production-preflight (buang `extension:check`), codeql-triage (FP #6 historis), observability/integration (reframe "aplikasi turunan"), **skill baru `awcms-theming`**.
  - **docs/PROJECT_STATE.md** (BARU): dokumen kontinuasi/handoff ter-versioning (model tata kelola, inventori, backlog, jebakan) + pointer dari AGENTS.md.

  Tidak ada perubahan kode/sql/kontrak; `bun run check` penuh hijau.

- 8a78ffd: Harden sync HMAC v2 signature material against delimiter ambiguity (audit finding L1, GHSA-c972-3q5p-g3h4).

  The v2 material `v2:<tenantId>:<nodeCode>:<timestamp>:<body>` was cryptographically ambiguous at the tenant/node boundary because `nodeCode` may contain `:` (schema `node_code text`, no format constraint): `(tenantId="A", nodeCode="x:y")` and `(tenantId="A:x", nodeCode="y")` produced byte-identical material and mutually-accepted signatures. This was confirmed NOT cross-tenant exploitable (a request's `tenantId` must be a valid UUID to reach tenant data via `withTenant`), but was a latent weakness in security-signature code.

  `computeSyncSignatureV2`/`verifySyncSignatureV2` now require `tenantId` to be a UUID before the material is built — a UUID is a fixed 36 chars with no `:`, so the tenant field boundary is unambiguous. `computeSyncSignatureV2` throws on a non-UUID tenantId; `verifySyncSignatureV2` fails closed (returns `false`). Only `tenantId` is constrained — `nodeCode` is untouched, and the v2 material format is unchanged, so already-deployed v1/v2 nodes (whose tenant ids are UUIDs) are unaffected. v1 signatures (`computeSyncSignature`/`verifySyncSignature`) are not changed. Timing-safe comparison is preserved.

## 5.1.1

### Patch Changes

- 2008905: Perbaiki `release.yml`'s job `sign-attest-publish`: `actions/attest-build-provenance` dan `actions/attest-sbom` menolak `subject-name` yang menyertakan tag (`ghcr.io/ahliweb/awcms:dryrun-<sha>@sha256:...` → `Invalid image name`) — ditemukan lewat rehearsal pertama (`workflow_dispatch`, run 29477950931) sebelum tag rilis nyata pertama di-push. Tambah output job `build`'s `image-repo` (repo tanpa tag) dan pakai itu untuk `subject-name` kedua step attest, sambil tetap memakai `image-ref` (dengan tag) untuk `cosign sign`.

## 5.1.0

### Minor Changes

- a53e6e2: Implementasikan pipeline release nyata (docs/awcms/release-process.md): `Dockerfile.production` (multi-stage, non-root, health check), `.dockerignore`, `scripts/release-verify.ts` (+ `scripts/lib/release-verify-checks.ts`, tag == package.json version, CHANGELOG punya section, tak ada changeset pending), dan `.github/workflows/release.yml` (validate → build image + SBOM ganda → keyless cosign sign + provenance/SBOM attest → publish GitHub Release, dengan jalur rehearsal via `workflow_dispatch`). Belum pernah dieksekusi terhadap tag nyata — rehearsal pertama masih perlu dijalankan sebelum tag `v5.0.0` sungguhan di-push.

### Patch Changes

- d83805c: Perbaiki `package.json`'s `description` agar konsisten dengan ADR-0022/ADR-0023: AWCMS adalah basis/fondasi untuk ERP, bukan sebuah "Platform ERP" itu sendiri.

## 5.0.0

**Deliberate manual version jump — not a tool-computed SemVer increment.** Bumped directly from `0.2.0` to `5.0.0` per maintainer decision to continue this product's pre-rebuild release numbering (last legacy tag: `v4.6.0`) rather than resetting to `1.0.0`, so version comparisons never look like a downgrade across the rebuild. See [ADR-0024](docs/adr/0024-semver-numbering-continues-legacy-major-line.md) for the full rationale and an explicit compatibility note: despite continuing the number line, **`5.0.0` is not backward-compatible with any `v2.x`–`v4.x` legacy release** — the entire codebase was rewritten from scratch on a new foundation (Bun/Astro/PostgreSQL modular monolith, see [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md)/[ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)). No git tag or GitHub Release accompanies this changelog entry yet — `.github/workflows/release.yml` (the SBOM/signing/provenance publish pipeline, see [`docs/awcms/release-process.md`](docs/awcms/release-process.md)) has not been implemented yet, so there is no real release for this version to attach to until that pipeline exists.

## 0.2.0

### Minor Changes

- f306b38: Tambah workflow GitHub Actions (CI, CodeQL, Changesets policy) yang mencerminkan `bun run check`, gate `check:docs` (mermaid/tautan/penamaan) beserta logika murninya, script `changesets:policy:check`, template issue/PR, dependabot, dan CODEOWNERS — diadaptasi dari awcms-mini dan dipangkas ke infrastruktur yang benar-benar ada di repo ini (belum ada job E2E/Postgres-integrasi/release image, didokumentasikan sebagai deferred di `docs/awcms/branch-protection.md` dan `scripts/README.md`).
- 5d1cf54: Tambah dukungan dokumentasi dwibahasa (ADR-0023): Bahasa Indonesia sebagai sumber otoritatif (`<nama>.id.md`), Inggris sebagai default yang tampil (`<nama>.md`). Diterapkan pada tiga dokumen pintu depan (`README.md` root, `docs/awcms/README.md`, `docs/adr/README.md`) plus `scripts/check-docs-translation.mjs` (gate staleness berbasis hash, masuk `bun run check` dan CI) yang mendeteksi saat sumber ID berubah tanpa terjemahan EN diregenerasi.

### Patch Changes

- ffdcd99: Bump `actions/upload-artifact` dari v4.6.2 ke v7.0.1 di workflow CI (dependency bump, tidak ada perubahan perilaku pipeline).
