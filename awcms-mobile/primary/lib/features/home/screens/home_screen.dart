/// AWCMS Mobile - Home Screen
///
/// Halaman utama aplikasi dengan sync status dan role badge.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/services/auth_service.dart';
import '../../../core/services/sync_service.dart';
import '../../../routes/app_router.dart';
import '../../../shared/widgets/offline_indicator.dart';
import '../../../shared/widgets/permission_widgets.dart';
import '../../../core/extensions/context_extensions.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final syncState = ref.watch(syncServiceProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.appTitle),
        actions: [
          const SyncStatusChip(),
          const SizedBox(width: 8),
          if (authState.isAuthenticated)
            IconButton(
              icon: const Icon(Icons.logout),
              onPressed: () => ref.read(authProvider.notifier).signOut(),
            )
          else
            TextButton(
              onPressed: () => context.push(AppRoutes.login),
              child: Text(context.l10n.login),
            ),
        ],
      ),
      body: Column(
        children: [
          // Offline indicator
          const OfflineIndicator(),

          // Main content
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                await ref.read(syncServiceProvider.notifier).fullSync();
              },
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Welcome Card with Role Badge
                    _WelcomeCard(authState: authState),

                    const SizedBox(height: 24),

                    // Sync Status Card
                    if (syncState.lastSyncAt != null || syncState.hasPending)
                      _SyncStatusCard(syncState: syncState),

                    if (syncState.lastSyncAt != null || syncState.hasPending)
                      const SizedBox(height: 24),

                    // Quick Actions
                    Text(
                      context.l10n.menu,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 12),

                    GridView.count(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisCount: 2,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 1.1,
                      children: [
                        _MenuCard(
                          icon: Icons.article,
                          title: context.l10n.blogs,
                          subtitle: context.l10n.seeAllBlogs,
                          color: colorScheme.primary,
                          onTap: () => context.push(AppRoutes.blogs),
                        ),
                        _MenuCard(
                          icon: Icons.image,
                          title: context.l10n.gallery,
                          subtitle: context.l10n.viewPhotosVideos,
                          color: colorScheme.tertiary,
                          onTap: () => _showComingSoon(context),
                        ),
                        _MenuCard(
                          icon: Icons.shopping_bag,
                          title: context.l10n.products,
                          subtitle: context.l10n.productCatalog,
                          color: colorScheme.secondary,
                          onTap: () => _showComingSoon(context),
                        ),
                        _MenuCard(
                          icon: Icons.info,
                          title: context.l10n.aboutApp,
                          subtitle: context.l10n.appInfo,
                          color: colorScheme.outline,
                          onTap: () => _showAbout(context),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showComingSoon(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.construction, color: Colors.white),
            const SizedBox(width: 12),
            Text(context.l10n.comingSoon),
          ],
        ),
        behavior: SnackBarBehavior.floating,
        backgroundColor: Theme.of(context).colorScheme.primary,
      ),
    );
  }

  void _showAbout(BuildContext context) {
    showAboutDialog(
      context: context,
      applicationName: context.l10n.appTitle,
      applicationVersion: '1.0.0',
      applicationIcon: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primaryContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(
          Icons.dashboard,
          size: 32,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
      applicationLegalese: context.l10n.copyright,
    );
  }
}

class _WelcomeCard extends ConsumerWidget {
  final AuthState authState;

  const _WelcomeCard({required this.authState});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(AppRoutes.profile),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.dashboard,
                  color: colorScheme.primary,
                  size: 32,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          context.l10n.welcome,
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(width: 8),
                        if (authState.isAuthenticated) const RoleBadge(),
                      ],
                    ),
                    if (authState.isAuthenticated) ...[
                      const SizedBox(height: 4),
                      Text(
                        authState.user?.email ?? '',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
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

class _SyncStatusCard extends StatelessWidget {
  final SyncState syncState;

  const _SyncStatusCard({required this.syncState});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Card(
      color: syncState.hasPending
          ? colorScheme.tertiaryContainer
          : colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              syncState.hasPending ? Icons.sync_problem : Icons.cloud_done,
              color: syncState.hasPending
                  ? colorScheme.onTertiaryContainer
                  : colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    syncState.hasPending
                        ? context.l10n.itemsPendingSync(syncState.pendingCount)
                        : context.l10n.dataSynced,
                    style: TextStyle(
                      fontWeight: FontWeight.w500,
                      color: syncState.hasPending
                          ? colorScheme.onTertiaryContainer
                          : colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (syncState.lastSyncAt != null)
                    Text(
                      context.l10n.lastSync(
                        _formatTime(context, syncState.lastSyncAt!),
                      ),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTime(BuildContext context, DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);

    if (diff.inMinutes < 1) return context.l10n.justNow;
    if (diff.inHours < 1) return context.l10n.minAgo(diff.inMinutes);
    if (diff.inDays < 1) return context.l10n.hoursAgo(diff.inHours);
    return context.l10n.daysAgo(diff.inDays);
  }
}

class _MenuCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _MenuCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 28),
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
