🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:c8114323e13133bf3f5f488808486d7bb2b32f8abbd962454997447a7b9ffe82 -->

# Adendum DPIA penggajian yang disetujui (per deployment)

Direktori ini memuat adendum **yang disetujui** milik deployment yang memakai
modul `hr_payroll` (Issue #1449). Di template ia sengaja kosong: template tidak
membawa adendum deployment mana pun, dan direktori kosong adalah keadaan
fail-closed (penggajian tidak bisa diaktifkan).

- Templat untuk disalin:
  [`../dpia-addendum-hr-payroll-template.id.md`](../dpia-addendum-hr-payroll-template.id.md).
- Ketentuan pemrosesan untuk dijadikan perjanjian:
  [`../payroll-processing-terms-template.id.md`](../payroll-processing-terms-template.id.md).
- Satu berkas per adendum yang disetujui: `<ref>.md`, dengan `<ref>` berupa huruf
  kecil, angka, dan tanda hubung.

## Bagaimana gerbang memakainya

`HR_PAYROLL_DPIA_ADDENDUM_REF`, `HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON` dan
`HR_PAYROLL_DPIA_ADDENDUM_SHA256` menamai berkas, tanggal persetujuan, dan
digest-nya. Tanpa ketiganya, berbentuk benar, modul `hr_payroll` tidak bisa
diaktifkan untuk tenant (`409 PAYROLL_DPIA_ADDENDUM_REQUIRED`) dan setiap
endpoint ber-guard miliknya menjawab `403 PAYROLL_DPIA_ADDENDUM_REQUIRED`, apa
pun yang dipegang pemanggil. `bun run config:validate` dan
`bun run security:readiness` memeriksa tambahan bahwa berkas ada, cocok dengan
digest-nya, ber-`status: approved`, menyebut penandatangan dan tanggal tinjauan
penasihat hukum, mempertahankan setiap bagian wajib, dan tidak punya penanda
kurung-siku-ganda yang belum terisi.

Menyunting adendum yang sudah disetujui mengubah digest-nya: gerbang memerah
sampai pengendali menyetujui ulang dan variabel digest diperbarui. Itu hambatan
yang disengaja, bukan cacat.

## Yang tidak dibuktikan gerbang

Bahwa penandatangan adalah orang yang disebut catatan, atau bahwa isinya memadai
secara hukum. Ia membuktikan sebuah deployment tidak bisa go-live tanpa dokumen
yang lengkap, disahkan, dan tidak diubah. Kecukupan hukum tetap pada pengendali
dan penasihat hukum (keputusan pemilik K13); repositori ini bukan nasihat hukum.

Rancangannya, dan alasan ia ditegakkan di jalur pengaktifan modul serta di
chokepoint `authorizeInTransaction`, ada di
`src/modules/_shared/payroll-dpia-addendum-gate.ts`.
