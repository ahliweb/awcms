/// AWCMS Mobile - Sync Service
///
/// Handles data synchronization between local database and Supabase.
library;

import 'dart:async';
import 'dart:convert';
import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../database/app_database.dart';
import '../utils/tenant_utils.dart';
import 'connectivity_service.dart';

/// Sync status for UI
enum SyncStatus { idle, syncing, success, error }

/// Sync state
class SyncState {
  final SyncStatus status;
  final String? message;
  final int pendingCount;
  final DateTime? lastSyncAt;

  const SyncState({
    this.status = SyncStatus.idle,
    this.message,
    this.pendingCount = 0,
    this.lastSyncAt,
  });

  SyncState copyWith({
    SyncStatus? status,
    String? message,
    int? pendingCount,
    DateTime? lastSyncAt,
  }) {
    return SyncState(
      status: status ?? this.status,
      message: message ?? this.message,
      pendingCount: pendingCount ?? this.pendingCount,
      lastSyncAt: lastSyncAt ?? this.lastSyncAt,
    );
  }

  bool get isSyncing => status == SyncStatus.syncing;
  bool get hasError => status == SyncStatus.error;
  bool get hasPending => pendingCount > 0;
}

/// Sync service for handling data synchronization
class SyncService extends Notifier<SyncState> {
  AppDatabase get _db => ref.read(appDatabaseProvider);
  SupabaseClient get _supabase => Supabase.instance.client;

  @override
  SyncState build() {
    // Listen to connectivity changes
    ref.listen(connectivityStatusProvider, (previous, next) {
      next.whenData((status) {
        if (status == ConnectivityStatus.online) {
          // Auto-sync when coming back online
          fullSync();
        }
      });
    });

    return const SyncState();
  }

  /// Perform full sync (pull + push)
  Future<void> fullSync() async {
    if (state.isSyncing) return;

    state = state.copyWith(status: SyncStatus.syncing, message: 'Syncing...');

    try {
      // Push pending changes first
      await _pushPendingChanges();

      // Then pull new data
      await _pullArticles();

      // Update pending count
      final pendingCount = await _db.syncDao.getPendingCount();
      final lastSync = await _db.syncDao.getLastSyncTime('articles');

      state = state.copyWith(
        status: SyncStatus.success,
        message: 'Sync complete',
        pendingCount: pendingCount,
        lastSyncAt: lastSync,
      );
    } catch (e) {
      state = state.copyWith(
        status: SyncStatus.error,
        message: 'Sync failed: ${e.toString()}',
      );
    }
  }

  /// Pull articles from Supabase
  Future<void> _pullArticles() async {
    final tenantId = ref.read(tenantIdProvider);
    final lastSync = await _db.syncDao.getLastSyncTime(
      'articles',
      tenantId: tenantId,
    );

    // Build query
    var query = _supabase
        .from('articles')
        .select(
          'id, tenant_id, title, content, excerpt, cover_image, status, owner_id, created_at, updated_at',
        )
        .eq('status', 'published')
        .isFilter('deleted_at', null);

    // Filter by tenant if available
    if (tenantId != null) {
      query = query.eq('tenant_id', tenantId);
    }

    // Only get updated records if we have a last sync time
    if (lastSync != null) {
      query = query.gt('updated_at', lastSync.toIso8601String());
    }

    final response = await query.order('updated_at', ascending: true);
    final articles = List<Map<String, dynamic>>.from(response);

    if (articles.isEmpty) return;

    // Convert to Drift companions and upsert
    final companions = articles
        .map(
          (row) => LocalArticlesCompanion(
            id: Value(row['id'] as String),
            tenantId: Value(row['tenant_id'] as String?),
            title: Value(row['title'] as String? ?? ''),
            content: Value(row['content'] as String?),
            excerpt: Value(row['excerpt'] as String?),
            coverImage: Value(row['cover_image'] as String?),
            status: Value(row['status'] as String? ?? 'draft'),
            ownerId: Value(row['owner_id'] as String?),
            createdAt: Value(
              DateTime.tryParse(row['created_at'] as String? ?? ''),
            ),
            updatedAt: Value(
              DateTime.tryParse(row['updated_at'] as String? ?? ''),
            ),
            syncedAt: Value(DateTime.now()),
          ),
        )
        .toList();

    await _db.articlesDao.upsertArticles(companions);

    // Update last sync time
    await _db.syncDao.setLastSyncTime(
      'articles',
      DateTime.now(),
      tenantId: tenantId,
    );
  }

  /// Push pending changes to Supabase
  Future<void> _pushPendingChanges() async {
    final pending = await _db.syncDao.getPendingQueue();

    for (final item in pending) {
      try {
        await _processQueueItem(item);
        await _db.syncDao.markAsProcessed(item.id);
      } catch (e) {
        await _db.syncDao.markAsFailed(item.id, e.toString());
        // Continue with next item
      }
    }

    // Cleanup old processed items
    await _db.syncDao.cleanupProcessedQueue();
  }

  /// Process a single queue item
  Future<void> _processQueueItem(SyncQueueItem item) async {
    final payload = jsonDecode(item.payload) as Map<String, dynamic>;

    switch (item.action) {
      case 'create':
        await _supabase.from(item.targetTable).insert(payload);
        break;
      case 'update':
        await _supabase
            .from(item.targetTable)
            .update(payload)
            .eq('id', item.recordId);
        break;
      case 'delete':
        await _supabase.from(item.targetTable).update({
          'deleted_at': DateTime.now().toUtc().toIso8601String(),
        }).eq('id', item.recordId);
        break;
    }
  }

  /// Queue an offline mutation
  Future<void> queueMutation({
    required String action,
    required String targetTable,
    required String recordId,
    required Map<String, dynamic> payload,
  }) async {
    await _db.syncDao.addToQueue(
      action: action,
      targetTable: targetTable,
      recordId: recordId,
      payload: payload,
    );

    // Update pending count
    final pendingCount = await _db.syncDao.getPendingCount();
    state = state.copyWith(pendingCount: pendingCount);

    // Try to sync immediately if online
    final isOnline = ref.read(isOnlineProvider);
    if (isOnline) {
      await _pushPendingChanges();
    }
  }

  /// Force refresh all data
  Future<void> forceRefresh() async {
    // Clear sync metadata to force full re-sync
    await _db.syncDao.clearSyncMetadata();
    await fullSync();
  }
}

/// Provider for sync service
final syncServiceProvider = NotifierProvider<SyncService, SyncState>(
  () => SyncService(),
);

/// Provider for pending sync count
final pendingSyncCountProvider = Provider<int>((ref) {
  return ref.watch(syncServiceProvider).pendingCount;
});

/// Provider for sync status
final syncStatusProvider = Provider<SyncStatus>((ref) {
  return ref.watch(syncServiceProvider).status;
});

/// Provider for app database
final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(() => db.close());
  return db;
});
