🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0120-the-admin-redesign-splits-one-hue-into-three-roles.md)

<!-- i18n-source-hash: sha256:18d9d0960581f3a08d3e0b1524cd1e5c99200d6a7746058271e0632a0932db23 -->

# ADR-0120 — redesign admin membelah satu hue menjadi tiga peran, dan menggerbangi pembelahannya

- **Status:** Accepted
- **Tanggal:** 2026-09-02
- **Pengambil keputusan:** ahliweb
- **Men-supersede:** tidak ada. Ia MENGUBAH nilai token di [`docs/awcms/14_ui_ux_design_system.md`](../awcms/14_ui_ux_design_system.md) §Design tokens, dan itu perubahan standar sehingga wajib ber-ADR (AGENTS.md §"Aturan wajib").
- **Terkait:** `src/styles/tokens.css`; `src/styles/admin.css`; `src/styles/admin-screens.css`; `src/styles/auth.css`; `src/layouts/AdminLayout.astro`; `src/lib/ui/admin-icons.ts`; `src/lib/ui/admin-command-palette.ts`; `src/modules/module-management/domain/sidebar-menu.ts`; `scripts/design-token-contrast-check.ts`; `scripts/client-asset-budget.ts`; Issue #434 dan PR #720 (dua kemunculan sebelumnya dari cacat yang digerbangi ini)

## Konteks

Referensi desain untuk permukaan admin diberikan sebagai kanvas Claude Design
(`redesign/AWCMS Admin.dc.html`) yang mencakup sebuah shell — topbar, sidebar
bergrup, command palette — dan sepuluh layar. Mengadopsinya sebagian besar
pekerjaan biasa. Tiga hal di dalamnya tidak, dan itulah alasan ADR ini ada.

### 1. Pasangan warna yang paling naluriah GAGAL WCAG, dan sudah gagal dua kali sebelumnya

Kanvas memakai satu pasangan tint di mana pun status ditampilkan: `--color-X`
sebagai teks di atas `--color-X-soft` sebagai latar. Chip status di setiap baris
tabel, tautan sidebar aktif, chip filter terpilih, bar seleksi massal.

Diukur di tema terang:

```
primary  #2563eb di atas #e8effc   4.48:1   GAGAL
success  #12873d di atas #e4f5ea   4.07:1   GAGAL
warning  #b45309 di atas #fdf1de   4.50:1   tepat di ambang, tanpa sisa
danger   #dc2626 di atas #fdeaea   4.17:1   GAGAL
info     #0e7490 di atas #e0f2f6   4.65:1   lolos
```

Tiga dari lima gagal 4.5:1 yang dijanjikan
[`docs/awcms/14_ui_ux_design_system.md`](../awcms/14_ui_ux_design_system.md)
§Aksesibilitas, dan yang keempat tidak punya sisa ruang.

**Ini kali KETIGA dan KEEMPAT repo ini menemukan kelas cacat yang sama.**

1. Issue #434 menemukan `--color-primary` dengan teks putih pada 3.68:1 di tema
   gelap. Obatnya keluarga token `-strong`, dan `tokens.css` membawa docblock
   bagus yang menjelaskannya.
2. PR #720 menemukan cacat yang SAMA lagi di varian `info` `StatusBadge` —
   3.68:1 terang, 2.43:1 gelap — di berkas yang komentarnya sendiri sudah
   menjelaskan aturan yang dilanggarnya.
3. dan 4. Redesign ini, ke arah sebaliknya: teks pekat di atas tint pucat, plus
   `--color-text-faint` yang lolos di `--color-surface` (4.63:1) sambil gagal di
   `--color-surface-3` (4.39:1) — yaitu latar `<thead>`, tempat token itu paling
   banyak dipakai.

Polanya konsisten: satu hue diminta melayani lebih dari satu latar, dan nilai
yang benar untuk kasus umum salah untuk kasus lainnya. Prosa sudah empat kali
gagal menghentikannya.

### 2. Garis batas kontrol yang tidak mengidentifikasi apa pun

Terpisah dari itu, `--color-border` mengukur **1.29:1** (terang) dan **1.34:1**
(gelap) terhadap permukaannya. WCAG 2.1 **1.4.11 Non-text Contrast** (level AA)
menuntut 3:1 untuk "informasi visual yang diperlukan untuk mengidentifikasi
komponen antarmuka". Isian input berbeda 1.03:1 dari kartu di sekelilingnya,
jadi garis itu satu-satunya yang memberi tahu di mana kotak isian berada.

Ini sudah ada sebelum redesign — `#d8dee6` yang lama mengukur 1.35:1 — dan tidak
terlihat karena belum ada yang bisa melihatnya.

### 3. Field kontrak yang dideklarasikan, divalidasi, dan mati

