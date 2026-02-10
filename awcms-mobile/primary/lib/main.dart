/// AWCMS Mobile - Main Entry Point
///
/// Inisialisasi aplikasi dengan Supabase, Riverpod, Offline Services, dan Security.
library;

import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:awcms_mobile/l10n/app_localizations.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/config/supabase_config.dart';
import 'core/services/connectivity_service.dart';
import 'routes/app_router.dart';
import 'shared/themes/app_theme.dart';
import 'shared/widgets/security_gate.dart';
import 'core/providers/locale_provider.dart';
import 'core/providers/theme_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load environment variables
  await dotenv.load(fileName: '.env');

  // Validate Supabase configuration
  if (!SupabaseConfig.isValid) {
    throw Exception(
      'Supabase configuration error: ${SupabaseConfig.validationError}',
    );
  }

  // Initialize Supabase
  await Supabase.initialize(
    url: SupabaseConfig.url,
    anonKey: SupabaseConfig.anonKey,
  );

  // Initialize connectivity service
  final connectivityService = ConnectivityService();
  await connectivityService.initialize();

  runApp(
    ProviderScope(
      overrides: [
        connectivityServiceProvider.overrideWithValue(connectivityService),
      ],
      child: const AWCMSMobileApp(),
    ),
  );
}

class AWCMSMobileApp extends ConsumerWidget {
  const AWCMSMobileApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final locale = ref.watch(localeProvider);
    final themeMode = ref.watch(themeProvider);

    return MaterialApp.router(
      title: 'AWCMS Mobile',
      debugShowCheckedModeBanner: false,

      // Localization
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,

      // Theme
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: themeMode,

      // Routing with security gate
      routerConfig: router,
      builder: (context, child) {
        return SecurityGate(child: child ?? const SizedBox.shrink());
      },
    );
  }
}
