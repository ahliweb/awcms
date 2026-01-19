import 'package:flutter/widgets.dart';
import 'package:awcms_mobile/l10n/app_localizations.dart';

extension ContextExtensions on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this)!;
}
