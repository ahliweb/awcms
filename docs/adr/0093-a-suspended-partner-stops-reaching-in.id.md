🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0093-a-suspended-partner-stops-reaching-in.md)

<!-- i18n-source-hash: sha256:d5de06477ba3d1e8d7de9c2a97b2900489f9743bcdad5c1c659c9dea42328bda -->

# ADR-0093 — Partner yang di-suspend BERHENTI menjangkau, dan grant-nya tetap ada

- **Status:** Diterima (2026-08-13).
- **Konteks:** Issue #543. Migrasi `sql/124`.
- **Membangun di atas:**
  [ADR-0089](0089-a-partner-is-an-ordinary-tenant.md) (partner adalah tenant
  biasa; registri milik platform),
  [ADR-0073](0073-suspension-is-a-service-state-not-a-login-state.md)
  (suspensi ditegakkan di chokepoint, bukan oleh job),
  [ADR-0084](0084-an-entitlement-refuses-it-never-grants.md) (entitlement
  MENOLAK, ia tidak pernah mencabut yang sudah berjalan), dan
  [ADR-0090](0090-delegated-access-prints-a-real-tenant-user.md) /
  [ADR-0091](0091-two-sided-attribution.md) (aktor terdelegasi adalah tenant
  user nyata dengan atribusi dua sisi).

## Kenapa ADR, dan kenapa sekarang

`sql/116` memberi `awcms_partners` sebuah kolom `status` yang dipatok ke
`'active'` oleh CHECK, dan menuliskan syaratnya sendiri di header berkasnya:

> PR 8.4 melebarkan CHECK ini di PR yang sama dengan pembacanya, atau tidak
> sama sekali.

Mengirim partner yang BISA di-suspend sebelum ada yang MEMBACA suspensi adalah
kontrol yang terbaca sebagai ditegakkan padahal tidak — bentuk yang sama yang
`sql/106` pakai untuk `scope_type`. Jadi pertanyaannya bukan "tambah kolom",
melainkan **apa arti partner tersuspensi**, dan itu tiga keputusan.

## Keputusan 1 — Suspensi MENGHENTIKAN jangkauan yang sedang berjalan

Bukan hanya menolak keterlibatan baru.

Preseden terdekat menunjuk dua arah, dan perbedaannya adalah alasannya:

- **ADR-0084** memutuskan bahwa entitlement **menolak** dan tidak pernah
  mencabut yang sudah berjalan. Alasannya proporsionalitas: entitlement adalah
  gerbang KOMERSIAL, dan memutus pekerjaan yang sedang berjalan karena sebuah
  paket berubah adalah hukuman yang tidak sebanding dengan sebabnya.
- **ADR-0073** memutuskan bahwa tenant tersuspensi **berhenti dilayani seketika
  di chokepoint**, sesi yang sudah terbit sekalipun. Alasannya ditulis di
  sana: sebelum itu, mensuspend tenant mematikan situs publiknya seketika
  sementara setiap sesi admin yang sudah terbit tetap berkuasa penuh sampai
  kedaluwarsa sendiri — "pelanggan kehilangan apa yang dilihat pengunjungnya
  dan tetap memegang apa yang bisa mengubah datanya".

Suspensi partner adalah kelas yang KEDUA. Ia bukan perubahan paket; ia tindakan
terhadap pihak yang jangkauannya ke dalam data pelanggan justru sedang ingin
dihentikan. Suspensi yang hanya menolak keterlibatan BARU akan membiarkan
setiap aktor terdelegasi yang sudah masuk terus bekerja — persis kegagalan yang
ADR-0073 namai, dipindahkan satu tingkat ke luar.

Karena itu penegakannya di **chokepoint**, bukan job. Job meninggalkan jendela;
chokepoint dievaluasi per-request.

## Keputusan 2 — Grant yang hidup TIDAK ikut mati

`sql/120` sengaja membuat grant **hidup lebih lama** dari kemitraannya, dan
alasannya ditulis di sana: "siapa yang pernah bisa melihat data kami, dan
sampai kapan" harus tetap terjawab SESUDAH vendornya diberhentikan — justru
terutama sesudah itu.

Suspensi karena itu tidak mencabut, tidak menghapus, dan tidak menyentuh satu
baris grant pun. Ia membuat grant itu **tidak berlaku**, bukan tidak ada. Baris
tetap sebagai catatan; akses yang diberikannya berhenti.

Bentuk ini sudah punya nama di repo: "status adalah cache, `effective_to` vs
`now()` adalah gerbang sebenarnya" (`isSoDConflictExceptionCurrentlyValid`).
Keberlakuan DIHITUNG, tidak disimpan — sehingga tidak ada dua tempat yang bisa
menyimpang, dan memulihkan partner memulihkan jangkauannya tanpa ada yang harus
menulis ulang apa pun.

Kalau kelak sebuah keputusan MEMANG ingin membunuh grant saat suspensi, ia
membatalkan `sql/120` dan wajib mengatakannya. ADR ini tidak.

