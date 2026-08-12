---
"awcms": minor
---

feat(auth): memilih tenant, dan berpindah antar tenant, tanpa pernah bisa mengotorisasi (ADR-0088, #423)

Gelombang 7 PR 7.4, `sql/115` — PR terakhir gelombang ini. Login tanpa
`x-awcms-tenant-id` berhenti menjadi `400 TENANT_REQUIRED` dan menjadi
`409 MEMBERSHIP_SELECTION_REQUIRED` ber-token seleksi (≤120 detik, sekali pakai),
ditukar di `POST /api/v1/auth/session/tenant` menjadi sesi pada tenant yang DISEBUT
PEMANGGIL. `POST /api/v1/auth/session/switch` memindahkan sesi hidup.

INVARIAN PALING BERBAHAYA DI SELURUH PROGRAM #423, DAN IA DITEGAKKAN DI PERNYATAAN
PERTAMA GERBANG: token seleksi tidak boleh pernah mengautentikasi
`authorizeInTransaction`. Jenis bearer dibawa namespace hash (`pt-sha256:`, meniru
ADR-0049 persis), diperiksa sebelum apa pun, 401 keras tanpa satu query pun —
sehingga "nol baris decision log" benar secara konstruksi, bukan secara inspeksi.
Ditolak DI SANA meski hash itu toh tidak akan cocok dengan baris sesi mana pun,
karena kecocokan itu kebetulan penyimpanan dan invarian ini tidak boleh bergantung
padanya. Test-nya memakai transaksi palsu yang MENGGAGALKAN test bila gerbang
menyentuh basis data sama sekali; memindahkan penolakan ke bawah lookup sesi
memerahkan empat test sekaligus.

`409` TIDAK MEMBAWA DAFTAR KEANGGOTAAN, DAN ITU KEPUTUSAN. Rencana Gelombang 7 —
dan komentar index PR 7.1 sendiri — mengasumsikan `awcms_identities (principal_id)`
bisa menjawab "setiap keanggotaan manusia ini". DIUKUR terhadap basis data nyata
berisi satu manusia di dua tenant: 1 baris di dalam konteks tenant, dan NOL tanpa
konteks. Tabelnya FORCE RLS. Ini kelas temuan yang sama dengan baris audit
lintas-tenant yang ditolak ADR-0087 — dua PR berturut-turut rencananya
mengasumsikan pembacaan yang policy-nya larang. Proyeksi keanggotaan global akan
membuatnya mungkin dan DITOLAK: ia harfiah direktori keanggotaan lintas-tenant yang
ADR-0087 tolak dalam wujud lain, ia menciptakan kewajiban penulis baru yang
kegagalannya senyap dan permanen, dan ia menambah tabel global keempat. Pemanggil
menyebut tenantnya sendiri.

TOKEN SELEKSI HIDUP SEBAGAI DUA KOLOM DI `awcms_principals`, BUKAN TABEL KELIMA.
Satu baris per PERCOBAAN login tanpa-tenant akan tumbuh mengikuti trafik dan
menuntut deskriptor retensi, job purge, hak `DELETE` worker, dan entri gerbang —
untuk baris berumur 120 detik. Satu token hidup per manusia; menerbitkan yang baru
menimpa yang lama. Penebusan adalah compare-and-swap: predikat menegaskan ulang
hash DAN kedaluwarsa di dalam statement yang menghapusnya, jadi dua penebusan
konkuren tidak bisa dua-duanya menang.

MENUKAR TOKEN ADALAH LOGIN YANG SETENGAH SELESAI, BUKAN PENYERAHAN KUNCI.
`evaluateTenantEntry` — dipakai bersama, bukan disalin — menerapkan ulang
serviceability (ADR-0073), keanggotaan, kebijakan auth tenant tujuan, dan terutama
kebijakan MFA tenant tujuan. Melewatkan yang terakhir membuat perpindahan tenant
menjadi bypass MFA ke dalam tenant yang justru mewajibkannya. Assurance tidak ikut
berpindah: sesi baru selalu `aal1`, kalau tidak step-up tenant A memuaskan tuntutan
tenant B.

ATURAN NON-SWITCHABLE MENUTUP PENGAMBILALIHAN YANG SETIAP LANGKAHNYA SAH: sesi
ber-`origin_auth` `sso` atau `handoff` tidak boleh berpindah. Tanpa itu,
administrator IdP tenant B meng-assert `alice@corp.com` — alamat yang boleh diklaim
IdP-nya sendiri — menerima sesi B yang sah, lalu berpindah ke tenant A tempat Alice
sebenarnya bekerja. Yang membuat perpindahan aman hanyalah kredensial GLOBAL, yang
tak satu tenant pun bisa menerbitkan. Sesi hasil perpindahan membawa nilai
`origin_auth` keempat `switch` — nilai yang `sql/100` cadangkan dan sengaja tidak
tambahkan ke CHECK sampai ada yang bisa memproduksinya.

DIVERIFIKASI DENGAN MENJALANKAN. `sql/115` di-apply dari nol pada Postgres 16
nyata; CHECK pemasangan kolom dan index uniknya dibuktikan MENOLAK, bukan sekadar
ada. Suite baru `tests/tenant-selection-e2e.test.ts` (15 test, route-level, terdaftar
di kedua workflow) hijau, dan tiga mutasi nyata memerahkan test yang tepat:
menghapus aturan non-switchable, menghapus predikat kedaluwarsa, dan memindahkan
penolakan gerbang ke bawah.

Satu koreksi dokumen di luar cakupan tetapi searah: `standar-performa-dan-keamanan.md`
mengklaim `checkSharedRateLimit` dipakai di "18 berkas rute". Hitungan nyata 26 —
sudah basi enam berkas SEBELUM PR ini menambah dua. Dokumen yang dipakai menjawab
auditor tidak boleh meremehkan kontrolnya sendiri.
