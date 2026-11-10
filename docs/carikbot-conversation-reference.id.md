🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](carikbot-conversation-reference.md)

<!-- i18n-source-hash: sha256:4bd94446289cd4e1f093b84cf796cd35e0d7d192fe6fc316a575c99ac8f9ad60 -->

# Referensi Konsep CarikBot — Percakapan, Layanan, dan Batas Arsitektur

**Versi dokumen:** v1.0.0 · **Terakhir diperbarui:** 2026-11-10 · **Status:** riset F0, usulan, bukan fitur terimplementasi atau rilis.
**Document changeset:** Adaptasi konseptual CarikBot tanpa porting kode, dilengkapi batas kewenangan, keamanan, contoh, dan syarat implementasi.

## Bukti dan riwayat teknis
Carik memakai arsitektur chatbot berbasis intent/entity/handler dan dokumentasinya mengaitkan Carik Engine dengan SimpleBOT, SimpleAI, FastPlaz dan Free Pascal. [CarikBot/ecosystem](https://github.com/CarikBot/ecosystem) menunjukkan katalog paket, alur menu berbasis XMind/Freemind yang diubah menjadi JSON, service API dan respons teks/menu/tombol/formulir. Konsep yang dipelajari **tidak membuktikan** seluruh implementasi masih aktif atau berjalan pada penyedia kanal saat ini.

Referensi primer:
- [Carik Engine dan persyaratan build](https://github.com/luridarmawan/Carik/blob/master/README.md).
- [Struktur Mind Flow](https://github.com/CarikBot/ecosystem/blob/main/docs/mindmap-structure.md) dan [registrasi paket JSON](https://github.com/CarikBot/ecosystem/blob/main/data/package.json).
- [Kontrak API dan rich response](https://github.com/CarikBot/ecosystem/blob/main/docs/api-structure.md), [webhook](https://github.com/CarikBot/ecosystem/blob/main/docs/webhook.md) dan [push message](https://github.com/CarikBot/ecosystem/blob/main/docs/api-push-message.md).
- [ecosystem/package.json](https://github.com/CarikBot/ecosystem/blob/main/package.json) menyebut MIT tetapi skrip test hanya placeholder gagal; [Carik/LICENSE.txt](https://github.com/luridarmawan/Carik/blob/master/LICENSE.txt) tidak memberikan izin eksplisit untuk menggunakan, memodifikasi atau mendistribusikan kode. **Dilarang menyalin source tanpa izin memadai.**

## Keputusan dasar
- **REUSE:** AWCMS sebagai penguasa bisnis, tenant, RBAC/ABAC/RLS, persetujuan, audit dan adapter pengiriman resmi; Hermes sebagai agent runtime/inference/channel yang benar-benar didukung; OMES sebagai pengelola dan verifikator host.
- **ADAPT:** alur percakapan deklaratif ber-versi, katalog kapabilitas, pilihan menu, tombol/formulir bertipe, fallback dan handoff manusia yang tetap memanggil operasi domain terotorisasi.
- **DEFER:** editor visual, marketplace plugin/partner otomatis, LLM auto-reply, dan pengenalan kanal tambahan sampai lolos uji kegunaan, risiko, legal dan Gate 9.
- **REJECT:** migrasi ke Free Pascal/FastPlaz/legacy PHP, engine bot kedua, aplikasi konsumen yang langsung membaca database, perintah mentah pada callback, URL eksternal bebas, SQL/shell agent, serta pengiriman pesan langsung oleh LLM tanpa otorisasi bisnis.

## Arsitektur konseptual
~~~
Event masuk yang diverifikasi oleh penyedia
 -> ikat tenant, akun, thread dan aktor dari otoritas server
 -> periksa persetujuan data, otorisasi dan workflow existing
 -> state transition menu/form/handoff terkontrol
      |-> API domain bertipe dan diaudit, atau
      |-> Hermes untuk saran yang disanitasi (opsional)
 -> kebijakan respons dan kemampuan kanal
 -> fallback teks jika tombol/form tidak didukung
 -> existing provider sender/outbox berizin
 -> audit metadata + correlation ID + bukti delivery
~~~
OMES hanya mengamankan dan mengamati host secara independen; bukan proxy yang otomatis memediasi seluruh tools Hermes.

Contoh **skema kandidat, bukan endpoint yang sudah ada**:
~~~json
{
  "schema_version":"1.0.0",
  "flow_id":"helpdesk",
  "revision":1,
  "status":"draft",
  "nodes":[
    {"id":"start","kind":"choice","text":"Pilih layanan",
      "choices":[{"label":"Bantuan","next":"human"}]},
    {"id":"human","kind":"handoff","queue":"support"}
  ],
  "policy":{"max_steps":12,"ttl_seconds":600,"default_deny":true}
}
~~~

Setiap pilihan menghasilkan token transisi opaque, ditandatangani, berbatas waktu dan terikat tenant/aktor/akun/channel/revisi. Server memvalidasi ulang seluruh izin; klik di frontend bukan bukti pemberian hak akses. Flow publikasi immutable dan memiliki riwayat revisi; pembatalan, restart, deduplikasi, dan penghentian disiapkan lebih dulu. Form menggunakan definisi field bertipe dan validasi sisi server. *Rich response* tidak menjadi proxy HTML/URL tidak tepercaya.

## Kontrak perilaku lintas kanal
| Kemampuan | Ketentuan |
|---|---|
| Teks | Escaping output, tanpa konten rahasia dalam halaman statis/log. |
| Pilihan | Gunakan pilihan native hanya jika didukung; fallback ke teks bernomor yang mudah dibaca. |
| Formulir | Field string, angka, tanggal, boolean, option dan validasi; tombol batal; consent sesuai tujuan. |
| API bisnis | Nama operation allowlist, autentikasi terbaru, tenant scope, idempotensi, audit; bukan direct SQL. |
| Eskalasi | Petugas manusia menerima konteks minimal dan diotorisasi. |
| AI | Hanya saran/klasifikasi; tidak berwenang mengubah status pembayaran, akun, atau mengirim broadcast. |
| Webhook | Signature, freshness, validasi akun, anti-replay, dedup, outbox. |
| Provider send | Izin akun/sender, template/window, rate, opt-in diperiksa kembali saat enqueue. |

## Threat model dan pengujian wajib
| Ancaman | Syarat mitigasi / negative test |
|---|---|
| Webhook palsu | Tolak signature salah, akun tidak terdaftar dan timestamp kedaluwarsa. |
| Replay/duplikasi | Tiga event sama menghasilkan satu side effect. |
| IDOR/tenant bocor | Percobaan akses tenant lain ditolak oleh API dan RLS. |
| Callback injeksi | Token palsu, berlaku untuk aktor lain, dan kedaluwarsa ditolak. |
| SSRF/URL arbitrer | Larang mengambil alamat private/metadata IP; provider destination di-allowlist. |
| Prompt injection | Instruksi dari pesan pengguna tidak menambah izin tools atau menghapus approval. |
| Consent ditarik | Draf boleh tersimpan sesuai aturan, tetapi pesan tidak dikirim setelah pencabutan. |
| Log bocor PII | Nomor telepon, chat mentah, password, token dan rekam medis absen dari log host. |
| Alur tak berakhir | Batas langkah, durasi, ukuran payload, dan pembatalan ditegakkan. |
| Kanal tidak kompatibel | Tampilan aman beralih ke teks, tanpa status sukses palsu. |
| Mitra eksternal kompromi | Manifest ber-versi, digest dan grant; tanpa data tenant lain. |

## Setidaknya delapan penerapan praktis untuk diuji
1. FAQ publik: jawaban bersumber konten disetujui, tanpa LLM/data pribadi.
2. Cek status pesanan: pemilik terautentikasi memperoleh data sendiri, orang lain ditolak.
3. Form pendaftaran: validasi dan pembatalan, draft ber-TTL, consent jelas.
4. Keluhan Borneojek: menu layanan -> tiket -> operator, tanpa akses langsung ke data order.
5. Mitra AWOPC: penawaran layanan, reviu manifest, approval dan revocation.
6. Pertanyaan kesehatan: informasi umum dan eskalasi, tanpa akses RME atau diagnosis otomatis.
7. Ringkasan AI untuk petugas: input dimasking, output berupa draf, butuh persetujuan.
8. Tombol tidak didukung provider: teks berurutan dengan petunjuk yang dapat diakses.
9. Webhook pembayaran palsu: ditolak dan tidak mengubah status pembayaran.
10. Kehilangan koneksi: retry aman tanpa duplikasi atau penghilangan jejak.

## Hukum, standar dan rujukan
UU 27/2022 Pelindungan Data Pribadi, PP 71/2019 PSTE; untuk pemerintahan pertimbangkan Perpres 95/2018 SPBE sesuai ruang lingkup. ISO/IEC 27001/27002 (ISMS dan kontrol), 27005 (analisis risiko), 27017/27018 (cloud dan PII cloud), 27034 (keamanan aplikasi), 27701 (manajemen privasi), 42001 (AI management), ISO/IEC 20000-1 (layanan dan perubahan), ISO 22301 (kontinuitas), dan ISO/IEC 15408 **hanya jika** ada penilaian Common Criteria formal. Rekomendasi validasi tambahan: OWASP ASVS, OWASP API Security Top 10, OWASP LLM Top 10, NIST AI RMF. Menyebut standar tidak sama dengan sertifikasi atau kepatuhan.

## Pelaksanaan dan pengambilan keputusan
Alur pengembangan internal 18 tahap tetap berlaku. Kerjakan F0 riset dan PoC tertutup; sebelum implementasi produksi wajib riset pengguna/PRD, threat model dan DPIA, UX tervalidasi, skema/ABAC/RLS, domain algorithm, OpenAPI/AsyncAPI, lalu **persetujuan manusia Definition of Ready tahap 9**. Tahap 10 issue atomik, tahap 11–14 implementasi/PR/staging/UAT, **persetujuan rilis tahap 15**, dan 16–18 deploy/validasi/monitoring. Tidak mengklaim fitur telah tersedia tanpa bukti kode, tes dan deployment.


## Penerapan khusus: AWCMS

**Issue:** https://github.com/ahliweb/awcms/issues/1253. AWCMS adalah penguasa tunggal domain. Inventaris modul relevan mencakup workflow-approval, form-drafts, domain-event-runtime, channel-accounts, whatsapp-delivery, telegram-delivery dan website-engagement. Inbound [#1144](https://github.com/ahliweb/awcms/issues/1144), omnichannel inbox [#1164](https://github.com/ahliweb/awcms/issues/1164), Telegram engagement [#1156](https://github.com/ahliweb/awcms/issues/1156) harus dinilai sesuai implementasi sebenarnya; issue tidak membuktikan fitur selesai.

**Rencana:**
1. Audit ModuleDescriptor, route, grants, RLS, schema dan event untuk menemukan reuse. 
2. Buat ADR hanya bila kebutuhan conversation-flow belum bisa direpresentasikan oleh workflow/form existing.
3. Rancang lifecycle draft -> review -> approved -> published revision -> superseded, tanpa self-approval tak berizin.
4. Pertahankan PostgreSQL FORCE RLS, default-deny ABAC, audit redacted, immutable migrations, data lifecycle, subjectData, OpenAPI/AsyncAPI dan idempotent outbox.
5. Persetujuan bisnis dan sender authorization berada pada worker Bun, bukan Hermes.
6. Dua tenant, dua akun kanal, event replay, consent dicabut, concurrent transition, no-device fallback dan downstream outage menjadi tes integrasi wajib.

**Batas:** tidak mengklaim generator flow/endpoint baru sudah dibuat; bukan membangun CRM master atau workflow engine kedua. Proposal modul harus dibandingkan dengan kemampuan existing melalui Gate 9.

## Changelog
### v1.0.0 (2026-11-10)
Kajian awal referensi CarikBot; belum mengubah runtime produk.
