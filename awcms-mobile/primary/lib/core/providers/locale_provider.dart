/// AWCMS Mobile - Locale Provider
///
/// Provider untuk mengelola bahasa aplikasi (English/Indonesia).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/secure_storage_service.dart';

class LocaleNotifier extends Notifier<Locale> {
  static const _localeKey = 'app_locale';

  @override
  Locale build() {
    // Load saved locale or default to system/en
    _loadSavedLocale();
    return const Locale('en'); // Default initial
  }

  Future<void> _loadSavedLocale() async {
    final savedCode = await SecureStorageService.instance.read(_localeKey);
    if (savedCode != null) {
      state = Locale(savedCode);
    }
  }

  Future<void> setLocale(Locale locale) async {
    state = locale;
    await SecureStorageService.instance.write(_localeKey, locale.languageCode);
  }

  Future<void> toggleLocale() async {
    final newLocale = state.languageCode == 'en'
        ? const Locale('id')
        : const Locale('en');
    await setLocale(newLocale);
  }
}

final localeProvider = NotifierProvider<LocaleNotifier, Locale>(() {
  return LocaleNotifier();
});
