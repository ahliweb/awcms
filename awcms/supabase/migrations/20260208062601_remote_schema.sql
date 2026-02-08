-- Storage internal functions (Moved to public schema to bypass local "storage" schema permission restrictions)
CREATE OR REPLACE FUNCTION public.delete_prefix_hierarchy_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'prefixes') THEN
    DELETE FROM storage.prefixes
    WHERE name = OLD.name || '/' || OLD.id;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.objects_insert_prefix_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'prefixes') THEN
    INSERT INTO storage.prefixes (name, bucket_id)
    VALUES (NEW.name, NEW.bucket_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.objects_update_prefix_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'prefixes') THEN
    IF NEW.name <> OLD.name OR NEW.bucket_id <> OLD.bucket_id THEN
      INSERT INTO storage.prefixes (name, bucket_id)
      VALUES (NEW.name, NEW.bucket_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prefixes_insert_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'prefixes') THEN
    INSERT INTO storage.prefixes (name, bucket_id)
    SELECT substring(NEW.name from 1 for (char_length(NEW.name) - char_length(split_part(NEW.name, '/', array_upper(string_to_array(NEW.name, '/'), 1))) - 1)), NEW.bucket_id
    WHERE NEW.name LIKE '%/%'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- Robust trigger creation with existence checks
DO $$
BEGIN
  -- storage.objects triggers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'objects_delete_delete_prefix') THEN
      CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.delete_prefix_hierarchy_trigger();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'objects_insert_create_prefix') THEN
      CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.objects_insert_prefix_trigger();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'objects_update_create_prefix') THEN
      CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION public.objects_update_prefix_trigger();
    END IF;
  END IF;

  -- storage.prefixes triggers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'prefixes') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prefixes_create_hierarchy') THEN
      CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION public.prefixes_insert_trigger();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prefixes_delete_hierarchy') THEN
      CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION public.delete_prefix_hierarchy_trigger();
    END IF;
  END IF;
END $$;


