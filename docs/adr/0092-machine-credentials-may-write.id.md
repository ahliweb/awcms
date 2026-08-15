🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0092-machine-credentials-may-write.md)

<!-- i18n-source-hash: sha256:8c0d7a777a079565190bbf3916265d67426d51ceb61c7076bbbdb67f0f391e88 -->

# ADR-0092 — Kredensial mesin boleh MENULIS, dan plafonnya tetap di kode

- **Status:** Diterima (2026-08-13).
- **Konteks:** Issue #423 Gelombang 8 PR 8.5 — PR terakhir program ini. Migrasi
  `sql/121`.
- **Membangun di atas:**
  [ADR-0049](0049-machine-credentials-and-session-introspection.md) (kredensial
  mesin, dan kalimat yang menahan segalanya: satu nilai di
  `MACHINE_CREDENTIAL_ALLOWED_ACTIONS`), dan
  [ADR-0090](0090-delegated-access-prints-a-real-tenant-user.md) (bentuk yang
  sama sekali lagi: plafon di kode, penyempit di baris).

## Keputusan

Sebuah kredensial mesin boleh menulis, dan aksi yang boleh ditulisnya adalah

```
MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS  ∩  allowed_write_actions
```

**Urutan itu bukan gaya penulisan.** Kalau daftar aksinya menjadi kolom MURNI,
satu restore backup, satu INSERT tangan, atau satu jalur provisioning yang
kehilangan `WHERE` bisa mencetak kredensial tulis se-katalog — **dengan setiap
gerbang di repo ini hijau**, karena tidak satu pun gerbang membaca isi baris.

Plafonnya karena itu tinggal di tempat yang hanya berubah lewat commit yang
di-review. Kolomnya bukan sumber kebenaran; ia daftar penyempit.

## Yang ada di plafon, dan aturan yang menjaganya jujur

`create` dan `update`. Tidak ada yang menghancurkan, tidak ada yang memberikan
otoritas, tidak ada yang tak bisa dibalik.

Dan sifat itu **dihitung, bukan dinyatakan**:

```
MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS ∩ HIGH_RISK_ACTIONS = ∅
```

diuji dari **konstanta hidup**. Daftar literal "yang high-risk" akan menyimpang
pada hari seseorang menambah aksi high-risk baru, dan menyimpang **diam-diam**.
Menurunkannya tidak bisa.

Menambah anggota ke plafon adalah ADR, dengan alasan yang sama ADR-0049
nyatakan untuk himpunan baca: setiap penambahan adalah kelas baru hal yang bisa
dilakukan token curian, dan ia **tak terlihat di diff endpoint** yang tiba-tiba
menerimanya.

## Ketiadaan IP adalah DENY, dan itu bagian yang paling mudah dilupakan

Kredensial tulis wajib terikat CIDR — CHECK basis data, bukan konvensi. Aturan
yang lebih halus hidup di gerbang: **bila `clientIp` tidak tersedia, kredensial
tulis ditolak.**

Tanpa itu, setiap rute yang belum meneruskan alamat pemanggil **diam-diam
mematikan kondisinya** — kontrol yang terbaca sebagai ditegakkan dan sebenarnya
tidak, kelas yang sudah dua kali muncul di gelombang ini. Gagal tertutup
membuat rute seperti itu menjawab 403, yang adalah laporan bug alih-alih
pelanggaran.

`defineTenantRoute` mengisinya untuk setiap rute yang dimilikinya, di **kedua**
jalurnya — termasuk SSE, tempat ia diresolusi sekali saat stream dibuka karena
satu koneksi panjang punya satu peer.

Parser CIDR-nya ditulis tanpa dependensi dan **menyempit saat ragu**: CIDR yang
tidak bisa di-parse tidak cocok dengan apa pun, alih-alih cocok dengan
segalanya. Arah itu adalah keputusan, dan diuji.

## Tiga puluh hari, bukan tiga ratus enam puluh lima

Kredensial baca boleh hidup setahun (ADR-0049 §5). Kredensial tulis tidak: ia
bisa mengubah data, dan waktu sampai seseorang menyadari ia bocor diukur dalam
minggu.

CHECK basis datanya 31 hari, satu hari lebih longgar, karena `created_at`
DEFAULT `now()` adalah instant **mulai transaksi** sementara `expires_at`
dihitung jam aplikasi — jebakan yang sama yang `sql/117` dokumentasikan.

## Dua sentinel, dan yang lama VERBATIM

`machine_credential_readonly` ada di sejarah decision log dan di ADR-0049.
Mendaur ulangnya untuk penolakan tulis akan **menulis ulang masa lalu** bagi
setiap konsumen log — sebuah baris lama akan mulai berarti sesuatu yang bukan
maksudnya saat ditulis.

Kelas tulis mendapat sentinel baru, `machine_credential_write_forbidden`.

## Konsekuensi

- Setiap kredensial yang ada sebelum migrasi ini **tetap baca-saja**:
  `allowed_write_actions` kosong, dan cabang pertama setiap CHECK dan setiap
  predikat benar untuk baris kosong. Tidak ada backfill, tidak ada validasi yang
  bisa gagal saat migrasi.
- Gerbangnya **deny-only** dan duduk di tempat yang sama seperti gerbang
  read-only sebelumnya: di atas `fetchGrantedPermissionKeys`, tempat tidak ada
  baris grant yang bisa memengaruhinya (aturan lintas-gelombang 1).
- Tidak ada permukaan penerbitan untuk kelas tulis di PR ini. Kolomnya ada,
  gerbangnya menegakkannya, dan yang bisa menuliskannya belum ada — sama seperti
  setiap PR di gelombang ini yang mendarat inert sebelum permukaannya.

## Ditolak

- **Daftar aksi sebagai kolom murni**, tanpa plafon di kode.
- **Daftar literal "aksi high-risk"** di test, alih-alih menurunkannya dari
  konstanta hidup.
- **Kondisi IP yang fail-open** ketika alamat pemanggil tidak diketahui.
- **Parser CIDR yang melebar saat ragu.**
- **Mendaur ulang sentinel `machine_credential_readonly`.**
- **Umur setahun untuk kredensial tulis.**
