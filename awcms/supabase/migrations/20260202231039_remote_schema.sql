DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL
    AND to_regprocedure('storage.delete_prefix_hierarchy_trigger()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS objects_delete_delete_prefix ON storage.objects;
    CREATE TRIGGER objects_delete_delete_prefix
      AFTER DELETE ON storage.objects
      FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();
  ELSE
    RAISE NOTICE 'Skipping storage.objects delete prefix trigger.';
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL
    AND to_regprocedure('storage.objects_insert_prefix_trigger()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS objects_insert_create_prefix ON storage.objects;
    CREATE TRIGGER objects_insert_create_prefix
      BEFORE INSERT ON storage.objects
      FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();
  ELSE
    RAISE NOTICE 'Skipping storage.objects insert prefix trigger.';
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL
    AND to_regprocedure('storage.objects_update_prefix_trigger()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS objects_update_create_prefix ON storage.objects;
    CREATE TRIGGER objects_update_create_prefix
      BEFORE UPDATE ON storage.objects
      FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id)))
      EXECUTE FUNCTION storage.objects_update_prefix_trigger();
  ELSE
    RAISE NOTICE 'Skipping storage.objects update prefix trigger.';
  END IF;

  IF to_regclass('storage.prefixes') IS NOT NULL
    AND to_regprocedure('storage.prefixes_insert_trigger()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS prefixes_create_hierarchy ON storage.prefixes;
    CREATE TRIGGER prefixes_create_hierarchy
      BEFORE INSERT ON storage.prefixes
      FOR EACH ROW WHEN ((pg_trigger_depth() < 1))
      EXECUTE FUNCTION storage.prefixes_insert_trigger();
  ELSE
    RAISE NOTICE 'Skipping storage.prefixes insert trigger.';
  END IF;

  IF to_regclass('storage.prefixes') IS NOT NULL
    AND to_regprocedure('storage.delete_prefix_hierarchy_trigger()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS prefixes_delete_hierarchy ON storage.prefixes;
    CREATE TRIGGER prefixes_delete_hierarchy
      AFTER DELETE ON storage.prefixes
      FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();
  ELSE
    RAISE NOTICE 'Skipping storage.prefixes delete trigger.';
  END IF;
END $$;
