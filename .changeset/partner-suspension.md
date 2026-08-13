---
"awcms": minor
---

feat(auth): partner yang di-suspend BERHENTI menjangkau, dan grant-nya tetap ada (ADR-0093, #543)

`sql/116` menulis syaratnya sendiri di header berkasnya: pelebaran CHECK `status` mendarat
di PR yang **SAMA** dengan pembacanya, atau tidak sama sekali. Mengirim partner yang BISA
di-suspend sebelum ada yang MEMBACA suspensi adalah kontrol yang terbaca sebagai
ditegakkan padahal tidak. Jadi pertanyaannya bukan "tambah kolom" melainkan **apa arti
partner tersuspensi** — tiga keputusan, dan ADR-0093 menjawab ketiganya.

**(1) SUSPENSI MENGHENTIKAN JANGKAUAN YANG SEDANG BERJALAN**, bukan hanya menolak
keterlibatan baru. Preseden menunjuk dua arah dan perbedaannya adalah alasannya: ADR-0084
(entitlement MENOLAK, tak pernah mencabut) adalah gerbang KOMERSIAL, sementara ini
tindakan terhadap pihak yang jangkauannya ke data pelanggan justru sedang ingin
dihentikan — kelas ADR-0073, yang sudah mencatat kegagalannya: "pelanggan kehilangan apa
yang dilihat pengunjungnya dan tetap memegang apa yang bisa mengubah datanya". Karena itu
penegakannya di **chokepoint, bukan job**: job meninggalkan jendela, dan jendelanya persis
saat yang penting.

**(2) GRANT YANG HIDUP TIDAK IKUT MATI.** `sql/120` sengaja membuatnya hidup lebih lama
dari kemitraannya, karena "siapa yang pernah bisa melihat data kami, dan sampai kapan"
harus tetap terjawab SESUDAH vendornya diberhentikan. Suspensi membuat grant **tidak
berlaku, bukan tidak ada**: keberlakuan DIHITUNG per-request, jadi tidak ada dua tempat
yang bisa menyimpang, dan memulihkan partner memulihkan jangkauannya tanpa ada yang
menulis ulang satu baris pun. Sebuah test membuktikan hitungan grant TIDAK berubah saat
suspensi.

**(3) SESI TERDELEGASI YANG BERJALAN IKUT BERHENTI**, konsekuensi langsung dari (1) —
tidak ada yang perlu memutus sesi, setiap keputusan yang dimintanya ditolak.

**CHOKEPOINT TIDAK BISA MEMBACA REGISTRI SECARA LANGSUNG**, dan itu pertanyaan pertama
Definition of Ready. `awcms_partners` milik tenant PLATFORM dan ber-FORCE RLS; chokepoint
berjalan di tenant PELANGGAN. Rencana yang mengandaikan sebaliknya sudah salah sebelum
ditulis — jebakan yang memakan ADR-0087 dan ADR-0088 berturut-turut. Pembacaannya lewat
fungsi SECURITY DEFINER sempit `sql/124` yang mengembalikan **teks, bukan baris**, dengan
keempat pengaman `sql/048` dan pemilik memberless yang sama dari `sql/119`. Denormalisasi
ke baris pelanggan ditolak (menuntut job, membawa balik jendelanya, dan dua salinan yang
bisa menyimpang); mencabut FORCE RLS ditolak.

**TIGA PEMBACA, dan yang kedua serta ketiga DI DALAM STATEMENT:** chokepoint (403
`PARTNER_SUSPENDED`), penyewaan kemitraan, dan predikat `EXISTS` di dalam INSERT grant.
Di dalam statement, bukan mendahuluinya, dengan alasan yang `sql/120` sudah tulis:
pemeriksaan TypeScript sebelum INSERT adalah TOCTOU, dan platform bisa memenangi balapan
itu dengan men-suspend di antara dua statement. Predikatnya memaksa INSERT penyewaan
berubah dari `VALUES` menjadi `INSERT … SELECT`, karena `VALUES` tidak bisa membawa
predikat — dan itu justru buktinya.

**`NULL` BERARTI MENOLAK.** Tidak ada baris registri diperlakukan sama dengan tersuspensi.
Itu tak terjangkau hari ini — FK `sql/120` menuntut partner terdaftar selama ada grant —
dan justru karena tak terjangkau, fail-closed tidak bisa mematahkan apa pun yang berjalan.

**DUA PERMISSION, bukan satu:** `partner_registry.disable` dan `.restore`, keduanya
PLATFORM. Menghentikan partner menjangkau dan mengizinkannya kembali adalah dua otoritas,
dan yang satu tidak menyiratkan yang lain. Layar `/admin/partner-registry` mendapat kedua
tombolnya, digerbangi terpisah.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Tiga mutasi memerahkan test
yang tepat: `NULL` yang jatuh ke "izinkan", pemeriksaan status yang pindah ke DEPAN INSERT
(TOCTOU-nya), dan gerbang chokepoint yang pindah ke BAWAH pengambilan grant. Empat test
E2E baru berjalan terhadap Postgres nyata di CI: CHECK dibuktikan **MENOLAK** nilai
ketiga, pelanggan dibuktikan tidak bisa SELECT registri sementara fungsinya menjawab,
suspensi dibuktikan tidak menyentuh satu baris grant pun, dan penyewaan partner
tersuspensi dibuktikan 409.