## Keputusan 3 — Sesi anggota terdelegasi yang sedang berjalan ikut berhenti

Konsekuensi langsung dari Keputusan 1: kalau penegakannya di chokepoint, tidak
ada yang perlu memutus sesi. Sesi tetap ada dan setiap keputusan yang dimintanya
ditolak, persis bentuk ADR-0073 untuk tenant tersuspensi.

## Bagaimana chokepoint bisa membacanya sama sekali

Ini pertanyaan pertama Definition of Ready, dan repo ini sudah membayarnya dua
kali (ADR-0087 dan ADR-0088 sama-sama merencanakan pembacaan lintas-tenant yang
FORCE RLS larang).

`awcms_partners` milik tenant PLATFORM dan ber-FORCE RLS. Chokepoint berjalan di
tenant PELANGGAN. Ia **tidak bisa** membaca tabel itu — dan rencana apa pun yang
mengandaikan sebaliknya sudah salah sebelum ditulis.

Tiga jalan, dan dua ditolak:

- **Denormalisasi status ke baris milik pelanggan.** Platform juga tidak bisa
  menulis baris pelanggan di bawah RLS, jadi ini menuntut job per-tenant — yang
  membawa kembali jendela yang Keputusan 1 tolak, plus dua salinan yang bisa
  menyimpang.
- **Mencabut FORCE RLS dari registri.** Menukar isolasi tenant demi satu
  pembacaan.
- **Fungsi SECURITY DEFINER sempit** — yang dipilih, dan yang sudah
  diantisipasi header `sql/116` sendiri ("dilayani fungsi SECURITY DEFINER
  sempit, preseden `sql/048`").

`awcms_partner_registry_status(p_partner_tenant_id uuid) RETURNS text` menjawab
SATU pertanyaan dan tidak mengembalikan baris apa pun. Keempat pengaman
`sql/048`/`sql/119` berlaku, dengan role pemilik yang SAMA (`awcms_partner_view`,
NOLOGIN, tanpa anggota) — dan satu batasan tambahan yang khas di sini: ia
mengembalikan **teks status, bukan baris**, sehingga tidak ada kolom registri
lain yang bisa bocor lewatnya, dan tidak ada `WHERE` yang bisa dilupakan
pemanggilnya.

**Tidak dikenal berarti MENOLAK.** `NULL` (tidak ada baris registri) diperlakukan
sama dengan tersuspensi. Itu tak terjangkau hari ini — FK `sql/120` menuntut
partner terdaftar selama ada grant — dan justru karena tak terjangkau, memilih
fail-closed tidak bisa mematahkan apa pun yang berjalan.

## Yang MENOLAK, dan di mana

| Titik                              | Apa yang berubah                                                           |
| ---------------------------------- | -------------------------------------------------------------------------- |
| chokepoint                         | aktor `delegated` yang partnernya bukan `active` → 403 `PARTNER_SUSPENDED` |
| `POST /access/partner-engagements` | menyewa partner tersuspensi ditolak                                        |
| `POST /access/delegated-grants`    | predikat `EXISTS` di dalam INSERT ikut menuntut partner `active`           |

Yang ketiga di dalam statement, bukan mendahuluinya, dengan alasan `sql/120`:
pemeriksaan TypeScript sebelum INSERT adalah TOCTOU; predikat di statement yang
sama tidak bisa.

## Siapa yang boleh men-suspend

`identity_access.partner_registry.disable` dan `.restore`, keduanya
`scope = 'platform'` seperti dua saudara mereka di `sql/123`. Suspensi adalah
pernyataan platform tentang siapa yang boleh menjadi partner di deployment ini
— bukan keputusan pelanggan tentang tenantnya sendiri, yang sudah punya
namanya sendiri (`partner_access.configure`, dan pelanggan bisa memutus
kapan saja tanpa meminta siapa pun).

Aksi `disable`/`restore` dipakai ulang alih-alih `suspend`/`reinstate` baru:
keduanya sudah ada di `AccessAction`, dan `tenant_admin.tenant_lifecycle`
memakai pasangan yang sama untuk tindakan yang sama bentuknya.

## Ditolak

- **Menyamakan suspensi partner dengan suspensi tenant partner.** ADR-0073 sudah
  mensuspend tenant, dan itu menghentikan partner dilayani DI TENANTNYA SENDIRI
  — bukan di tenant pelanggan. Ia juga terlalu tumpul: tenant partner bisa saja
  pelanggan berbayar atas haknya sendiri, dan memutus bisnisnya karena
  kemitraannya bermasalah adalah hukuman yang salah sasaran.
- **`status` bebas-teks.** CHECK dilebarkan ke dua nilai persis, bukan dibuka.
  Nilai ketiga kelak adalah satu DROP/ADD CONSTRAINT lagi, di PR yang sama
  dengan pembacanya — aturan `sql/116` tetap berlaku untuk dirinya sendiri.
