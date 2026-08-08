---
"awcms": patch
---

fix(gerbang,docs): klaim "modul ini belum ada" berhenti bersembunyi di `src/modules/`

`tests/module-absence-claims.test.ts` dibangun karena tiga skill menyatakan modul
yang ada di `listModules()` sebagai tidak ada — klaim yang membuat agen tidak
mencarinya, tidak memanggilnya, dan dengan senang hati men-stub ulang sesuatu
yang sudah bekerja. Gerbang itu memindai `.claude/skills/*/SKILL.md` dan
`docs/awcms/*.md`.

**Kalimat yang sama persis ternyata ada di `src/modules/data-lifecycle/README.md`**
— "`form_drafts`/`newsletter`/`comments` (unported in this base) are not
registered as adopters here" — sementara `form_drafts` dan `comments` keduanya
mendeklarasikan descriptor `dataLifecycle` nyata. Ia duduk **satu direktori di
luar** korpus gerbangnya. README dan header descriptor sebuah modul justru
tempat paling load-bearing untuk klaim semacam ini, karena itulah yang dibaca
orang sebelum menyentuh modul tersebut.

Dua pelebaran, dan yang kedua diperlukan agar yang pertama tidak sia-sia:

1. Korpus ditambah `src/modules/*/README.md` dan `src/modules/*/module.ts`,
   di-assert terpisah supaya glob yang resolve ke nol tidak lolos secara hampa —
   mode kegagalan yang persis pernah terjadi pada `dot: true`.
2. Daftar frasa ditambah bentuk **Inggris** (`not ported`, `unported`,
   `does not exist in this base`, `no longer exists`). Berkas di `src/modules/`
   ditulis dalam bahasa Inggris, jadi daftar Indonesia-saja akan memindai berkas
   baru itu sambil **tidak mencocokkan apa pun** di dalamnya.

Dibuktikan lewat dua mutasi: mengembalikan kalimat ASLI membuat gerbang merah
dan menyebut kedua modul; mempertahankan cacat itu **tetap tertanam** sementara
frasa Inggris dilepas membuat gerbang **hijau** — jadi penambahan frasa itu
load-bearing, bukan hiasan.

**Tujuh dokumen yang membantah kodenya sendiri diperbaiki**, tiap klaim
diverifikasi ke kode lebih dulu:

- `media-library/module.ts` menyatakan `/api/v1/media/objects/*` dan
  `/admin/media` "NOT ported here" dan "declares no `navigation` yet (the
  `/admin/media` page it would point at does not exist in this base)" —
  keduanya ADA, dan entri `navigation`-nya dideklarasikan **40 baris di bawah**
  paragraf itu di berkas yang sama. Bukan cacat fungsional (layarnya
  terjangkau), tetapi deskripsi descriptor adalah yang dibaca `listModules()`
  dan tampil di layar Module Management.
- `data-lifecycle/README.md` — di atas.
- `blog-content/module.ts` masih menulis "Two entries … Taxonomy, presentation,
  settings and homepage composition are still sibling screens" setelah lima
  entri mendarat. Ini kelalaian saya sendiri dari PR sebelumnya.
- `absorb-awcms-micro-roadmap.md` memesan `2.4.0` untuk
  `newsletterContentSources`; slot itu sudah dipakai `api.routes` (#267) dan
  `2.5.0` oleh ADR-0053. Kini `2.6.0`.
- `module-contract.ts` melompati **entri changelog `2.4.0`** seluruhnya
  (2.3.0 → 2.5.0) — dan justru itulah sebab roadmap memesan slot yang sudah
  terpakai. Ditambahkan.
- `docs/ARCHITECTURE.md` masih membingkai `newsletter`/`social-publishing`/dll.
  sebagai "belum di-port … urutan porting". ADR-0055 mencabut jalur itu:
  mini/micro ARSIP, kapabilitas DIBANGUN di sini lewat ADR admission sendiri.
- `docs/adr/0067` menyebut `/news/**` sebagai permukaan HTML repo ini. Kalimat
  aslinya **dipertahankan** dengan catatan supersession — ia benar saat ditulis,
  dan ADR adalah catatan keputusan, bukan dokumen current-state. **Hanya
  kalimat konteks itu** yang disentuh; keputusan RUM di ADR yang sama tidak.
