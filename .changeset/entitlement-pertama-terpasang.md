---
"awcms": minor
---

feat(access): entitlement nyata pertama terpasang, dan ia menolak NOL tenant (ADR-0084, #423)

Gelombang 5 PR 5.4. `tenant_domain` mendeklarasikan `requiresEntitlement:
"custom_domain"` — pelekatan nyata pertama di base ini.

**Rencana menulis PR ini sebagai "pelekatan entitlement pertama". Bentuk itu
salah, dan baru terlihat setelah 5.1–5.3 mendarat.** Memasang deklarasi tanpa
apa pun yang lain akan menolak modul itu dari SETIAP tenant di SETIAP instalasi
turunan: `resolveModuleAvailability` menuntut langganan ber-status entitling atau
grant langsung, dan **tak ada tenant yang punya baris langganan sama sekali**.

`sql/111` karena itu menaruh entitlement itu di plan **default**, dan
`resolveModuleAvailability` memperlakukan tenant TANPA baris langganan sebagai
berada di plan default itu — konvensi "baris yang hilang bukan sebuah keputusan"
yang sama persis dipakai `awcms_tenant_modules` sejak `sql/008`. Nol baris
tenant-scoped ditulis, jadi tak ada backfill lintas-tenant dan tak ada toggle
`NO FORCE`.

Bentuk itu sendiri hasil koreksi: versi pertama menulis langganan saat tenant
lahir, dan `modules:table-writes:check` menolaknya — `awcms_tenant_subscriptions`
menjadi tabel yang ditulis `tenant_admin` DAN `identity_access`, yaitu
shared-table write yang dilarang ADR-0013 §6. Menurunkan default-nya alih-alih
menuliskannya menyisakan tepat satu penulis dan menghapus seluruh backfill.
Fallback-nya sengaja TIDAK berlaku saat baris langganan ADA tetapi statusnya tak
memberi hak: kasus itu adalah lapse, dan jatuh kembali ke plan default akan
diam-diam membatalkannya.

Yang dibeli pelekatannya: cabang itu kini **BENAR-BENAR DIJALANKAN** terhadap
baris nyata alih-alih tidak pernah dijalankan sama sekali — sambil menolak nol
orang. Operator turunan yang ingin menjual tingkatan menulis plan yang lebih
sempit sendiri; template ini tidak menjual keputusan produk yang bukan miliknya.

**Kenapa `tenant_domain`.** Domain kustom adalah fitur tingkatan yang paling
lazim, dan ini pelekatan yang paling bersih secara mekanis: tak ada yang
bergantung padanya, dan seluruh permukaan TERJAGA-nya adalah MANAJEMEN domain.
Resolusi host untuk domain yang sudah dikonfigurasi adalah jalur baca publik yang
tak pernah mencapai chokepoint — jadi tenant tanpa entitlement tetap dilayani di
domain yang sudah ia punya; hanya menambah dan mengubahnya yang ditolak.
Kehilangan kemampuan menambah domain adalah plan wall; kehilangan domain yang
sudah dipakai adalah gangguan layanan, dan pelekatan ini tidak bisa
menyebabkannya. `site_search` dan `comments` ditolak justru karena alasan
sebaliknya: keduanya punya permukaan publik tak-terautentikasi yang melewati
chokepoint.

`409 ENTITLEMENT_REQUIRED` di endpoint enable adalah **SOPAN SANTUN, bukan
kontrolnya** — chokepoint tetap menolak entah endpoint ini dipanggil atau tidak.
Tanpanya, enable berhasil, entri navigasi muncul, dan setiap klik menjawab 403
tanpa menjelaskan kenapa tombol yang baru saja dipakai tidak melakukan apa pun.
409 bukan 403: pemanggil MEMILIKI otoritasnya (ia lolos guard) — yang ia tak
punya adalah prasyarat komersialnya.

Test "gelombang ini inert" DIGANTI, bukan dihapus: yang layak dijaga tak pernah
"inert" melainkan "nol orang ditolak" — dan itu kini di-assert terhadap TEKS
migrasinya, karena migrasi adalah satu-satunya hal yang benar-benar menulis baris
itu. Dibuktikan dengan memutasi `sql/111`: menghapus pemetaan plan memerahkannya.
