/// AWCMS Mobile - Security Gate Widget
///
/// Widget wrapper untuk memblokir akses jika device tidak aman.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/extensions/context_extensions.dart';
import '../../core/services/security_service.dart';

/// Security gate - blocks app if device is compromised
class SecurityGate extends ConsumerWidget {
  final Widget child;

  const SecurityGate({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final securityCheckAsync = ref.watch(securityCheckProvider);

    return securityCheckAsync.when(
      data: (result) {
        if (result.status == SecurityStatus.compromised) {
          return _BlockedScreen(message: result.message);
        }
        return child;
      },
      loading: () => const _LoadingScreen(),
      error: (error, stackTrace) => child, // Proceed if check fails
    );
  }
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(context.l10n.checkingDeviceSecurity),
          ],
        ),
      ),
    );
  }
}

class _BlockedScreen extends StatelessWidget {
  final String? message;

  const _BlockedScreen({this.message});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.security, size: 80, color: colorScheme.error),
              const SizedBox(height: 24),
              Text(
                context.l10n.insecureDevice,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: colorScheme.error,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                message ?? context.l10n.deviceRootedMessage,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 32),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: colorScheme.onErrorContainer,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        context.l10n.deviceModifiedMessage,
                        style: TextStyle(
                          color: colorScheme.onErrorContainer,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
