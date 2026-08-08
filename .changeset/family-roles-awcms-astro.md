---
"awcms": patch
---

docs(keluarga): `awcms-astro` dinyatakan memikul halaman publik + admin USER; mini/micro ditegakkan sebagai arsip (ADR-0070)

Dua permintaan, dan hasil pemeriksaannya berbeda satu sama lain.

**Yang KURANG: peran `awcms-astro`.** Pada 8 Agustus 2026 repo sebelah
mendaratkan ADR-0034 — situs publik sebagai fungsi utama, plus permukaan admin
untuk seorang **USER** bila situsnya menyatakannya lewat `permukaanAdmin`,
dengan `owner` ditolak gerbang di sana. §Hubungan-nya menuliskan ketegangannya
dengan ADR-0051 repo ini secara terbuka lalu menutupnya dengan permintaan yang
tidak bisa ia penuhi sendiri: catat selisih ini sebagai divergence keluarga,
karena "repo ini tidak bisa menulisnya sendiri". Tidak ada satu pun ADR di sini
yang membolehkannya; ADR-0051 berbunyi **"seluruh layar admin … dibangun di repo
`awcms`"**, dan satu-satunya ADR yang pernah memberi `awcms-astro` peran admin
(ADR-0048) sudah di-supersede — lagipula peran yang diberikannya `owner`/internal,
persis yang ditolak gerbang di sana.

**Yang SUDAH ADA: penghentian mini/micro.** ADR-0047 membekukan keduanya dan
ADR-0055 §1 menutup jalur port keluar; keduanya final. Yang tertinggal bukan
keputusannya melainkan **penerapannya** — jadi tidak ada ADR ketiga yang
mengulanginya, hanya penyuntingan berkas yang belum menyusul.

- **[ADR-0070] MEMPERSEMPIT ADR-0051, tidak men-supersede-nya.** Sumbu pembagian
  layar bergeser dari AUDIENS (tenant vs owner/internal/platform) menjadi **APA
  YANG DIKELOLA**: admin **SISTEM** (modul, peran, tenant, jejak audit, apa pun
  lintas-tenant) tetap di sini di bawah satu shell `/admin/*`; admin **USER**
  (seseorang mengerjakan bagiannya sendiri di SATU situs) boleh di `awcms-astro`.
  Men-supersede akan mencabut ketiga gerbang pengganti ADR-0051 bersama
  keputusannya — kebalikan dari yang diinginkan.
