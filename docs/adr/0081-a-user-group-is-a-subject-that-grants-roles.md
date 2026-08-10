# ADR-0081 — Sebuah grup pengguna adalah SUBJEK, dan ia memberi PERAN

- **Status:** Diterima (2026-08-10).
- **Konteks:** Issue #423 Gelombang 3 PR 3.5 (penutup gelombang). Migrasi
  `sql/104` (skema) dan `sql/105` (permission).
- **Membangun di atas:** [ADR-0078](0078-a-grant-carries-its-own-scope.md)
  (`subject_type` sengaja menerima satu nilai supaya penambahan ini bukan
  backfill), [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md)
  (satu sumber grant — tanpa itu, PR ini harus menyentuh tujuh pembaca), dan
  [ADR-0080](0080-a-scoped-grant-covers-only-what-its-role-confers.md).

## Keputusan

`awcms_user_groups` + `awcms_user_group_members`, dan
`awcms_access_policies.subject_type` kini menerima `'user_group'` dengan kolom
subjek ber-XOR. Sebuah grup memegang grant persis seperti orang memegangnya.

Keanggotaan menjangkau setiap pembaca lewat SATU cabang tambahan di
`activeRoleGrants`.

## Mode kegagalan senyap yang ditolak desain ini

Sebuah grup bisa saja dibangun untuk memberi **permission key** langsung. Dari
luar tampilannya identik, dan salahnya tidak akan terlihat siapa pun:

Subjek akan memegang kunci-kuncinya sementara `subject.roles` tetap KOSONG. Maka
kebijakan tenant `subject.roles in ["editor"]` diam-diam berhenti cocok.
Kebijakan **allow** yang berhenti cocok adalah penyempitan — aman, dan ada yang
menyadarinya. Kebijakan **deny** yang berhenti cocok adalah **INERT**, yaitu
pelebaran, dan tak ada yang mengamatinya. SoD ikut buta dengan cara yang sama:
faktanya dikunci pada grant peran, jadi grant turunan-grup tidak akan membawa
konflik — tepat untuk grant yang keberadaan fitur grup dimaksudkan
menciptakannya.

Karena grant mendarat di `awcms_access_policies`, semua itu tidak bisa terjadi:
`subject.roles`, `fetchGrantedPermissionKeys`, kedua resolver SoD, daftar admin,
dan guard administrator-terakhir mendapatkannya sekaligus.

## Gerbang yang direncanakan tidak dibangun, dan itu bukan pemotongan

Rencana program meminta gerbang baru `access:sod-fact-parity:check` yang
mewajibkan kedua resolver merujuk satu konstanta `grantSourceTables()` bersama.

Ia tidak dibangun karena **ADR-0079 sudah menutup celahnya lebih rapat**. Para
pembaca tidak lagi menyebut tabel grant sama sekali — mereka menyisipkan
`activeRoleGrants`, dan `access:grant-readers:check` menolak berkas mana pun yang
merakit join-nya sendiri. Gerbang yang mewajibkan dua resolver merujuk konstanta
yang sama akan menjadi pemeriksaan yang lebih lemah dari yang sudah berlaku:
"merujuk konstanta yang sama" bisa benar sementara kedua query berbeda, sedangkan
"memakai fragmen yang sama" tidak bisa.

Yang menggantikannya sudah ada dan diperluas di PR ini:
`tests/grant-source-parity.test.ts` (statis: tiap pembaca menyisipkan fragmennya)
dan `tests/integration/user-groups.integration.test.ts` (perilaku: peran
turunan-grup sampai ke SETIAP pembaca, `subject.roles` dan SoD termasuk).

## `external_id`, bukan `group_code`, sebagai kunci sinkron

Rename di IdP tidak boleh meng-orphan grup. `group_code` adalah label manusia dan
manusia mengganti nama; `external_id` adalah nama grup itu menurut direktori dan
ia selamat melewati rename.

**SCIM tidak dibangun.** Yang dibangun adalah bentuk yang tidak perlu dimigrasi
saat ia dibangun, plus PENOLAKANNYA: grup `source = 'scim'` menolak rename dan
mutasi keanggotaan dengan `409 GROUP_EXTERNALLY_MANAGED`. Suntingan lokal yang
diam-diam dibatalkan sinkron berikutnya lebih buruk daripada suntingan yang tak
pernah diterima — admin yang tidak bisa melihat itu terjadi akan mengulanginya.

`source` juga tidak diterima dari request. Pemanggil yang bisa menyatakan sebuah
grup `scim` sedang menyatakannya tak-bisa-disunting lewat satu-satunya permukaan
yang ada, tanpa direktori di belakangnya untuk menyuntingnya.

## Kenapa memberi grup sebuah PERAN memakai `access_control.assign`

