/// AWCMS Mobile - Supabase Service
///
/// Service untuk interaksi dengan Supabase backend.
/// Menyediakan helper methods untuk query dengan tenant context.
library;

import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseService {
  // Singleton instance
  static final SupabaseService _instance = SupabaseService._internal();
  factory SupabaseService() => _instance;
  SupabaseService._internal();

  /// Get Supabase client instance
  SupabaseClient get client => Supabase.instance.client;

  /// Get current authenticated user
  User? get currentUser => client.auth.currentUser;

  /// Check if user is authenticated
  bool get isAuthenticated => currentUser != null;

  /// Get current session
  Session? get currentSession => client.auth.currentSession;

  // ============================================================
  // Query Helpers (with tenant context support)
  // ============================================================

  /// Select query with optional tenant filter
  ///
  /// Example:
  /// ```dart
  /// final articles = await supabaseService.select(
  ///   'articles',
  ///   columns: 'id, title, content, cover_image',
  ///   filters: {'status': 'published'},
  ///   orderBy: 'created_at',
  ///   ascending: false,
  ///   tenantId: 'your-tenant-id', // optional
  /// );
  /// ```
  Future<List<Map<String, dynamic>>> select(
    String table, {
    String columns = '*',
    Map<String, dynamic>? filters,
    String? orderBy,
    bool ascending = true,
    int? limit,
    String? tenantId,
  }) async {
    // Build query with filters first
    var query = client.from(table).select(columns);

    // Apply tenant filter if provided
    if (tenantId != null) {
      query = query.eq('tenant_id', tenantId);
    }

    // Apply additional filters
    if (filters != null) {
      for (final entry in filters.entries) {
        query = query.eq(entry.key, entry.value);
      }
    }

    // Execute with ordering and limit (these return different types)
    final response = await query
        .order(orderBy ?? 'created_at', ascending: ascending)
        .limit(limit ?? 100);

    return List<Map<String, dynamic>>.from(response);
  }

  /// Get single record by ID
  Future<Map<String, dynamic>?> getById(
    String table,
    String id, {
    String columns = '*',
    String idColumn = 'id',
  }) async {
    final response = await client
        .from(table)
        .select(columns)
        .eq(idColumn, id)
        .maybeSingle();
    return response;
  }

  /// Insert new record
  Future<Map<String, dynamic>> insert(
    String table,
    Map<String, dynamic> data,
  ) async {
    final response = await client.from(table).insert(data).select().single();
    return response;
  }

  /// Update existing record
  Future<Map<String, dynamic>> update(
    String table,
    String id,
    Map<String, dynamic> data, {
    String idColumn = 'id',
  }) async {
    final response = await client
        .from(table)
        .update(data)
        .eq(idColumn, id)
        .select()
        .single();
    return response;
  }

  /// Soft delete record (set deleted_at)
  Future<void> softDelete(
    String table,
    String id, {
    String idColumn = 'id',
  }) async {
    await client
        .from(table)
        .update({'deleted_at': DateTime.now().toIso8601String()})
        .eq(idColumn, id);
  }

  // ============================================================
  // Realtime Subscriptions
  // ============================================================

  /// Subscribe to table changes
  ///
  /// Example:
  /// ```dart
  /// supabaseService.subscribe(
  ///   'notifications',
  ///   onInsert: (payload) => print('New: $payload'),
  ///   onUpdate: (payload) => print('Updated: $payload'),
  /// );
  /// ```
  RealtimeChannel subscribe(
    String table, {
    void Function(Map<String, dynamic>)? onInsert,
    void Function(Map<String, dynamic>)? onUpdate,
    void Function(Map<String, dynamic>)? onDelete,
    String? tenantId,
  }) {
    String channelName = 'realtime:$table';
    if (tenantId != null) {
      channelName += ':$tenantId';
    }

    final channel = client.channel(channelName);

    if (onInsert != null) {
      channel.onPostgresChanges(
        event: PostgresChangeEvent.insert,
        schema: 'public',
        table: table,
        callback: (payload) => onInsert(payload.newRecord),
      );
    }

    if (onUpdate != null) {
      channel.onPostgresChanges(
        event: PostgresChangeEvent.update,
        schema: 'public',
        table: table,
        callback: (payload) => onUpdate(payload.newRecord),
      );
    }

    if (onDelete != null) {
      channel.onPostgresChanges(
        event: PostgresChangeEvent.delete,
        schema: 'public',
        table: table,
        callback: (payload) => onDelete(payload.oldRecord),
      );
    }

    channel.subscribe();
    return channel;
  }

  /// Unsubscribe from channel
  Future<void> unsubscribe(RealtimeChannel channel) async {
    await client.removeChannel(channel);
  }

  // ============================================================
  // Storage Helpers
  // ============================================================

  /// Get public URL for storage file
  String getPublicUrl(String bucket, String path) {
    return client.storage.from(bucket).getPublicUrl(path);
  }

  // ============================================================
  // Edge Functions
  // ============================================================

  /// Invoke Supabase Edge Function
  ///
  /// Example:
  /// ```dart
  /// final result = await supabaseService.invokeFunction(
  ///   'process-payment',
  ///   body: {'amount': 100},
  /// );
  /// ```
  Future<Map<String, dynamic>> invokeFunction(
    String functionName, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  }) async {
    final response = await client.functions.invoke(
      functionName,
      body: body,
      headers: headers,
    );
    return response.data as Map<String, dynamic>;
  }
}

/// Global instance for easy access
final supabaseService = SupabaseService();