- **Ketiga gerbang pengganti ADR-0051 dikutip utuh dan tidak dilonggarkan
  sedikit pun** — termasuk klausa penegakan butir 3 ("tetap ditolak endpoint-nya
  kalau ia menebak URL-nya"), yang justru bagian yang klaim "tidak dilonggarkan"
  bersandar padanya. Temuan terbukanya untuk `idn_admin_regions.dataset.configure`/`.restore`
  sudah **ditutup** ADR-0052 (`sql/084`) lalu ADR-0053 (`sql/085`, scope
  `platform`), dan ADR ini tidak mengubahnya. Yang membuat penyempitan ini murah
  adalah kalimat ADR-0051 sendiri: yang menahan aksi lintas-tenant adalah gerbang otorisasi, bukan alamat
  repo tempat tombolnya digambar.
- **Tidak ada kemampuan yang hanya ada di sana.** Setiap fitur yang dijangkau
  USER wajib juga bisa dikelola dari `/admin/*` di sini — jadi urutan kerjanya
  **`awcms` dulu, selalu**.
- **Entri `admin-user-surface-in-awcms-astro`** masuk `intentionalDivergences`
  (`owner: @ahliweb`, `reviewDate: 2027-02-04`, sekohort dengan empat entri lain).
  Yang ditinjau bukan apakah admin USER boleh di sana — itu diputuskan — melainkan
  apakah **batasnya** masih di tempat yang sama.
- **`family.role` di manifes dipersempit.** Ia satu-satunya pernyataan peran yang
  machine-readable, dan tidak ada tes yang meng-assert isinya — validator hanya
  menuntut string non-kosong. Itulah persis cara ia membusuk sampai mengklaim
  kepemilikan atas "every admin screen" berbulan-bulan setelah itu berhenti benar.
- **ADR-0047 statusnya diperbaiki** `Accepted` → `Superseded by ADR-0055`, sesuai
  Aturan 2 indeks ADR sendiri. Isinya TIDAK ditulis ulang (Aturan 2 juga — ADR ditandai, bukan ditulis ulang); yang
  ditambahkan hanya banner bahwa §Keputusan butir 1 ("porting _out_ stays
  encouraged") sudah tidak berlaku. Ini sisa mini/micro yang paling berbahaya,
  karena statusnya membuat jalur port-keluar terbaca sebagai keputusan HIDUP.

Yang hanya terasa saat mengembangkan:

- **Kedua README nol menyebut `awcms-astro`** dan menyatakan keluarga terdiri dari
  tiga repo, dua di antaranya arsip. Wajah publik repo ini karena itu tidak memuat
  repo pasangannya yang hidup. Diperbaiki di kedua bahasa beserta hash i18n-nya.
- **`AGENTS.md` memuat kontradiksi internal yang sudah ada sebelum ADR-0034 sisi
  sana:** tabel §"Di repo mana sebuah LAYAR dibangun" mengklaim `awcms` memikul
  "frontend PUBLIK", sementara tabel §"Di repo mana pekerjaan dilakukan" di berkas
  yang sama menyerahkan situs publik ke `awcms-astro`. Keduanya kini satu cerita.
- **`docs/awcms/family-compatibility.md` §5 memuat daftar yang 100% salah** —
  sembilan entri era-mini, sementara manifes memuat empat entri yang sama sekali
  berbeda, dan tidak ada gerbang yang membandingkan keduanya. Judul dokumennya
  pun masih "terhadap standar AWCMS-Mini", poros yang dicabut ADR-0055.
- **`awcms-sync-hmac` menggantungkan saklar keamanan pada repo arsip:**
  `SYNC_HMAC_ALLOW_LEGACY=false` disyaratkan menunggu `awcms-mini` diperbarui —
  syarat yang tidak akan pernah terpenuhi, sehingga celah pemalsuan v1 tidak akan
  pernah bisa dinyatakan tertutup. Dinyatakan ulang terhadap deployment nyata.
- **Provenance tidak disapu.** ~40 rujukan `sql/`, riwayat versi kontrak di
  `module-contract.ts`, asal-usul modul di `index.ts`, dan penanda
  `<!-- sql-refs: awcms-mini … -->` semuanya DIPERTAHANKAN: yang pertama fakta
  permanen, yang terakhir load-bearing (menghapusnya memerahkan `check:docs`).
  Yang diubah hanya kalimat yang memperlakukan mini/micro sebagai standar atau
  antrean kerja yang HIDUP.

**Nol perubahan kode berjalan, nol izin berpindah.** Ini keputusan tata kelola;
seluruh gerbang teknis tetap utuh. Gerbang `reviewDate` dibuktikan menggigit
dengan memundurkan tanggalnya, memastikan MERAH, lalu mengembalikannya.

**Ditemukan verifikasi adversarial, dan ikut diperbaiki di sini.** Empat lensa
membaca cabang ini sebelum ia di-push; yang mereka temukan bukan satu kesalahan
melainkan satu bentuk kesalahan yang berulang — pernyataan diperbarui di tempat
yang terlihat, dan tidak di tempat yang membantahnya.

- **ADR-0051 dan ADR-0055 kini membawa penanda balik.** Sebelumnya rujukannya
  satu arah, sehingga pembaca yang membuka ADR-0051 langsung — dan `AGENTS.md`
  menautkannya di tiga tempat — mendapat aturan yang sudah dipersempit tanpa
  tanda apa pun. Itu persis bentuk kegagalan yang §Alternatif ADR-0070 katakan
  ingin dicegah. Keduanya mendapat banner; kalimatnya tidak ditulis ulang.
- **Baris indeks ADR-0051** ikut ditandai `Accepted (dipersempit ADR-0070)` di
  kedua bahasa, meniru pola yang cabang ini sendiri pakai untuk ADR-0047.
- **Tiga banner SOP faktual salah dan dihapus, bukan diparafrase**:
  `08_sop_operasional_user_guide.md` menyatakan `blog_content`, `data_lifecycle`,
  dan business-scope/SoD "belum ada di repo ini" padahal ketiganya live sejak
  `sql/035`–`sql/040`, `sql/055`–`sql/056`, dan `sql/027`–`sql/030`. Cacat ini
  mendahului cabang ini; tidak ada gerbang yang mengadu klaim "belum ada di
  `src/modules`" dengan isi `src/modules/`.
- **`src/modules/_shared/family-contract.ts`** — satu-satunya pernyataan poros
  keluarga yang ada di KODE — masih menyatakan dirinya deklarasi konformansi ke
  standar `awcms-mini`, membantah header manifes yang cabang ini sendiri sunting
  ("self-anchored since ADR-0055").
- Ditambah: rujukan "Aturan 3" yang sebenarnya Aturan 2, tanggal ADR-0052 yang
  tertulis 2 Agustus padahal 1 Agustus, alasan tidak memperluas ADR-0065 yang
  dibantah `COMMITTED_PATHS` di kodenya sendiri, daftar permukaan publik yang
  menghilangkan keluarga `/news/**` sambil mengatasnamakan ADR-0059, satu jangkar
  tautan rusak yang lahir di cabang ini, dan baris §11 `standar-performa-dan-keamanan.md`
  untuk divergence kelima.
