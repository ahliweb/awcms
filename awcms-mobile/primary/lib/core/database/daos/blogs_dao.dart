/// AWCMS Mobile - Blogs DAO
///
/// Data Access Object for local blogs operations.
library;

import 'package:drift/drift.dart';
import '../app_database.dart';
import '../tables/blogs_table.dart';

part 'blogs_dao.g.dart';

/// DAO for blogs CRUD operations
@DriftAccessor(tables: [LocalBlogs])
class BlogsDao extends DatabaseAccessor<AppDatabase> with _$BlogsDaoMixin {
  BlogsDao(super.db);

  /// Get all published blogs for a tenant
  Future<List<LocalBlog>> getPublishedBlogs({String? tenantId}) {
    final query = select(localBlogs)
      ..where((t) => t.status.equals('published'))
      ..orderBy([(t) => OrderingTerm.desc(t.createdAt)]);

    if (tenantId != null) {
      query.where((t) => t.tenantId.equals(tenantId));
    }

    return query.get();
  }

  /// Get blog by ID
  Future<LocalBlog?> getBlogById(String id) {
    return (select(
      localBlogs,
    )..where((t) => t.id.equals(id))).getSingleOrNull();
  }

  /// Watch all published blogs (reactive)
  Stream<List<LocalBlog>> watchPublishedBlogs({String? tenantId}) {
    final query = select(localBlogs)
      ..where((t) => t.status.equals('published'))
      ..orderBy([(t) => OrderingTerm.desc(t.createdAt)]);

    if (tenantId != null) {
      query.where((t) => t.tenantId.equals(tenantId));
    }

    return query.watch();
  }

  /// Watch single blog
  Stream<LocalBlog?> watchBlogById(String id) {
    return (select(
      localBlogs,
    )..where((t) => t.id.equals(id))).watchSingleOrNull();
  }

  /// Insert or update blog from Supabase
  Future<void> upsertBlog(LocalBlogsCompanion blog) {
    return into(localBlogs).insertOnConflictUpdate(blog);
  }

  /// Batch upsert blogs
  Future<void> upsertBlogs(List<LocalBlogsCompanion> blogs) {
    return batch((batch) {
      for (final blog in blogs) {
        batch.insert(localBlogs, blog, onConflict: DoUpdate((_) => blog));
      }
    });
  }

  /// Delete blog
  Future<int> deleteBlog(String id) {
    return (delete(localBlogs)..where((t) => t.id.equals(id))).go();
  }

  /// Get count of cached blogs
  Future<int> getBlogCount() async {
    final count = countAll();
    final query = selectOnly(localBlogs)..addColumns([count]);
    final result = await query.getSingle();
    return result.read(count) ?? 0;
  }

  /// Search blogs by title
  Future<List<LocalBlog>> searchBlogs(String query, {String? tenantId}) {
    final searchQuery = select(localBlogs)
      ..where((t) => t.title.like('%$query%'))
      ..where((t) => t.status.equals('published'))
      ..orderBy([(t) => OrderingTerm.desc(t.createdAt)])
      ..limit(20);

    if (tenantId != null) {
      searchQuery.where((t) => t.tenantId.equals(tenantId));
    }

    return searchQuery.get();
  }
}
