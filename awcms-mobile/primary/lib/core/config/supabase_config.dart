/// AWCMS Mobile - Supabase Configuration
///
/// Konfigurasi Supabase client yang diambil dari environment variables.
library;

import 'package:flutter_dotenv/flutter_dotenv.dart';

class SupabaseConfig {
  // Prevent instantiation
  SupabaseConfig._();

  /// Supabase Project URL
  static String get url => dotenv.env['SUPABASE_URL'] ?? '';

  /// Supabase Publishable Key
  static String get publishableKey =>
      dotenv.env['SUPABASE_PUBLISHABLE_KEY'] ?? '';

  /// Validate configuration
  static bool get isValid => url.isNotEmpty && publishableKey.isNotEmpty;

  /// Get validation error message
  static String? get validationError {
    if (url.isEmpty) {
      return 'SUPABASE_URL is not configured';
    }
    if (publishableKey.isEmpty) {
      return 'SUPABASE_PUBLISHABLE_KEY is not configured';
    }
    return null;
  }
}
