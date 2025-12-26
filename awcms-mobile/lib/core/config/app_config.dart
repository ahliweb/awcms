/// AWCMS Mobile - App Configuration
///
/// Konfigurasi aplikasi global.
library;

import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConfig {
  // Prevent instantiation
  AppConfig._();

  /// App Name from environment
  static String get appName => dotenv.env['APP_NAME'] ?? 'AWCMS Mobile';

  /// Current environment (development/staging/production)
  static String get environment => dotenv.env['APP_ENV'] ?? 'development';

  /// Check if running in development mode
  static bool get isDevelopment => environment == 'development';

  /// Check if running in production mode
  static bool get isProduction => environment == 'production';

  /// Default Tenant ID (for single-tenant apps or development)
  static String? get defaultTenantId {
    final id = dotenv.env['DEFAULT_TENANT_ID'];
    return (id != null && id.isNotEmpty) ? id : null;
  }
}
