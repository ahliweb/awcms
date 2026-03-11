DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'drop trigger if exists "protect_buckets_delete" on "storage"."buckets"';
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'drop trigger if exists "protect_objects_delete" on "storage"."objects"';
  END IF;
END $$;

