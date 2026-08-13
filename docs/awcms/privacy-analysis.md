# Analisis privasi (langkah 3 alur pengembangan)

> **Yang dijawab dokumen ini:** data pribadi apa yang dipegang TEMPLATE ini,
> berdasarkan apa ia disimpan selama itu, dan di mana klaim itu **ditegakkan**
> alih-alih sekadar dinyatakan.
>
> **Yang TIDAK dijawab dokumen ini, dan tidak bisa:** dasar hukum pemrosesan,
> penunjukan DPO, perjanjian pemroses data, dan transfer lintas-yurisdiksi.
> Semuanya adalah fakta tentang **deployment dan organisasi yang memakainya**,
> bukan tentang kodenya. Sebuah template yang berpura-pura menjawabnya akan
> memberi operator rasa aman yang tidak dibelinya apa pun.

- **Langkah alur:** 3 ([`alur-pengembangan.md`](alur-pengembangan.md)).
- **Pasangannya:** [`20_threat_model_security_architecture.md`](20_threat_model_security_architecture.md)
  menjawab "siapa penyerangnya"; dokumen ini menjawab "data siapa yang ada di
  sini". Keduanya langkah 3 dan keduanya wajib.
- **Template per-fitur:** [`templates/privacy-analysis-template.md`](templates/privacy-analysis-template.md).

## 1. Aturan yang membuat dokumen ini tidak menua

Setiap klaim di bawah menunjuk ke tempat yang **digerbangi**. Itu bukan gaya
penulisan — ia satu-satunya alasan halaman ini bisa dipercaya enam bulan lagi.