`ModuleDescriptor.navigation[].icon` sudah ada di kontrak modul, diperiksa
validator komposisi, dan diteruskan melalui `SidebarDefaultEntry` dan
`ComposedEntry` sejak sidebar di-port. Tidak ada modul yang mengisinya dan
`AdminLayout.astro` tidak pernah membacanya. Redesign butuh ikon per entri nav.

## Keputusan

### Satu hue, tiga peran, tiga keluarga token

Sebuah warna status kini punya sampai tiga nilai, masing-masing dinamai menurut
pekerjaannya:

| Keluarga    | Pekerjaan                                       | Contoh                            |
| ----------- | ----------------------------------------------- | --------------------------------- |
| `--color-X` | teks atau border di atas `--color-surface`      | tautan; `.btn-danger` bergaris    |
| `-strong`   | isian pekat di bawah `--color-primary-contrast` | `.btn-primary`; disk avatar       |
| `-on-soft`  | teks di atas `--color-X-soft`                   | chip status; tautan sidebar aktif |

`-strong` sudah ada (Issue #434). `-on-soft` ditambahkan di sini untuk kelima
hue status. `--color-border-strong` ditambahkan untuk kasus 1.4.11, dan
`--color-border` SENGAJA mempertahankan nilai hairline-nya — 1.4.11 mengatur
batas yang mengidentifikasi komponen yang bisa dioperasikan, bukan pemisah
dekoratif, dan menggelapkan tepi kartu serta garis tabel akan mengubah permukaan
padat menjadi kisi.

Setiap nilai diukur, di kedua tema, terhadap setiap permukaan yang memuatnya.

### Pengukurannya adalah GERBANG, bukan komentar

`bun run design:token-contrast:check` (masuk rantai `bun run check`) membaca
`tokens.css`, meresolusi tema gelap sebagai lapisan override di atas terang, dan
menegakkan registry berisi 25 pasangan latar/depan — 50 pengukuran di dua tema.

Ia registry, bukan sapuan, dengan alasan yang sama yang diberikan
`i18n:screens:check` untuk tidak memindai atribut: sapuan atas semua kombinasi
token melaporkan ratusan pasangan yang tidak pernah dirender dan melatih
pembacanya untuk mengabaikannya. Setiap entri menyebut aturan yang
merendernya, jadi pasangan baru di CSS tanpa entri di sini terlihat saat review
sebagai aturan tanpa entri. Token yang disebut sebuah pasangan lalu hilang
adalah kegagalan, jadi rename tidak bisa diam-diam menghentikan pengukuran.

Ia MENOLAK nilai yang tidak bisa diurainya (`rgb()`, `color-mix()`, hex 3 digit)
alih-alih melewatinya, karena gerbang yang diam-diam mengabaikan input adalah
mode "hijau padahal salah" yang berulang kali ditemukan repo ini.

**Versi pertamanya sendiri hijau karena alasan yang salah**, dan bug-nya dicatat
di dalam skrip: `indexOf(':root[data-theme="dark"]')` cocok dengan selector itu
di dalam KOMENTAR header `tokens.css` sendiri, sehingga tema "gelap" diam-diam
mewarisi seluruh nilai terang. Sekarang ia diikat ke awal baris.

### Field `icon` yang mati menjadi hidup

`DEFAULT_SIDEBAR_ICONS` di `sidebar-menu.ts` memetakan `labelKey` ke nama ikon,
dan `buildDefaultSidebarModel` meresolusi `nav.icon ?? resolveSidebarIcon(...)`
— jadi deskriptor yang mendeklarasikan ikonnya sendiri MENANG dan field kontrak
itu nyata, sementara tidak ada modul yang harus disunting agar default-nya
bekerja. `labelKey` dipakai sebagai kunci karena ia sudah digerbangi
kelengkapannya dua arah.

Data path hidup di `src/lib/ui/admin-icons.ts`, dan `resolveAdminIcon` tidak
pernah memantulkan kembali nama yang tak dikenal, jadi nilai deskriptor yang
salah ketik merender titik netral alih-alih menaruh teks sembarang ke dalam
atribut SVG.

### Shell memiliki judul halaman

`AdminLayout` merender satu pita header — breadcrumb, `<h1>`, deskripsi, dan
slot `page-actions`. Seluruh 45 layar yang dulu merender
`<header class="page-header">` sendiri berhenti melakukannya. Sebelum ini setiap
layar menampilkan namanya DUA KALI: sekali dari prop `title` layout dan sekali
dari `<h1>` miliknya sendiri, sering dalam dua bahasa berbeda, karena 20 prop
itu literal Inggris sementara `<h1>`-nya `t(...)`.

Segmen tengah breadcrumb DITURUNKAN dari sidebar yang sudah dikomposisi, bukan
dioper halaman — `composeSidebarSections` sudah menandai entri saat ini, dan
meminta 45 halaman menyebut seksinya sendiri akan mengulang persis drift yang
dulu disebabkan prop `active` yang sudah dihapus.

### Typeface di-host sendiri, dan anggaran aset ketiga

Kanvas menetapkan Public Sans dan JetBrains Mono lewat Google Fonts, yang
diblokir CSP `default-src 'self'` repo ini. Keduanya di-host sendiri (lima
subset `woff2` latin/latin-ext, 104.004 B) — satu-satunya cara typeface itu bisa
tampil sama sekali di bawah kebijakan yang sudah ada, dan ia tidak melebarkan
CSP satu origin pun.

`scripts/client-asset-budget.ts` mendapat audiens `font` dengan plafonnya
sendiri alih-alih melipat font ke `APP_BUDGET_BYTES`. Tugas anggaran itu adalah
"menangkap pertumbuhan lambat satu layar admin pada satu waktu"; perubahan
langkah 104 KB di dalam plafon 193.500 B akan menuntut plafonnya kira-kira
digandakan, dan plafon yang digandakan tidak mendeteksi apa pun. Aturan
per-berkasnya juga dibelah menurut jenis — premis angka 27.000 B adalah "sebuah
island membundel dependensi", yaitu premis tentang skrip, dan ia sudah dua kali
dipatahkan oleh stylesheet admin.

## Konsekuensi

### Yang didapat

- Janji AA di dokumen 14 kini DITEGAKKAN, bukan sekadar dinyatakan. Gerbangnya
  gagal pada keempat cacat historis: mengembalikan `--color-success-on-soft` ke
  token polos mereproduksi 4.07:1 dan memerah; begitu juga memulihkan garis
  kontrol hairline, dan begitu juga notasi warna yang tak bisa diurai.
- Satu perubahan pada `tokens.css` menggeser seluruh 48 layar admin, karena NAMA
  token tidak berubah — hanya nilainya, plus keluarga tambahan.
- `ModuleDescriptor.navigation[].icon` adalah field yang melakukan sesuatu.

### Biayanya, dinyatakan terus terang

- **Tiga keluarga lebih banyak dipelajari daripada satu.** Siapa pun yang
  menambah warna status kini harus memutuskan latar mana yang memuatnya.
  Gerbangnya yang membuat keputusan itu terlihat alih-alih opsional, dan tabel
  di atas adalah kunci jawabannya.
- **Registry kontras tidak otomatis.** Pasangan baru yang ditambahkan ke CSS
  tanpa baris di `PAIRS` tidak diukur. Dua hal menahannya: `renderedBy` membuat
  pasangan tak-terdaftar terlihat saat review, dan registry gagal bila token
  yang disebutnya hilang.
- **`--color-border-strong` terlihat lebih gelap dari kanvas referensi.** Kanvas
  tidak diukur terhadap 1.4.11; janji dokumen 14 lebih mengikat daripada nilai
  kanvas.
- **`--color-text-faint` juga menyimpang dari kanvas** (`#8b959f`/`#6d7883`
  mengukur 3.04:1 dan 3.87:1). Ia membawa header kolom tabel dan timestamp
  audit — informasi, bukan dekorasi.
- **Anggaran APP naik 193.500 → 218.000.** Diukur: JS +1.369 B (seluruh command
  palette), CSS +19.466 B, seluruhnya di dua stylesheet yang memang sudah dimuat
  setiap layar. Bukan bentuk duplikasi Issue #552; justru sebaliknya, karena 45
  layar melepas markup header-nya sendiri.
- **Admin kini mengirim 104 KB font.** Latin saja, ber-`unicode-range` sehingga
  58.264 B di antaranya tak bersyarat. Locale yang butuh skrip lain harus
  menambah subsetnya, dan `FONT_BUDGET_BYTES` adalah tempat keputusan itu
  terlihat.
- **Lipatan seksi sidebar tidak diingat.** `<details open>` di setiap seksi,
  tanpa apa pun yang mempersistenkan togglenya — dipilih di atas skrip karena
  kontrol CSS-saja jelas lebih baik di bawah CSP ini, dan karena seksi yang
  diingat-terlipat menyembunyikan layar dari orang yang tidak tahu ia bisa
  dilipat.

### Sengaja TIDAK diadopsi dari kanvas

- **PENGALIH tenant.** Kanvas menggambar pil tenant dengan chevron dropdown.
  `awcms_tenant_users` mengikat satu identitas ke tepat satu tenant, jadi tidak
  ada yang bisa dituju; header `TenantBadge.astro` sendiri sudah berargumen
  bahwa kontrol yang tampak seperti pengalih yang dinonaktifkan lebih buruk
  daripada tanpa kontrol. Pil dan tile mark-nya diadopsi; chevron-nya tidak.
- **Klaster akun dua baris.** Kanvas menampilkan nama tampilan di atas email.
  `SsrContext` tidak membawa keduanya, dan query ketiga per render `/admin/*`
  untuk chrome tidak sepadan. Satu baris — daftar peran — yang memang selalu
  ditampilkan topbar ini.
