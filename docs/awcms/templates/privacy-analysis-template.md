# Analisis privasi — <nama fitur/modul>

- **Issue / PR:** `#<nnn>` · **Tanggal:** `<tanggal>` · **Penulis:** `<nama>`
- **Kelas perubahan:** `<lihat tabel di alur-pengembangan.md>`

> Isi ini adalah langkah 3 untuk satu perubahan. Bila ketiga jawaban di bawah
> adalah "tidak ada data pribadi baru", satu paragraf sudah cukup dan itu hasil
> yang normal — daftar ini ada supaya jawabannya **ditulis**, bukan supaya
> panjang.

## 1. Data pribadi apa yang baru?

Yang dikumpulkan, ditampilkan, atau diteruskan keluar oleh perubahan ini dan
sebelumnya tidak ada di sistem.

| Data | Di kolom/tabel mana | Dari siapa | Dilihat siapa |
| ---- | ------------------- | ---------- | ------------- |

Bila kosong: tulis "tidak ada", dan lanjut ke §4.

## 2. Berapa lama, dan apa yang menghapusnya?

- Tabel baru → deskriptor `dataLifecycle`-nya (gerbang `data-lifecycle:table-coverage:check` menuntutnya).
- Kolom baru pada tabel lama → retensinya mengikuti tabelnya; **periksa apakah itu masih benar** untuk data baru ini.
- "Selamanya" → keputusan yang harus terlihat, dengan alasannya.

## 3. Siapa yang bisa melihatnya?

- Ber-tenant → RLS + chokepoint; sebutkan permission-nya.
- **GLOBAL/tanpa RLS** → hampir selalu ADR. Sebutkan kontrol penggantinya.
- Keluar dari sistem (email, webhook, provider) → sebutkan ke mana dan apa yang dibawa.

## 4. Redaksi dan log

Apakah nilai barunya bisa mendarat di `awcms_audit_events`, decision log, atau
log aplikasi? Bila ya, apakah kuncinya sudah tercakup `REDACTION_KEYS`
(`src/modules/_shared/redaction.ts`)? Nama kunci baru yang tidak cocok pola
apa pun **tidak** ter-redaksi.

## 5. Hak subjek data

Apakah perubahan ini membuat data yang harus bisa diekspor atau dihapus atas
permintaan? Bila ya, catat bahwa basis ini **belum** punya alur per-subjek
([`../privacy-analysis.md`](../privacy-analysis.md) §4) dan bagaimana operator
menanganinya sementara ini.
