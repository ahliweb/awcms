---
"awcms": minor
---

feat(auth): partner adalah tenant biasa — jangkauan adalah DATA, bukan permission (ADR-0089, #423)

Gelombang 8 PR 8.1, `sql/116` — PR pertama gelombang terakhir.
`ModulePermissionScope` tetap `tenant | platform`. **Tidak ada nilai `partner`,
sekarang maupun nanti**, dan penolakannya kini digerbangi alih-alih sekadar
dicatat. Sebagai gantinya dua tabel yang mendarat INERT: `awcms_partners` dan
`awcms_partner_managed_tenants`.

KALIMAT YANG DIJAGA VERBATIM, KARENA ORANG BERIKUTNYA AKAN MENGUSULKANNYA LAGI:
`scope` mengatur siapa yang boleh MEMEGANG sebuah permission; kemitraan mengatur
OBJEK MANA yang disentuhnya. Menyatukan keduanya menghasilkan permission yang
dipegang dengan benar dan dijalankan terhadap TENANT YANG SALAH — dan tidak satu
pun policy RLS akan keberatan, karena aktornya memang terautentikasi secara sah
di suatu tempat. Itu bukan kegagalan yang berbunyi; itu kegagalan yang lolos
setiap gerbang. Siapa yang boleh MENJADI partner dijawab permission
ber-`scope: "platform"` yang sudah ada (ADR-0053); tenant mana yang DIJANGKAU
dijawab sebaris data di tenant target. Tidak ada aktor yang bisa melakukan
keduanya, dan itulah seluruh keamanan model ini.

SISI MANA YANG MEMILIKI TIAP BARIS ADALAH PERTANYAAN PERTAMA, DAN RENCANA
GELOMBANG INI HANYA MENJAWABNYA UNTUK TABEL GRANT. Di bawah FORCE RLS sebuah
baris hanya punya SATU `tenant_id` yang policy-nya kenali, jadi relasi antar-dua
tenant harus memilih sisi — dan memilih salah menghasilkan tabel yang hijau di
setiap gerbang dan tak terbaca oleh pihak yang justru harus membacanya.
`awcms_partner_managed_tenants` memilih tenant TARGET: pelanggan wajib bisa
melihat dan mencabut setiap jangkauan ke tenantnya tanpa meminta izin siapa pun.
Pandangan partner atas bukunya sendiri adalah kenyamanan, bukan kontrol, dan
dilayani fungsi `SECURITY DEFINER` sempit SAAT PR 8.4 MEMBERINYA PEMANGGIL —
fungsi definer tanpa pemanggil adalah permukaan serang tanpa manfaat. Bentuk
ketiga, satu baris di tiap sisi, ditolak: setiap pencabutan harus menemukan
keduanya dan kegagalannya senyap serta permanen, kelas yang sama dengan proyeksi
keanggotaan yang ditolak ADR-0088.

`awcms_partners` MEMILIH TENANT PLATFORM, DAN ITU DIPAKSA — BUKAN DIPILIH.
Bentuk yang wajar dibayangkan lebih dulu, satu baris ber-`tenant_id` tenant
partner itu sendiri, TIDAK BISA DITULIS SIAPA PUN: tenant platform yang
bertindak sebagai dirinya sendiri tidak dapat menyisipkan baris ber-`tenant_id`
tenant lain, dan satu-satunya sisa jalur adalah pendaftaran-mandiri kemitraan
komersial. Jadi barisnya milik platform dan MENYEBUT tenant lain — bentuk
`awcms_tenant_status_transitions` (`sql/092`) sejak ADR-0054.

FK MENEGAKKAN APA YANG `SELECT` TIDAK BOLEH MELIHAT. Pemeriksaan foreign key
MELEWATI RLS, jadi pelanggan dapat menamai partner yang barisnya tidak akan
pernah bisa ia baca: basis data menolak tenant yang bukan partner terdaftar
tanpa memberi siapa pun kemampuan mengenumerasi daftar partner. Bahwa FK
melewati RLS biasanya BAHAYA di repo ini — ia yang menuntut FK komposit pada
tabel office (#149) — dan perbedaannya ditulis supaya tidak "diperbaiki" oleh
orang yang mengenali polanya tetapi bukan alasannya.

PELANGGAN YANG MEMULAI, SELALU: tidak ada satu pun penulisan lintas-tenant di
model ini. Arah sebaliknya sengaja tidak dibangun, dan bila kelak dibutuhkan
bentuknya sudah ada di ADR-0082 — yang menyeberangi batas adalah token, bukan
pembacaan maupun penulisan.

`status` DIPATOK SATU NILAI oleh CHECK, preseden `awcms_invitation_policies.scope_type`
(`sql/106`): kolomnya ada supaya pelebaran kelak satu DROP/ADD CONSTRAINT, dan
CHECK-nya ada karena partner yang BISA di-suspend sebelum ada yang MEMBACA
suspensi adalah kontrol yang terbaca sebagai ditegakkan padahal tidak.

Keduanya inert dan harus tetap begitu sampai 8.4: `activeRoleGrants` (ADR-0079)
tidak membacanya dan TIDAK BOLEH diajari, keduanya bukan `GRANT_TABLES`, dan
pembaca PR 8.4 hanya boleh MENYEMPITKAN — pemetaan adalah prasyarat, bukan
pemberian, dan tidak pernah menghasilkan `allowed: true`.

DIVERIFIKASI DENGAN MENJALANKAN. `sql/116` di-apply dari nol pada Postgres 16
nyata dan keempat constraint-nya dibuktikan MENOLAK, bukan sekadar ada. Tiga
mutasi memerahkan test yang tepat: menambahkan `partner` ke union, mengganti
nama tipenya (membuktikan asersi source tidak hampa), dan menghapus entri
registry.

Satu hal yang perlu dilihat reviewer: `BOUNDED_BY_DESIGN` naik 13 → 15, dan
kenaikan ini TIDAK memenuhi bar yang ditulis PR 7.3 ("argumen keempat, bukan
tabel keempat belas yang mengulang salah satu dari tiga"). Kedua tabel mengulang
argumen KEPENGARANGAN, dan itu dinyatakan apa adanya. Bar itu ada untuk mencegah
tabel yang tumbuh mengikuti TRAFIK diparkir di sana; membacanya harfiah di sini
memaksa novelty palsu atau deskriptor `generic` yang akan menghapus partner
hidup dan memutus setiap keterlibatan pelanggan. Bar-nya diganti yang lebih
tajam: kenaikan berikutnya wajib membawa argumen keempat ATAU memendekkan daftar
di tempat lain.
