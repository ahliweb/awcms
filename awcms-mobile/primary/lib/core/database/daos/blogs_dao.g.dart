// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'blogs_dao.dart';

// ignore_for_file: type=lint
mixin _$BlogsDaoMixin on DatabaseAccessor<AppDatabase> {
  $LocalBlogsTable get localBlogs => attachedDatabase.localBlogs;
  BlogsDaoManager get managers => BlogsDaoManager(this);
}

class BlogsDaoManager {
  final _$BlogsDaoMixin _db;
  BlogsDaoManager(this._db);
  $$LocalBlogsTableTableManager get localBlogs =>
      $$LocalBlogsTableTableManager(_db.attachedDatabase, _db.localBlogs);
}