| Jenis klaim                    | Di mana ia ditegakkan                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| berapa lama data disimpan      | deskriptor `dataLifecycle` per tabel + `data-lifecycle:table-coverage:check` — **setiap tabel wajib menjawab**, dan yang tidak menjawab memerahkan build |
| apa yang tidak boleh masuk log | `_shared/redaction.ts`, dipanggil `recordAuditEvent` sebelum INSERT                                                                                      |
| siapa boleh membaca apa        | RLS `FORCE` + chokepoint default-deny (`security:readiness`, `access:chokepoint:check`)                                                                  |
| apakah tabel baru terlewat     | tidak bisa: tabel `awcms_%` tanpa RLS harus terdaftar ber-alasan di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`                                                  |

Halaman ini **sengaja tidak** menyalin angka retensi per tabel. Salinan itu akan
basi pada hari pertama seseorang mengubah deskriptornya, dan angka basi di
dokumen privasi lebih berbahaya daripada tidak ada angka sama sekali.

## 2. Kategori data pribadi yang dipegang basis ini

Diturunkan dari skema nyata, bukan dari ingatan.

### 2.1 Identitas dan kredensial

| Data                        | Di mana                                                                  | Catatan                                                                                            |
| --------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| alamat login (email)        | `awcms_identities.login_identifier`, `awcms_principals.email_normalized` | Sejak ADR-0085 alamatnya juga hidup **global** — satu manusia, satu baris principal, lintas tenant |
| hash kata sandi             | `awcms_principals.password_hash`                                         | Hash, tidak pernah plaintext. Kolom per-tenant menjadi peninggalan                                 |
| nama tampilan / nama legal  | `awcms_profiles.display_name`, `legal_name`                              | Diisi manusia; template tidak memvalidasi bentuknya                                                |
| rahasia MFA + recovery code | `awcms_principal_mfa_factors`, `awcms_principal_mfa_recovery_codes`      | Terenkripsi (konstruksi `sql/024`), global sejak ADR-0087                                          |

**Konsekuensi yang harus dibaca operator:** tiga tabel di atas **GLOBAL, tanpa
RLS** (ADR-0085/0087). Isolasinya bukan RLS melainkan empat kontrol pengganti,
salah satunya gerbang `identity:principal-access:check` yang membatasi berkas
mana boleh menyebut tabel itu sama sekali.

### 2.2 Aktivitas dan jejak

| Data                 | Di mana                    | Catatan                                                                                    |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| jejak audit tindakan | `awcms_audit_events`       | `attributes` **di-redaksi sebelum INSERT** (`_shared/redaction.ts`)                        |
| keputusan otorisasi  | `awcms_abac_decision_logs` | Tabel terbesar di repo; hanya kode kebijakan + alasan statis, tanpa nilai atribut          |
| sesi                 | `awcms_sessions`           | Hash token, bukan token                                                                    |
| analitik pengunjung  | `awcms_visitor_*`          | `ip_hash` / `user_agent_hash` / `visitor_key_hash`, **HMAC ber-salt** — bukan nilai mentah |

Kunci redaksi yang berlaku hari ini ada di `REDACTION_KEYS`
(`src/modules/_shared/redaction.ts`) dan mencakup antara lain `password`,
`token`, `secret`, `npwp`, `nik`, `phone`, `whatsapp`, `email`, `cookie`, plus
sinonim alamat IP yang dicocokkan **persis** (`ip`, `clientip`, `xforwardedfor`)
— substring akan merusak `description` dan `shipping`.

### 2.3 Data yang dimasukkan pengguna akhir

`awcms_comments`, `awcms_form_drafts`, dan modul domain yang ditambahkan di
`src/modules/`. **Basis ini tidak tahu apa yang akan dimasukkan ke sana**, dan
itulah sebabnya template per-fitur di bawah menuntut jawabannya per fitur alih-
alih menebak di sini.

### 2.4 Data lintas-organisasi (Gelombang 8)

Sejak ADR-0090, seorang manusia dari organisasi LAIN bisa menjadi anggota sebuah
tenant. Konsekuensi privasinya dinyatakan supaya tidak ditemukan belakangan:

- alamat orang itu **masuk** ke `awcms_identities` tenant target saat penebusan;
- setiap tindakannya membawa `actor_tenant_id` + `delegated_grant_id`
  (ADR-0091), sehingga pelanggan bisa menjawab "apa yang dilakukan vendor kami";
- id operator platform **sengaja tidak** menyeberang ke log pelanggan — ia uuid
  buram yang tak bisa mereka resolusi sekaligus identifier pihak ketiga.

## 3. Tiga pertanyaan yang wajib dijawab SETIAP fitur baru

Ini isi langkah 3 untuk sebuah perubahan, dan jawabannya masuk ke PR-nya:

1. **Data pribadi apa yang fitur ini kumpulkan atau tampilkan yang sebelumnya
   tidak ada di sistem?** "Tidak ada" adalah jawaban yang sah dan paling sering
   benar — tetapi ia harus ditulis, bukan diasumsikan.
2. **Berapa lama ia disimpan, dan apa yang MENGHAPUSNYA?** Bila jawabannya
   sebuah tabel baru, deskriptor `dataLifecycle`-nya adalah jawabannya dan
   gerbangnya sudah menuntutnya. Bila jawabannya "selamanya", itu keputusan yang
   harus terlihat.
3. **Siapa yang bisa melihatnya, dan apa yang menghentikan orang lain?** Untuk
   data ber-tenant, jawabannya RLS + chokepoint. Untuk apa pun yang GLOBAL,
   jawabannya harus lebih panjang dan biasanya berarti ADR.

## 4. Hak subjek data — posisi template, dinyatakan jujur

| Hak                  | Yang disediakan basis ini                                                                                                             | Yang belum ada                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| akses / portabilitas | deskriptor `subjectData` per-tabel + dua gerbang, **dan endpoint ekspornya** (`POST …/subject-requests/export`, ADR-0094 gelombang 2) | —                              |
| penghapusan          | alur "hapus orang ini" **maker/checker** (`…/erase` + `…/{id}/decide`), lima mode penghapusan per-tabel                               | —                              |
| koreksi              | permukaan admin untuk profil dan identitas                                                                                            | —                              |
| pembatasan/keberatan | penonaktifan tenant user + pencabutan sesi                                                                                            | tidak ada penandaan per-tujuan |

**KOREKSI 13 Agustus 2026.** Dua baris pertama tabel ini sebelumnya berbunyi
"endpoint ekspornya belum ada" dan "alur hapus orang ini belum ada". Keduanya
**sudah dibangun** oleh Issue #557 — jangan bangun ulang, dan jangan mengutip
versi lama dokumen ini sebagai bukti celah.

**Urutannya disengaja, dan itulah bagian yang layak diingat.** #542 mendaratkan
fondasinya lebih dulu dan menyisakan **139 tabel di ledger utang**; #557 menolak
mendaratkan endpoint di atas ledger itu, karena ekspor yang menjawab dengan 3
tabel dan diam untuk 139 sisanya adalah laporan yang **ditandatangani dan tidak
lengkap** — lebih buruk daripada tidak ada laporan. Jadi #557 membayar utangnya
sampai habis lebih dulu: **139 → 0** (147 tabel = 140 berdeskriptor + 7 ditolak
beralasan), baru kemudian membangun permukaannya.

Konsekuensinya untuk pembaca hari ini: pertanyaan _tabel mana yang harus dijawab
sebuah permintaan_ — bagian yang paling mahal bila dibangun belakangan — sudah
terjawab untuk seluruh skema, dan dijaga dua gerbang yang menanyakan hal
berbeda: `subject-data:coverage:check` (apakah setiap tabel menjawab) dan
`subject-data:registry:check` (apakah jawabannya benar terhadap `sql/`).
Ekspornya **menyatakan cakupannya sendiri**: tabel yang sengaja tidak dijawab
(global, atau tanpa kolom subjek) ikut disebut dalam laporan, karena laporan
per-tenant yang diam-diam menghilangkan `awcms_principals` tidak bisa dibedakan
dari laporan yang ditulis sebelum tabel itu ada.

Penghapusan adalah **maker/checker** (ADR-0094 Keputusan 3): peminta tidak
pernah bisa menyetujui permintaannya sendiri, ditegakkan empat lapis — dua
permission terpisah, aturan SoD `critical`, CHECK constraint, dan satu UPDATE
kondisional. Ekspor dan penghapusan adalah **dua otoritas berbeda**: memegang
hak membaca bukan alasan memegang hak menghancurkan.

Subjeknya adalah **tenant user, dijawab per tenant**. Tidak ada satu tombol
"lupakan saya di mana-mana", dan itu bukan penyederhanaan: tiap tenant adalah
pengendali data yang terpisah, dan FORCE RLS memodelkan hal yang benar.

## 5. Yang hanya bisa dijawab operator

- Dasar hukum tiap kegiatan pemrosesan.
- Apakah organisasi itu pengendali atau pemroses, dan perjanjian yang menyertai.
- Lokasi penyimpanan dan transfer lintas-yurisdiksi — fakta deployment
  ([`environments.md`](environments.md)), bukan fakta kode.
- Kewajiban pemberitahuan pelanggaran dan tenggatnya.
- Retensi **aktual** yang dipilih: deskriptor punya `retentionMinDays`/`MaxDays`
  dan sebuah default; angka yang berlaku adalah yang di-set deployment.
