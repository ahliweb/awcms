# Strategi Pengembangan Mobile App (Flutter) dengan AWCMS

Dokumen ini menjelaskan panduan dan praktik terbaik untuk menggunakan AWCMS sebagai backend (Headless CMS) untuk aplikasi mobile berbasis Flutter.

## 1. Arsitektur: AWCMS sebagai Backend-as-a-Service (BaaS)

AWCMS dibangun di atas **Supabase**, yang artinya secara otomatis menyediakan API yang lengkap dan aman untuk dikonsumsi oleh aplikasi mobile. Anda tidak perlu membuat API endpoint manual untuk setiap fitur CRUD.

### Komponen Utama

* **Database (PostgreSQL)**: Penyimpanan data utama (artikel, produk, user).
* **Auth (Supabase Auth)**: Manajemen identitas user (Login, Register, Reset Password).
* **Storage**: Manajemen file (gambar, video).
* **Edge Functions**: Logika bisnis kompleks (misal: approval workflow).
* **Realtime**: Fitur live update (notifikasi, chat).

## 2. Integrasi Flutter

Gunakan library resmi [supabase_flutter](https://pub.dev/packages/supabase_flutter) untuk menghubungkan aplikasi Flutter Anda dengan AWCMS.

### Instalasi

```yaml
dependencies:
  flutter:
    sdk: flutter
  supabase_flutter: ^1.10.0
```

### Inisialisasi

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

void main() async {
  await Supabase.initialize(
    url: 'YOUR_SUPABASE_URL',
    anonKey: 'YOUR_SUPABASE_ANON_KEY',
  );
  runApp(MyApp());
}
```

## 3. Strategi Otentikasi

Aplikasi mobile dapat menggunakan database user yang **sama persis** dengan web admin AWCMS.

* **Login**: Gunakan `Supabase.instance.client.auth.signInWithPassword`.
* **Register**: Gunakan alur yang sama dengan web, atau arahkan ke API `manage-users` jika menggunakan custom approval workflow.
* **Session Persistence**: `supabase_flutter` menangani penyimpanan sesi secara otomatis (menggunakan `flutter_secure_storage` di belakang layar).

## 4. Mengakses Data (Content Delivery)

Anda dapat mengambil konten (Artikel, Produk) langsung dari tabel menggunakan client Supabase.

### Contoh: Mengambil Artikel

```dart
final data = await Supabase.instance.client
    .from('articles')
    .select('title, content, cover_image, created_at')
    .eq('status', 'published') // Hanya ambil yang published
    .order('created_at', ascending: false);
```

### Keamanan (RLS)

Pastikan **Row Level Security (RLS)** di database sudah dikonfigurasi untuk mengizinkan akses `SELECT` ke tabel publik (seperti `articles`, `products`) oleh role `anon` atau `authenticated`.

## 5. Fitur Unggulan untuk Mobile

### A. Realtime Updates

Cocok untuk fitur notifikasi atau feed berita live.

```dart
Supabase.instance.client
    .from('notifications')
    .stream(primaryKey: ['id'])
    .listen((List<Map<String, dynamic>> data) {
      // Update UI secara real-time
    });
```

### B. Gambar & Media

Gunakan URL publik dari bucket Supabase Storage untuk menampilkan gambar. AWCMS sudah mengatur ini di `FilesManager`.

### C. Push Notifications

Anda dapat mengintegrasikan **Firebase Cloud Messaging (FCM)** dengan Supabase Edge Functions untuk mengirim notifikasi saat ada artikel baru atau status pesanan berubah.

## 6. Tips Pengembangan

1. **Gunakan Type Generation**: Generate Dart types dari schema database Supabase agar lebih type-safe.
2. **Tenant Context**: Jika aplikasi mobile mendukung multi-tenant, pastikan untuk selalu mengirimkan `tenant_id` atau memfilter query berdasarkan tenant.
3. **Edge Functions**: Untuk logika yang berat atau sensitif (seperti payment gateway), panggil Supabase Edge Functions dari Flutter sdk:

    ```dart
    final response = await Supabase.instance.client.functions.invoke('process-payment');
    ```

## 7. Strategi Hybrid (Online/Offline Sync)

Untuk membuat aplikasi yang bisa berjalan offline dan sinkron saat online ("Offline-First"), arsitektur aplikasi harus diubah sedikit. Aplikasi tidak boleh lagi bergantung langsung pada request API ke Supabase untuk setiap tampilan UI.

### Konsep Dasar: Local-First

1. **UI selalu membaca dari Local Database.**
2. **Background Process** bertugas melakukan sinkronisasi (Pull & Push) antara Local Database dan AWCMS (Supabase).

### Arsitektur yang Disarankan

#### A. Opsi 1: Custom Sync (Manual)

Cocok untuk kebutuhan sederhana (misal: hanya membaca artikel offline).

1. **Local Storage**: Gunakan [sqlite](https://pub.dev/packages/sqflite) atau [drift](https://pub.dev/packages/drift) di Flutter.
2. **Logic Pull (Server -> Device)**:
    * Saat app dibuka (online), request data ke Supabase: `select * from articles where updated_at > last_sync_time`.
    * Simpan data baru ke SQLite local.
3. **Logic Push (Device -> Server)**:
    * Simpan aksi user (misal: "create order") ke tabel `pending_actions` di local queue.
    * Listen `ConnectivityChanged`. Saat online, kirim queue ke Supabase satu per satu.
    * Hapus dari queue jika sukses.

#### B. Opsi 2: PowerSync (Direkomendasikan untuk Enterprise)

[PowerSync](https://powersync.com/) adalah engine sinkronisasi yang bekerja sangat baik dengan Supabase.

* Menangani sinkronisasi *Delta* (hanya data yang berubah) secara otomatis.
* Menangani konflik data.
* Tetap menghormati **RLS Policies** Supabase.
* Sangat performan untuk ribuan record.

### Implementasi Custom Sync dengan AWCMS

Jika memilih opsi Custom Sync manual, ikuti pola ini:

1. **Schema Preparation**: Pastikan semua tabel penting di AWCMS memiliki kolom `updated_at`.
2. **Flutter Implementation**:

    ```dart
    // 1. Definisikan Local DB (contoh menggunakan Drift)
    class LocalArticles extends Table {
      TextColumn get id => text()();
      TextColumn get title => text()();
      TextColumn get content => text()();
      DateTimeColumn get updatedAt => dateTime()();
    }

    // 2. Sync Function
    Future<void> syncArticles() async {
      // Ambil timestamp sync terakhir dari shared preferences
      final lastSync = prefs.getString('last_sync');
      
      // Ambil data dari Supabase yang berubah SETELAH sync terakhir
      final response = await supabase
          .from('articles')
          .select()
          .gt('updated_at', lastSync ?? '1970-01-01')
          .order('updated_at');

      // Update Local DB
      await localDb.batch((batch) {
        for (final row in response) {
          batch.insertOrReplace(localArticles, row);
        }
      });
      
      // Simpan timestamp baru
      prefs.setString('last_sync', DateTime.now().toIso8601String());
    }
    ```

3. **Handling Permissions (ABAC) Offline**:
    * Saat sync, filter data berdasarkan `tenant_id` dan permission user.
    * RLS Supabase akan otomatis menolak request sync jika user tidak berhak, memastikan data local tetap aman (Hanya data milik tenant user yang akan ter-download).

### Tips Offline

* **Gambar Offline**: Gunakan `cached_network_image` di Flutter. Library ini otomatis menyimpan cache gambar di disk.
* **Indikator Status**: Selalu berikan indikator visual di UI ("Sedang Offline", "Menyinkronkan...", "Sudah Sinkron").
* **Konflik**: Strategi "Last Write Wins" biasanya cukup untuk kasus CMS sederhana. Timestamp server adalah *source of truth*.

### ⚠️ Fitur Online-Only (Asset/File)

Beberapa fitur **tidak tersedia saat offline** karena membutuhkan akses ke Supabase Storage:

| Fitur | Status Offline | Keterangan |
| :---- | :------------- | :--------- |
| Upload Gambar | ❌ Tidak tersedia | Perlu koneksi untuk upload ke bucket |
| Download File | ❌ Tidak tersedia | File di-serve dari storage online |
| Lihat PDF | ❌ Tidak tersedia | PDF diakses via URL storage |
| Galeri Media | ❌ Tidak tersedia | Membutuhkan list bucket files |
| Akses Storage | ❌ Tidak tersedia | Semua operasi bucket perlu koneksi |

#### Implementasi Warning di Flutter

Gunakan `OnlineRequiredWrapper` widget atau utility functions:

```dart
// Wrapper widget (auto-disable saat offline)
OnlineRequiredWrapper(
  feature: OnlineFeature.imageUpload,
  child: UploadButton(),
);

// Manual check dengan snackbar
if (ref.checkOnlineForFeature(context, OnlineFeature.fileDownload)) {
  // Proceed with download
}

// Dialog warning
showOfflineAssetWarning(context, feature: OnlineFeature.pdfView);
```

## 8. Referensi AWCMS Mobile

Lihat implementasi referensi di folder `awcms-mobile/`:

* `lib/core/database/` - Drift local database
* `lib/core/services/sync_service.dart` - Sync logic
* `lib/shared/widgets/offline_indicator.dart` - Status indicators
* `lib/shared/widgets/offline_indicator.dart` - Status indicators
* `lib/shared/widgets/offline_asset_warning.dart` - Asset warnings

## 9. CI/CD Pipeline

AWCMS includes a GitHub Actions workflow for building the mobile app automatically.

* **Workflow File**: [ci.yml](../../../.github/workflows/ci.yml)
* **Triggers**: Pushes to `main` branch.
* **Artifacts**: Generates APK (Android) and IPA (iOS - No Code Signing in Free Tier) binaries attached to the workflow run.

See [Deployment Guide](../01-guides/DEPLOYMENT.md#5-mobile-application-awcms-mobile) for store release instructions.
