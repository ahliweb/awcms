/// AWCMS Mobile - App Constants
///
/// Konstanta global yang digunakan di seluruh aplikasi.
library;

class AppConstants {
  // Prevent instantiation
  AppConstants._();

  // App Info
  static const String appName = 'AWCMS Mobile';
  static const String appVersion = '1.0.0';

  // API Endpoints
  static const int apiTimeout = 30000; // 30 seconds

  // Pagination
  static const int defaultPageSize = 20;

  // Cache Duration
  static const Duration cacheDuration = Duration(hours: 1);

  // Storage Keys
  static const String tokenKey = 'auth_token';
  static const String userKey = 'user_data';
  static const String tenantKey = 'tenant_id';
  static const String lastSyncKey = 'last_sync';

  // Content Status
  static const String statusDraft = 'draft';
  static const String statusPublished = 'published';
  static const String statusArchived = 'archived';
}
