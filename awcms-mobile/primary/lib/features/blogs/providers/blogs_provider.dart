/// AWCMS Mobile - Blogs Providers
///
/// Riverpod providers for managing blogs.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/database/app_database.dart';
import '../../../core/database/daos/blogs_dao.dart';
import '../../../core/services/sync_service.dart';

/// Provider for Blogs DAO
final blogsDaoProvider = Provider<BlogsDao>((ref) {
  final db = ref.watch(appDatabaseProvider);
  return BlogsDao(db);
});

/// Provider for watching all published blogs
final blogsProvider = StreamProvider.family<List<LocalBlog>, String?>((
  ref,
  tenantId,
) {
  final dao = ref.watch(blogsDaoProvider);
  return dao.watchPublishedBlogs(tenantId: tenantId);
});

/// Provider for watching a specific blog
final blogDetailProvider = StreamProvider.family<LocalBlog?, String>((ref, id) {
  final dao = ref.watch(blogsDaoProvider);
  return dao.watchBlogById(id);
});

/// Provider for searching blogs
final blogSearchProvider =
    FutureProvider.family<List<LocalBlog>, Map<String, String?>>((ref, params) {
      final dao = ref.watch(blogsDaoProvider);
      final query = params['query'] ?? '';
      final tenantId = params['tenantId'];
      return dao.searchBlogs(query, tenantId: tenantId);
    });

/// Provider for blog count
final blogCountProvider = FutureProvider<int>((ref) {
  final dao = ref.watch(blogsDaoProvider);
  return dao.getBlogCount();
});
