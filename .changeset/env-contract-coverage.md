---
"awcms": minor
---

Tegakkan bahwa setiap variabel env yang dibaca kode ada di `.env.example`.

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
