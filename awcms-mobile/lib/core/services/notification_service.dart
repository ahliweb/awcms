/// AWCMS Mobile - Notification Service
///
/// Service untuk Supabase Realtime notifications dengan local notification.
library;

import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'local_notification_service.dart';
import 'auth_service.dart';

/// Notification type
enum NotificationType { info, warning, success, error }

extension NotificationTypeExtension on NotificationType {
  String get value {
    switch (this) {
      case NotificationType.info:
        return 'info';
      case NotificationType.warning:
        return 'warning';
      case NotificationType.success:
        return 'success';
      case NotificationType.error:
        return 'error';
    }
  }

  static NotificationType fromString(String? value) {
    switch (value) {
      case 'warning':
        return NotificationType.warning;
      case 'success':
        return NotificationType.success;
      case 'error':
        return NotificationType.error;
      default:
        return NotificationType.info;
    }
  }
}

/// Notification model
class AppNotification {
  final String id;
  final String? tenantId;
  final String? userId;
  final String title;
  final String? body;
  final NotificationType type;
  final Map<String, dynamic>? data;
  final bool isRead;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    this.tenantId,
    this.userId,
    required this.title,
    this.body,
    required this.type,
    this.data,
    this.isRead = false,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: json['id'] as String,
      tenantId: json['tenant_id'] as String?,
      userId: json['user_id'] as String?,
      title: json['title'] as String,
      body: json['body'] as String?,
      type: NotificationTypeExtension.fromString(json['type'] as String?),
      data: json['data'] as Map<String, dynamic>?,
      isRead: json['is_read'] as bool? ?? false,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  AppNotification copyWith({bool? isRead}) {
    return AppNotification(
      id: id,
      tenantId: tenantId,
      userId: userId,
      title: title,
      body: body,
      type: type,
      data: data,
      isRead: isRead ?? this.isRead,
      createdAt: createdAt,
    );
  }
}

/// Notification state
class NotificationState {
  final List<AppNotification> notifications;
  final int unreadCount;
  final bool isLoading;
  final String? error;

  const NotificationState({
    this.notifications = const [],
    this.unreadCount = 0,
    this.isLoading = false,
    this.error,
  });

  NotificationState copyWith({
    List<AppNotification>? notifications,
    int? unreadCount,
    bool? isLoading,
    String? error,
  }) {
    return NotificationState(
      notifications: notifications ?? this.notifications,
      unreadCount: unreadCount ?? this.unreadCount,
      isLoading: isLoading ?? this.isLoading,
      error: error,
    );
  }
}

/// Notification service with Supabase Realtime
class NotificationService extends Notifier<NotificationState> {
  RealtimeChannel? _channel;
  StreamSubscription? _authSubscription;

  SupabaseClient get _supabase => Supabase.instance.client;
  LocalNotificationService get _localNotif =>
      ref.read(localNotificationServiceProvider);

  @override
  NotificationState build() {
    // Watch auth state
    ref.listen(authProvider, (previous, next) {
      if (next.isAuthenticated) {
        _subscribeToNotifications();
        loadNotifications();
      } else {
        _unsubscribe();
        state = const NotificationState();
      }
    });

    // Check initial auth state
    final authState = ref.read(authProvider);
    if (authState.isAuthenticated) {
      _subscribeToNotifications();
      loadNotifications();
    }

    ref.onDispose(() {
      _unsubscribe();
    });

    return const NotificationState();
  }

  /// Subscribe to Supabase Realtime
  void _subscribeToNotifications() {
    final userId = ref.read(authProvider).user?.id;
    if (userId == null) return;

    _channel = _supabase
        .channel('notifications:$userId')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'notifications',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: userId,
          ),
          callback: (payload) {
            _handleNewNotification(payload.newRecord);
          },
        )
        .subscribe();
  }

  void _unsubscribe() {
    _channel?.unsubscribe();
    _channel = null;
    _authSubscription?.cancel();
  }

  void _handleNewNotification(Map<String, dynamic> record) {
    final notification = AppNotification.fromJson(record);

    // Add to state
    state = state.copyWith(
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    );

    // Show local notification
    _localNotif.show(
      id: notification.id.hashCode,
      title: notification.title,
      body: notification.body ?? '',
      payload: notification.id,
    );
  }

  /// Load notifications from database
  Future<void> loadNotifications() async {
    state = state.copyWith(isLoading: true, error: null);

    try {
      final userId = ref.read(authProvider).user?.id;
      if (userId == null) return;

      final response = await _supabase
          .from('notifications')
          .select()
          .or('user_id.eq.$userId,user_id.is.null')
          .order('created_at', ascending: false)
          .limit(50);

      final notifications = (response as List)
          .map((json) => AppNotification.fromJson(json))
          .toList();

      final unreadCount = notifications.where((n) => !n.isRead).length;

      state = NotificationState(
        notifications: notifications,
        unreadCount: unreadCount,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: 'Gagal memuat notifikasi: $e',
      );
    }
  }

  /// Mark notification as read
  Future<void> markAsRead(String notificationId) async {
    try {
      await _supabase
          .from('notifications')
          .update({'is_read': true})
          .eq('id', notificationId);

      final updated = state.notifications.map((n) {
        if (n.id == notificationId) {
          return n.copyWith(isRead: true);
        }
        return n;
      }).toList();

      state = state.copyWith(
        notifications: updated,
        unreadCount: (state.unreadCount - 1).clamp(0, state.unreadCount),
      );
    } catch (_) {
      // Ignore errors
    }
  }

  /// Mark all as read
  Future<void> markAllAsRead() async {
    try {
      final userId = ref.read(authProvider).user?.id;
      if (userId == null) return;

      await _supabase
          .from('notifications')
          .update({'is_read': true})
          .or('user_id.eq.$userId,user_id.is.null')
          .eq('is_read', false);

      final updated = state.notifications
          .map((n) => n.copyWith(isRead: true))
          .toList();

      state = state.copyWith(notifications: updated, unreadCount: 0);
    } catch (_) {
      // Ignore errors
    }
  }

  /// Delete notification
  Future<void> deleteNotification(String notificationId) async {
    try {
      await _supabase.from('notifications').delete().eq('id', notificationId);

      final updated = state.notifications
          .where((n) => n.id != notificationId)
          .toList();
      final wasUnread = state.notifications.any(
        (n) => n.id == notificationId && !n.isRead,
      );

      state = state.copyWith(
        notifications: updated,
        unreadCount: wasUnread ? state.unreadCount - 1 : state.unreadCount,
      );
    } catch (_) {
      // Ignore errors
    }
  }
}

/// Provider for notification service
final notificationServiceProvider =
    NotifierProvider<NotificationService, NotificationState>(
      () => NotificationService(),
    );

/// Provider for unread count
final unreadNotificationCountProvider = Provider<int>((ref) {
  return ref.watch(notificationServiceProvider).unreadCount;
});
