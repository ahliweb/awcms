---
"awcms": patch
---

perf(admin): plafon aset TIDAK dinaikkan — biaya per layar yang diturunkan (#552)

Lima layar admin mendarat dalam satu hari dan `build:asset-budget:check` sampai di
176.670 B dari 180.000 B: sisa **3.330 B**, kira-kira dua layar lagi. Anggaran itu
melakukan persis tugasnya, dan perbaikan yang menggoda adalah menaikkannya.

IA TIDAK DINAIKKAN. Pengukurannya menjelaskan kenapa: potongan skrip per-halaman
berjumlah 98.379 B — **56% dari seluruh yang diunduh browser** — tersebar di 43
berkas yang hanya berbagi 1.039 B. Tiap layar menulis tangan sembilan pernyataan yang
sama: baca kotak pesan, jaga klik-ganda, kunci tombol, bersihkan kotak, kirim, reload
bila sukses, kalau tidak petakan kode error jadi kalimat lalu buka kunci. Sembilan
puluh dua titik reload bukan keluhan DRY — itu byte yang sama dikirim sembilan puluh
dua kali, dan sembilan puluh dua tempat perilaku saat gagal bisa menyimpang diam-diam.

`admin-form-client.ts` kini memiliki SIKLUS HIDUPNYA dan menyisakan bagi halaman dua
hal yang memang miliknya: apa yang dikirim, dan apa yang dikatakan saat gagal —
`messageBox`, `onSubmit`/`onSubmitAll`, `onAction`, `mutateAndReload`, plus `field`,
`inputValue`, `blankToNull`. Ke-36 layar dikonversi. Totalnya **176.670 → 153.970 B**;
sisa headroom **3.330 → 26.030 B**, dari perubahan yang tidak mengirim perilaku lebih
sedikit. Menaikkan plafon akan membeli headroom yang sama dengan cara menghapus
pertanyaannya. Presedennya ditulis di `scripts/client-asset-budget.ts`, bukan di pesan
commit, karena orang berikutnya yang mentok membaca berkas itu.

DUA CACAT NYATA IKUT KETEMU, dan keduanya berasal dari satu titik buta: `tsc` tidak
bisa mem-parse `.astro` sama sekali, dan `astro build` memakai esbuild yang membuang
tipe tanpa memeriksanya. Jadi seluruh perilaku klien di 40-an layar admin selama ini
dikirim TANPA typecheck:

- `/admin/comments` dan `/admin/blog-settings` memanggil `lockElement(button)` tanpa
  `busyLabel` yang wajib, sehingga setiap tombol moderasi menampilkan literal
  `"undefined"` selama requestnya berjalan — dan di `/admin/blog-settings` panggilan
  yang sama MELEMPAR ketika tombolnya tidak ada, karena `button` bertipe `| null`.
- `/admin/blog-settings` merender `result.message ?? "…"`, properti yang tidak pernah
  dikembalikan `sendJson`, sehingga fallback-nya satu-satunya pesan yang bisa muncul.

Maka gerbangnya ikut mendarat: **`check:astro-scripts:check`** mengekstrak tiap blok
`<script>` ke berkas `.ts` bersebelahan (direktori yang sama, supaya impor relatifnya
resolve persis seperti halamannya), menjalankan `tsc`, lalu menghapusnya di `finally`.
Berkas sisa dari run yang terputus MEMBUAT GERBANG GAGAL alih-alih ditimpa diam-diam —
berkas itu gitignored, jadi alternatifnya adalah berkas yang tak terlihat git dan
salah.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Gerbang barunya
dibuktikan MEMERAH dengan mengembalikan kedua cacat aslinya, satu per satu. Enam test
kontrak halaman ikut diperbarui karena bentuk sumbernya berubah — propertinya
dipertahankan, bukan dilemahkan: hitungan `Idempotency-Key` kini menghitung titik
panggil helper (dan tetap menuntut kunci baru per panggilan), tiap potongan sumber
dapat asersi panjang supaya penanda yang berhenti cocok tidak lolos secara hampa, dan
dua asersi membuang komentar dulu karena bloknya MENJELASKAN dalam prosa hal yang
justru dilarangnya. Dua mutasi lagi membuktikan asersi "tidak boleh reload" masih
menggigit: undangan yang me-reload `delivery: "unavailable"`, dan penerbitan kredensial
yang me-reload tokennya.
