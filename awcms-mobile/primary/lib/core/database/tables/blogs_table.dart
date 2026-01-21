/// AWCMS Mobile - Local Blogs Table
///
/// Drift table definition for offline blogs storage.
library;

import 'package:drift/drift.dart';

/// Local cache of blogs from Supabase
@DataClassName('LocalBlog')
class LocalBlogs extends Table {
  /// Blog UUID from Supabase
  TextColumn get id => text()();

  /// Tenant ID for multi-tenant support
  TextColumn get tenantId => text().nullable()();

  /// Blog title
  TextColumn get title => text()();

  /// Full HTML content
  TextColumn get content => text().nullable()();

  /// Short excerpt
  TextColumn get excerpt => text().nullable()();

  /// Cover image URL
  TextColumn get coverImage => text().nullable()();

  /// Publication status
  TextColumn get status => text().withDefault(const Constant('draft'))();

  /// Author ID
  TextColumn get ownerId => text().nullable()();

  /// Timestamps
  DateTimeColumn get createdAt => dateTime().nullable()();
  DateTimeColumn get updatedAt => dateTime().nullable()();

  /// When this record was last synced
  DateTimeColumn get syncedAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
