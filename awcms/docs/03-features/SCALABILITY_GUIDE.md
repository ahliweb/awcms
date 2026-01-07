# Panduan Implementasi AWCMS untuk Skala Tinggi (High Scalability)

Dokumen ini menjelaskan strategi arsitektur dan optimasi untuk menangani beban lalu lintas sangat tinggi (misal: jutaan request per menit) menggunakan AWCMS dan infrastruktur Supabase.

Untuk mencapai skala "Jutaan Request per Menit" (Hyper-scale), aplikasi tidak bisa hanya mengandalkan satu instance database monolitik. Diperlukan strategi berlapis (**Layered Architecture**).

## 1. Arsitektur Caching (Layer 1 - Pertahanan Pertama)

Database PostgreSQL tidak didesain untuk melayani jutaan request *baca* statis per menit secara langsung. Layer caching adalah kunci utama.

### A. CDN & Edge Caching

Untuk konten publik (Artikel, Produk, Hompage), **jangan hit database secara langsung** untuk setiap visitor.

* **Implementasi**: Gunakan CDN seperti Cloudflare atau CloudFront di depan API/Frontend AWCMS.
* **Strategi**:
  * **Cache Everything (HTML/JSON)**: Cache response API konten publik selama mungkin (misal: 1-5 menit).
  * **Stale-While-Revalidate**: Sajikan konten lama (stale) sambil memperbarui cache di background.
  * **Cache Tagging**: Jika memungkinkan, gunakan *cache tags* untuk invalidasi cerdas saat konten diedit di CMS.

### B. Application Caching (Redis)

Jika data terlalu dinamis untuk CDN, gunakan Redis.

* Simpan hasil query database yang berat (seperti agregasi statistik atau menu kompleks) di Redis.

## 2. Optimasi Database (Layer 2 - Core System)

Supabase (PostgreSQL) adalah jantung AWCMS. Optimasi di sini sangat krusial.

### A. Read Replicas (Horizontal Scaling)

Untuk memisahkan beban *Baca* (Visitor) dan *Tulis* (Admin/Transaksi).

* **Primary DB**: Menangani transaksi tulis (Order baru, Edit artikel, Register user).
* **Read Replicas**: Menangani jutaan query `SELECT` dari user.
* **AWCMS Config**: Arahkan traffic publik (GET requests) ke URL Read Replica melalui Load Balancer atau konfigurasi connection string khusus.

### B. Connection Pooling (Supavisor)

Jutaan request berarti jutaan koneksi database jika tidak dikelola.

* Gunakan **Supavisor** (Connection Pooler bawaan Supabase) dengan mode `Transaction`.
* Hindari koneksi langsung (Direct Connection) dari Serverless Function atau Client yang masif.

### C. Partitioning & Indexing

* **Indexing**: Pastikan *semua* kolom filter (misal `tenant_id`, `status`, `category_id`) diindex.
* **Partitioning**: Untuk tabel super besar (seperti `audit_logs` atau `transactions`), gunakan partisi berdasarkan waktu (bulan/tahun) untuk menjaga performa query tetap cepat.

## 3. Arsitektur Frontend (Decoupled)

Untuk skala tinggi, cara frontend mengambil data sangat menentukan.

### A. Static Site Generation (SSG) / ISR

Ini adalah metode paling ampuh.

* Build halaman artikel menjadi file HTML statis saat di-publish.
* Hosting file statis ini di CDN/Storage.
* Build halaman artikel menjadi file HTML statis saat di-publish.
* Hosting file statis ini di CDN/Storage.
* **Beban Database**: Hampir 0 saat user mengakses, karena mereka hanya mendownload file HTML statis. Beban hanya terjadi saat *Build* (saat admin menekan publish).

### B. Optimistic UI & Local-First (Mobile)

Seperti dijelaskan di dokumen Mobile Development, gunakan strategi Local-First untuk mengurangi "chatty" network request.

## 4. Infrastruktur Backend & ABAC (Security at Scale)

Sesuai dokumen [ABAC_SYSTEM.md](ABAC_SYSTEM.md), AWCMS menggunakan pendekatan *Attribute-Based Access Control* yang sangat granular. Pada skala jutaan request, policy security tidak boleh menjadi bottleneck.

### A. Optimasi RLS (Row Level Security)

Setiap query ke database akan melewati filter RLS.

* **Hindari Join Kompleks di Policy**: Policy `USING` harus se-sederhana mungkin. Hindari subquery ke tabel lain jika tidak perlu.
* **JWT Claims**: Simpan atribut penting (Role, Tenant ID) langsung di dalam JWT User (`auth.users` metadata). Ini memungkinkan RLS membaca atribut langsung dari session memory tanpa perlu query ulang ke tabel `permissions`.
  * *Bad*: `exists (select 1 from roles where ...)`
  * *Good*: `(auth.jwt() ->> 'role')::text = 'admin'`

### B. Caching Permission Matrix

Untuk sistem ABAC yang kompleks:

* Cache hasil fungsi `checkAccess()` di sisi aplikasi (Redis/Memory) selama durasi session user.

## 5. Integrasi AI Agents di Skala Besar

Merujuk pada [AGENTS.md](../02-reference/AGENTS.md), AWCMS didesain untuk kolaborasi dengan AI Agents. Agent seringkali melakukan operasi "burst" (banyak request dalam waktu singkat).

### A. Dedicated Queue untuk Agent

Jangan biarkan Agent memblokir traffic user manusia.

* Gunakan antrian terpisah (Supabase Edge Functions / pg_mq) untuk job yang dipicu oleh Agent (misal: "Generate SEO for 1000 articles").
* Terapkan **Rate Limiting** khusus untuk Service Role yang digunakan oleh Agent.

### B. Webhooks & Events

Daripada Agent melakukan *polling* terus menerus ("Apakah ada data baru?"), gunakan arsitektur **Event-Driven**.

* Trigger Database Webhook saat data berubah -> Kirim sinyal ke Agent untuk bekerja.

## 6. Infrastruktur Backend (Edge Functions)

Hindari "Cold Starts" dan latency tinggi.

* **Global Distribution**: Deploy Edge Functions di region yang dekat dengan user (Supabase Edge Functions berjalan di jaringan global Deno Deploy).
* **Minimal Logic**: Jaga Edge Function tetap ringan. Untuk proses berat (misal: generate report, image processing), gunakan **Background Jobs** (pg_cron atau Queue), jangan memblokir request HTTP user.

## 7. Ringkasan Strategi Skala Jutaan Request

| Komponen | Strategi High-Scale |
| :--- | :--- |
| **Konten Publik** | **SSG (Static)** + CDN Cache (Hit Rate > 99%) |
| **Database Read** | **Read Replicas** tersebar (Load Balanced) |
| **Database Write** | **Primary DB** High-Compute (Vertical Scaling) |
| **Koneksi** | **PgBouncer / Supavisor** (Transaction Mode) |
| **Search** | Jangan pakai `ILIKE`. Gunakan **pgvector** atau dedicated engine (Meilisearch/Elastic) |
| **Media/Gambar** | **Image CDN** transformasi otomatis (Next.js Image / Supabase Storage) |

Dengan menerapkan SSG/CDN untuk konten publik dan Read Replicas untuk data dinamis, AWCMS di atas Supabase dapat dengan mudah menangani skala enterprise masif.
