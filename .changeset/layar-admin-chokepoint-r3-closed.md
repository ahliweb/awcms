---
"awcms": minor
---

feat(auth): R3 DITUTUP — ke-32 layar admin memutuskan di chokepoint (#450)

Lima layar terakhir — `data-lifecycle`, `security`, `seo`, `site-search`,
`blog-presentation` — berpindah ke `loadAdminScreen`. **Kedua ledger kini
kosong**: `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` dan bagian layar admin di
`NOT_YET_MIGRATED`.

Tidak ada lagi layar admin yang memutuskan akses dari `ssr.permissions.has(...)`.
Setiap render kini melewati evaluasi kebijakan ABAC, `resolveModuleAvailability`,
fakta business-scope, SoD saat-aksi, dan `recordDecisionLog`.

## Tiga hal yang diporting VERBATIM, bukan "diperbaiki"

`data-lifecycle` menerima **lima** request entry, dua di antaranya **tulis**
(`legal_hold.create`, `plan.analyze`). Itulah `showAnything` selama ini: konsol
ini mengizinkan siapa pun yang bisa melakukan apa pun di sini, termasuk orang
yang boleh memasang legal hold tanpa bisa mendaftar hold yang sudah ada.
Memangkasnya ke tiga baca akan diam-diam mengunci mereka.

`security` memakai `mfa_admin.reset` sebagai gerbang BACA panel MFA. Modul ini
tidak menyeed satu pun aksi baca MFA; permission reset itulah yang selama ini
menggerbanginya. Diporting apa adanya, bukan "dikoreksi" ke permission yang
tidak ada.

`blog-presentation` memilih section aktif dari permission baca. Pemilihan itu
pindah ke DALAM `load`, karena section mana yang tersedia kini jawaban
chokepoint, dan fallback-nya harus dihitung dari jawaban yang sama. Helper
file-local `can(activity, action)`-nya hilang — itu helper yang membuat
`admin:screen-coverage:check` menumbuhkan matcher penyelesai-helper-nya.

## Gerbangnya diperketat, karena mutasi membuktikan ia bocor

Setelah ledger kosong, saya menanam bypass nyata ke `users.astro` untuk menguji
gerbangnya. Ia **hijau**: keluar dengan kode 0 sambil baris ringkasannya sendiri
berbunyi *"1 still decide outside the chokepoint"*.

Sebabnya kelonggaran se-BERKAS: sebuah layar yang memanggil `loadAdminScreen`
untuk entry-nya boleh tetap memutuskan sebuah AFFORDANCE dari
`ssr.permissions.has(...)`. Itu benar selama migrasi — layar setengah-jadi tidak
boleh dilaporkan dua kali — dan salah begitu layar terakhir mendarat: ia jalan
masuk kembali, satu tombol demi satu tombol.

Rute mempertahankan kelonggaran itu (`defineTenantRoute` membungkus di level
modul dan memanggil chokepoint sendiri, jadi ia benar-benar menutupi tiap
handler di berkas). Layar tidak: satu berkas `.astro` = satu jalur render, jadi
tidak ada handler saudara yang pantas ikut tertutupi. Asimetrinya dipatok test
di kedua arah.

## Dua alarm yang menjadi inert pada nol, diganti

Self-test detektor berbunyi "nol layar memutuskan sementara ledger tidak kosong
= detektor rusak". Itu persis cek yang mati saat layar terakhir dimigrasikan:
sejak itu nol adalah jawaban yang BENAR, dan nol dari detektor yang rusak tidak
bisa dibedakan darinya. Diganti **probe sintetis** — `sliceScreen` ditanya
tentang layar yang pasti bypass dan layar yang pasti tidak; keduanya harus
benar, pada ukuran ledger berapa pun.

Kedua, gerbang kini menuntut setiap layar benar-benar **TERUTE**, bukan sekadar
diam: layar yang tidak membaca permission apa pun DAN tidak membuka chokepoint
akan lolos filter bypass tanpa tertutupi apa pun.

Aturan "hanya boleh menyusut" juga kehilangan penegaknya pada nol — entri basi
adalah temuan, tetapi pada daftar kosong tidak ada yang bisa basi. Jadi
`tests/access-chokepoint.test.ts` meng-assert kekosongan itu langsung.

Ketiga arah kegagalan diuji dengan menanam cacatnya dan memastikan gerbangnya
MERAH, bukan sekadar memastikan ia hijau hari ini.
