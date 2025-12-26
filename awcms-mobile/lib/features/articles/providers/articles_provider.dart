/// AWCMS Mobile - Articles Provider
///
/// Riverpod provider untuk mengambil data artikel dari Supabase.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/utils/tenant_utils.dart';

/// Provider untuk daftar artikel
final articlesProvider = FutureProvider<List<Map<String, dynamic>>>((
  ref,
) async {
  final tenantId = ref.watch(tenantIdProvider);

  var query = Supabase.instance.client
      .from('articles')
      .select('id, title, excerpt, cover_image, status, created_at')
      .eq('status', 'published')
      .isFilter('deleted_at', null);

  // Apply tenant filter if available
  if (tenantId != null) {
    query = query.eq('tenant_id', tenantId);
  }

  final response = await query.order('created_at', ascending: false);
  return List<Map<String, dynamic>>.from(response);
});

/// Provider untuk detail artikel by ID
final articleDetailProvider =
    FutureProvider.family<Map<String, dynamic>?, String>((
      ref,
      articleId,
    ) async {
      final response = await Supabase.instance.client
          .from('articles')
          .select('''
          id, 
          title, 
          content, 
          excerpt, 
          cover_image, 
          status, 
          created_at,
          author:profiles!articles_owner_id_fkey (
            id,
            name
          )
        ''')
          .eq('id', articleId)
          .isFilter('deleted_at', null)
          .maybeSingle();

      return response;
    });

/// Provider untuk search artikel
final articleSearchProvider =
    FutureProvider.family<List<Map<String, dynamic>>, String>((
      ref,
      query,
    ) async {
      if (query.length < 3) return [];

      final tenantId = ref.watch(tenantIdProvider);

      var dbQuery = Supabase.instance.client
          .from('articles')
          .select('id, title, excerpt, cover_image, created_at')
          .eq('status', 'published')
          .isFilter('deleted_at', null)
          .ilike('title', '%$query%');

      if (tenantId != null) {
        dbQuery = dbQuery.eq('tenant_id', tenantId);
      }

      final response = await dbQuery
          .order('created_at', ascending: false)
          .limit(20);

      return List<Map<String, dynamic>>.from(response);
    });
