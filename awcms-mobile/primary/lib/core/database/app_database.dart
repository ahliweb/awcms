/// AWCMS Mobile - App Database
///
/// Main Drift database definition with all tables and DAOs.
library;

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'tables/blogs_table.dart';
import 'tables/sync_queue_table.dart';
import 'tables/sync_metadata_table.dart';
import 'daos/blogs_dao.dart';
import 'daos/sync_dao.dart';

part 'app_database.g.dart';

/// Main application database
@DriftDatabase(
  tables: [LocalBlogs, SyncQueue, SyncMetadata],
  daos: [BlogsDao, SyncDao],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor]) : super(executor ?? _openConnection());

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration {
    return MigrationStrategy(
      onCreate: (Migrator m) async {
        await m.createAll();
      },
      onUpgrade: (Migrator m, int from, int to) async {
        // Handle future migrations here
      },
    );
  }

  /// Open connection using drift_flutter
  static QueryExecutor _openConnection() {
    return driftDatabase(name: 'awcms_mobile');
  }

  /// Clear all data (for logout/reset)
  Future<void> clearAllData() async {
    await delete(localBlogs).go();
    await delete(syncQueue).go();
    await delete(syncMetadata).go();
  }
}
