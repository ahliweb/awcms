/// AWCMS Mobile - Theme Provider
///
/// Provider untuk mengelola mode tema aplikasi (Light/Dark/System).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/secure_storage_service.dart';

class ThemeNotifier extends Notifier<ThemeMode> {
  static const _themeKey = 'app_theme_mode';

  @override
  ThemeMode build() {
    _loadSavedTheme();
    return ThemeMode.system; // Default
  }

  Future<void> _loadSavedTheme() async {
    final savedMode = await SecureStorageService.instance.read(_themeKey);
    if (savedMode != null) {
      state = _parseThemeMode(savedMode);
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    await SecureStorageService.instance.write(_themeKey, mode.name);
  }

  ThemeMode _parseThemeMode(String modeName) {
    return ThemeMode.values.firstWhere(
      (e) => e.name == modeName,
      orElse: () => ThemeMode.system,
    );
  }
}

final themeProvider = NotifierProvider<ThemeNotifier, ThemeMode>(() {
  return ThemeNotifier();
});
