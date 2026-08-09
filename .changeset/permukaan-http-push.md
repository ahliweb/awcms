---
"awcms": minor
---

feat(push): permukaan HTTP — perangkat sendiri self-service, sisanya lewat chokepoint

Lima endpoint mendarat di `/api/v1/push`, dan pembelahannya adalah keputusan
otorisasi, bukan penataan berkas.

## Perangkat SENDIRI tidak punya permission, dan itu disengaja

`GET|POST /api/v1/push/subscriptions` dan `DELETE …/{id}` memakai
`defineSelfServiceTenantRoute` (ADR-0049 §7): subjeknya adalah pemanggil, dan
jawaban atas "boleh saya berlangganan di browser ini?" adalah "Anda sedang
memegang sesinya". Rute-rute itu **tidak pernah menerima `tenantUserId`** — ia
datang dari sesi yang di-resolve, jadi tak ada id untuk dibandingkan dengan apa
pun.

Menciptakan `push_delivery.subscriptions.create` justru akan menjadi jebakan
latent-authz yang sudah pernah kena di repo ini (ADR-0058 §E): aksi yang tak
di-seed role mana pun menolak **semua orang termasuk owner**, sementara kode
pemanggilnya terbaca seolah tergerbangi dengan benar. Notifikasi push adalah
untuk pengguna biasa; tembok permission di depannya adalah tembok di depan
fiturnya.

Yang menyentuh baris orang lain atau membuat deployment mengirim trafik nyata
tetap lewat chokepoint — tiga permission (`sql/094`), dan itu seluruhnya:
`diagnostics.read`, `messages.cancel`, `diagnostics.check`.

## Rute self-service ikut membawa cek suspensi

ADR-0073 menjadikan `suspended` status LAYANAN, dan chokepoint menegakkannya
untuk setiap rute tergerbangi. Rute self-service tidak lewat sana, jadi ia
memeriksanya sendiri — kalau tidak, satu-satunya kelas endpoint yang melewati
guard menjadi satu-satunya tempat tenant tersuspensi masih bisa menambah
kapasitas keluar.

## Empat hal yang halus

**Pencabutan oleh pengguna menghancurkan endpoint tersimpan.** Beda dari
`disablePushSubscription`, yang mencatat apa kata push service tentang endpoint
yang sudah mati dan menyimpannya sebagai bukti: yang ini mencatat apa kata
ORANGNYA tentang endpoint yang mungkin masih hidup sempurna. Baris tetap ada,
kredensialnya tidak.

**`endpoint = EXCLUDED.endpoint` di upsert adalah pasangan wajibnya.** Tanpa
pemikiran di atas ia terlihat mubazir — target konflik adalah HASH dari kolom
itu sendiri, jadi di setiap kasus biasa nilainya identik. Ia ada untuk satu
kasus: perangkat yang berlangganan ulang setelah dicabut akan kembali `active`
sambil masih menunjuk nisan — sehat di konsol, tak terkirimi pada kenyataannya.

**Kepemilikan ada di `WHERE`, bukan di baca-lalu-bandingkan.** Tak ada jendela
di antara keduanya, dan tak ada keputusan yang harus diambil tentang baris yang
sudah terbaca tapi tak boleh disentuh — persis cara oracle keberadaan lahir
tanpa sengaja. "Tidak ada", "milik orang lain", dan "sudah dicabut" menjawab
404 yang sama.

**`POST /api/v1/push/test` mengirim ke perangkat pemanggil sendiri, dengan teks
tetap.** Endpoint uji yang menerima penerima adalah permukaan
notifikasi-sembarang: teks bermerek sistem, dipilih pengirim, dengan target
klik, di lock screen kolega mana pun. Probe-nya perlu ada karena push gagal di
tempat yang tak bisa dilihat apa pun di sistem ini — kunci VAPID yang tak cocok,
service worker di scope salah, izin OS yang ditahan diam-diam — dan ketiganya
menghasilkan antrean yang terkuras bersih dan perangkat yang tak menampilkan
apa-apa.

## Satu bug yang hanya ketahuan karena diuji

`isBlockedAddress` **gagal-tertutup untuk apa pun yang bukan literal IP** —
benar di tempat ia biasa dipanggil (alamat hasil resolusi), fatal di sini:
dipanggil langsung ia menjawab "diblokir" untuk
`https://updates.push.services.mozilla.com/…` juga. Pendaftaran akan mustahil
untuk **setiap** push service nyata, dengan pesan error yang menyebut alamat
privat. Pertanyaan literal-IP kini hanya DIAJUKAN ketika host-nya memang
literal.

Setengah pertanyaan yang bergantung DNS sengaja **tidak** dijawab saat
pendaftaran: jawaban DNS di sini sudah basi saat pengiriman. Otoritasnya tetap
`ssrfSafeFetch` di jalur kirim, yang me-resolve tepat sebelum menyambung.

## Yang belum

Modul tetap `experimental`: ADR-0021 kriteria 1 menolak modul `active` tanpa
layar admin, tanpa pengecualian, dan konsolnya belum ada. Tiga permission-nya
tercatat sementara di ledger satu-arah `NOT_YET_SCREENED` — bukan tiga
keputusan, tiga baris yang dijadwalkan dihapus.
