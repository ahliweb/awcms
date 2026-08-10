---
"awcms": minor
---

feat(access): sebuah grup pengguna adalah subjek, dan ia memberi peran

[ADR-0081](../docs/adr/0081-a-user-group-is-a-subject-that-grants-roles.md),
Gelombang 3 PR 3.5 — penutup gelombang. `sql/104` (dua tabel + `subject_type`
melebar), `sql/105` (empat permission).

Sebuah grup memegang grant di `awcms_access_policies` persis seperti orang
memegangnya, dan keanggotaan menjangkau **setiap pembaca lewat SATU cabang**
tambahan di `activeRoleGrants`.

**Mode kegagalan senyap yang ditolak desain ini.** Sebuah grup bisa saja
dibangun untuk memberi permission KEY langsung; dari luar tampilannya identik.
Subjek akan memegang kuncinya sementara `subject.roles` tetap KOSONG — sehingga
kebijakan tenant `subject.roles in ["editor"]` diam-diam berhenti cocok. Yang
`allow` berhenti cocok itu penyempitan (aman, ada yang menyadarinya); yang
**`deny` berhenti cocok itu INERT, yaitu pelebaran**, dan tak ada yang
mengamatinya. SoD buta dengan cara yang sama, persis untuk grant yang keberadaan
fitur grup dimaksudkan menciptakannya.

Test integrasinya karena itu tidak berbunyi "keanggotaan bekerja". Ia berbunyi:
peran turunan-grup sampai ke `subject.roles`, ke `fetchGrantedPermissionKeys`,
ke resolver SoD, dan ke daftar admin — keempatnya, dalam satu assertion.

**Gerbang yang diminta rencana tidak dibangun, dan itu bukan pemotongan.**
`access:sod-fact-parity:check` mewajibkan kedua resolver merujuk satu konstanta
bersama. ADR-0079 sudah menutup celahnya lebih rapat: para pembaca tidak lagi
menyebut tabel grant sama sekali, mereka menyisipkan fragmennya, dan
`access:grant-readers:check` menolak berkas yang merakit join sendiri. "Merujuk
konstanta yang sama" bisa benar sementara kedua query berbeda; "memakai fragmen
yang sama" tidak bisa.

**Empat keputusan yang menanggung beban:**

- **Memberi grup sebuah PERAN memakai `access_control.assign`**, bukan permission
  grup. Membaliknya adalah eskalasi tanpa nama yang jelas: administrator grup
  yang juga bisa memberi peran kepada grupnya sendiri bisa memberi `owner`
  kepada grup yang ia anggotai. `assignRoleToGroup` juga menolak peran
  `is_system` — di sini penolakan itu lebih penting daripada di jalur per-orang,
  karena grant kepada grup menjangkau juga setiap orang yang ditambahkan NANTI.
- **`external_id`, bukan `group_code`, adalah kunci sinkron.** Rename di IdP
  tidak boleh meng-orphan grup. SCIM **tidak dibangun** — yang dibangun adalah
  penolakannya (`409 GROUP_EXTERNALLY_MANAGED`), karena suntingan lokal yang
  diam-diam dibatalkan sinkron berikutnya lebih buruk daripada yang tak pernah
  diterima. `source` juga tak pernah diterima dari request.
- **Tak ada `delete`.** Memensiunkan grup adalah tiga keputusan — grant-nya,
  keanggotaannya, dan `external_id` yang besok disodorkan direktori lagi.
  Soft-delete sudah punya arti yang benar (`deleted_at IS NULL` ada di cabang
  grup, jadi grup terhapus memberi nol), tetapi permukaan yang menyetelnya
  menunggu keputusan itu.
- **`UNION ALL`, bukan `UNION`.** Subjek bisa memegang peran yang sama langsung
  DAN lewat grup, dan tiap konsumen sudah men-dedupe apa yang perlu. Membayar
  sort di jalur otorisasi untuk menghemat mereka nol adalah membayar di tempat
  paling mahal.

**Mencabut `NOT NULL` dari tabel otorisasi hidup**, kata-kata yang terdengar
persis seperti perubahan yang DITOLAK ADR-0078. Perbedaannya: di sana yang
dicabut indeks unik, yang salah ke arah MEMBOLEHKAN tanpa gerbang memerah. Di
sini ia DIGANTI CHECK yang lebih ketat di blok yang sama — baris tanpa subjek,
dengan dua subjek, atau dengan subjek yang tak sesuai diskriminatornya kini
ditolak (diuji terhadap basis data, lewat koneksi yang melewati API). Dan indeks
unik parsialnya wajib dapat saudara: `NULL` tidak sama dengan `NULL`, jadi yang
lama berhenti membatasi apa pun begitu `tenant_user_id` boleh NULL.

Plafon `BOUNDED_BY_DESIGN` naik dari 3 ke 5, dan **menaikkan baris itu adalah
tindakan yang direview** — yaitu plafonnya bekerja, bukan gagal. Keempat entri
adalah satu argumen dalam dua paruh: tabel yang barisnya grant buatan
administrator, plus tabel yang dibatasi olehnya. Purge berbasis usia pada salah
satunya menghapus otorisasi yang hidup.
