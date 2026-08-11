---
"awcms": minor
---

feat(access): sebuah undangan membawa Policy-nya sendiri (ADR-0082, #423)

Gelombang 4 PR 4.1. `awcms_invitations` + `awcms_invitation_policies`
(`sql/106`, permission `sql/107`): sebuah undangan menyebut alamat dan membawa
daftar peran yang akan dipegang orang itu begitu ia menerima. Peran-peran itu
**inert** sampai penerimaan — yang mendarat di PR 4.2 — memanggil
`grantRolePolicy`, penulis yang sama dengan setiap grant lain, sehingga
`activeRoleGrants` tidak pernah perlu tahu tabel ini ada.

**Mengundang dan memberi peran tetap dua otoritas.** Undangan ber-peran
menuntut `identity_access.invitations.create` DAN
`identity_access.access_control.assign` — pengulangan pemisahan ADR-0081 dengan
taruhan lebih tinggi, karena grant lewat undangan menjangkau orang yang belum
ada. `skip_email_confirmation` menuntut permission ber-`scope: 'platform'`
(satu-satunya milik modul ini) kecuali alamatnya sudah memegang identitas aktif
di tenant ini.

**Kolom scope ada tetapi dipatok** `CHECK (scope_type = 'tenant' AND scope_id =
tenant_id)`. ADR-0080 menulis sendiri bahwa PR yang menambahkan penulis grant
ber-scope tidak boleh mendarat tanpa menjawab batasnya; ini menjawabnya dengan
menolak menjadi penulis itu, sambil menyisakan pelebaran nanti sebagai satu
`DROP`/`ADD CONSTRAINT`.

Resend **merotasi** token (tanpa rotasi, "kirim ulang" adalah permukaan
perbanyakan token) dan digerbangi `create`; batas 5 kali hidup di CHECK basis
data, dan ditegakkan di predikat UPDATE-nya sendiri, bukan lewat baca-lalu-tulis
di JS.

Perubahan yang ikut, dan alasannya:

- `AuthNotificationPort` mendapat operasi KEDUA
  (`enqueueAuthAddressNotification`) alih-alih `recipientTenantUserId` yang
  nullable. Seorang undangan belum punya baris `awcms_tenant_users`, jadi
  operasi lama tidak bisa mengalamatinya — dan membuat field itu opsional akan
  meninggalkan setiap pemanggil lama satu salah-ketik dari mengantre pesan tanpa
  tujuan.
- Kategori template `auth.invitation` + template default en/id.
- `awcms_invitation_policies` masuk `BOUNDED_BY_DESIGN` (4 → 5): ia dibatasi
  induknya lewat `ON DELETE CASCADE`, dan cascade itu load-bearing — tanpanya
  purge `generic` induknya akan gagal di FK anak dan retensinya diam-diam tak
  pernah berjalan.
- Empat permission baru masuk ledger `NOT_YET_SCREENED`; `/admin/invitations`
  adalah perubahan tersendiri (urutan yang sama dengan ADR-0056).
- Tiga env baru dituliskan tangan di `.env.example` karena
  `config:env:coverage:check` hanya mencocokkan `process.env.X` dan buta
  terhadap `env.X` yang dilewatkan sebagai parameter — batas yang gerbangnya
  catat sendiri.
