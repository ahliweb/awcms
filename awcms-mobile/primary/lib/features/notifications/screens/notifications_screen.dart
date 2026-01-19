/// AWCMS Mobile - Notifications Screen
///
/// Layar untuk menampilkan daftar notifikasi.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/extensions/context_extensions.dart';
import '../../../core/services/notification_service.dart';
import '../../../shared/widgets/notification_widgets.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationState = ref.watch(notificationServiceProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.notifications),
        actions: [
          if (notificationState.unreadCount > 0)
            TextButton(
              onPressed: () {
                ref.read(notificationServiceProvider.notifier).markAllAsRead();
              },
              child: Text(context.l10n.markAll),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref
              .read(notificationServiceProvider.notifier)
              .loadNotifications();
        },
        child: _buildContent(context, ref, notificationState),
      ),
    );
  }

  Widget _buildContent(
    BuildContext context,
    WidgetRef ref,
    NotificationState state,
  ) {
    if (state.isLoading && state.notifications.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && state.notifications.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(state.error!),
            const SizedBox(height: 16),
            FilledButton.tonalIcon(
              onPressed: () {
                ref
                    .read(notificationServiceProvider.notifier)
                    .loadNotifications();
              },
              icon: const Icon(Icons.refresh),
              label: Text(context.l10n.retry),
            ),
          ],
        ),
      );
    }

    if (state.notifications.isEmpty) {
      return const EmptyNotifications();
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: state.notifications.length,
      itemBuilder: (context, index) {
        final notification = state.notifications[index];
        return NotificationItem(
          notification: notification,
          onTap: () {
            if (!notification.isRead) {
              ref
                  .read(notificationServiceProvider.notifier)
                  .markAsRead(notification.id);
            }
          },
          onDismiss: () {
            ref
                .read(notificationServiceProvider.notifier)
                .deleteNotification(notification.id);
          },
        );
      },
    );
  }
}
