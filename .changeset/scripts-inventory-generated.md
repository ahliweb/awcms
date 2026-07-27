---
"awcms": patch
---

Turunkan inventaris `scripts/README.md` dari `package.json`, dan tolak klaim
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