Dua otoritas berbeda, dan menyatukannya adalah kesalahannya.

`user_groups.assign` memasukkan orang KE DALAM grup. `access_control.assign` —
yang sudah ada dan sudah berarti "membagikan peran" — adalah yang memberi grup
perannya, lewat endpoint yang sama dengan yang memberi orang perannya.

Membaliknya adalah jalur eskalasi tanpa nama yang jelas: administrator grup yang
juga bisa memberi peran kepada grupnya sendiri bisa memberi `owner` kepada grup
yang ia anggotai. Karena itu `assignRoleToGroup` juga menolak peran `is_system`,
sama seperti jalur per-orang — dan di sini penolakan itu lebih penting, karena
grant kepada grup menjangkau juga setiap orang yang ditambahkan NANTI.

## Tak ada `delete`

Memensiunkan grup bukan satu keputusan melainkan tiga: apa yang terjadi pada
grant yang dipegangnya, pada keanggotaannya, dan pada `external_id` yang besok
akan disodorkan direktori lagi. Mengirim `delete` sebelum ketiganya dijawab
akan menelantarkan grant (peran yang tak dipegang siapa pun menurut baris yang
masih menyatakan sebaliknya) atau menghancurkan satu-satunya catatan siapa
memegang apa.

Soft-delete SUDAH punya arti yang benar — `deleted_at IS NULL` ada di cabang
grup `activeRoleGrants`, jadi grup yang ditandai terhapus memberi NOL — tetapi
permukaan yang menyetelnya menunggu keputusan itu.

## Mencabut NOT NULL dari tabel otorisasi hidup

Kata-katanya terdengar persis seperti perubahan yang DITOLAK ADR-0078 terhadap
`awcms_access_assignments`, jadi perbedaannya layak ditulis: di sana yang
dicabut adalah **indeks unik**, yang salah ke arah **MEMBOLEHKAN** (dua baris di
tempat satu dulu diizinkan) tanpa satu pun gerbang memerah.

Di sini `NOT NULL` DIGANTI oleh CHECK yang lebih ketat di blok statement yang
sama: baris tanpa subjek, dengan dua subjek, atau dengan subjek yang tidak sesuai
diskriminatornya sendiri kini DITOLAK, padahal sebelumnya ia sekadar tidak bisa
direpresentasikan.

Satu konsekuensi yang mudah terlewat: indeks unik parsial atas grant aktif harus
mendapat saudara. `NULL` tidak sama dengan `NULL` di indeks unik, jadi indeks
lama berhenti membatasi apa pun begitu `tenant_user_id` boleh NULL — sebuah grup
akan bisa memegang peran yang sama di scope yang sama berapa kali pun.

## Yang DITOLAK

1. **Grup memberi permission langsung** — mode kegagalan senyap di atas.
2. **Permission `user_groups.grant` tersendiri** — jalur eskalasi di atas.
3. **`delete` untuk grup** — tiga keputusan yang belum dijawab.
4. **Gerbang `access:sod-fact-parity:check`** — digantikan oleh mekanisme yang
   lebih kuat, bukan dilewati.
5. **`UNION` alih-alih `UNION ALL`** di cabang grup — subjek bisa memegang peran
   yang sama langsung DAN lewat grup, dan tiap konsumen sudah men-dedupe apa yang
   perlu (`SELECT DISTINCT`, `EXISTS`). Membayar sort di jalur otorisasi untuk
   menghemat mereka nol adalah membayar di tempat yang paling mahal.
6. **Menerima `source` dari request** — lihat di atas.
7. **Mengaudit anggota grup saat grant peran diberikan** — daftar itu benar saat
   ditulis dan berhenti benar begitu ada yang bergabung. Yang diaudit adalah
   GRUP-nya; siapa yang terjangkau adalah pertanyaan keanggotaan, dan keanggotaan
   punya jejak auditnya sendiri.

## Konsekuensi

- `activeRoleGrants` kini `UNION ALL` dua cabang. Ia tetap SATU query, dan
  indeks `awcms_user_group_members_subject_idx` ada khusus untuk join itu.
- `GRANT_TABLES` gerbang pembaca bertambah dua nama: mengubah siapa yang ada di
  sebuah grup adalah mengubah otorisasi, jadi berkas yang melakukannya harus
  tercatat.
- Dua entri baru di `BOUNDED_BY_DESIGN` menaikkan plafonnya dari 3 ke 5. Plafon
  itu ada untuk memaksa percakapan, dan percakapannya terjadi: keempat entri
  adalah SATU argumen dalam dua paruh — tabel yang barisnya adalah grant
  buatan administrator, plus tabel yang dibatasi olehnya. Kenaikan berikutnya
  harus lebih sulit dari yang ini.
- Gelombang 3 selesai.
