DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'Skipping storage.objects policies and triggers; relation is unavailable.';
  ELSE
    EXECUTE $policy$
      create policy "public_read_files"
      on "storage"."objects"
      as permissive
      for select
      to public
      using ((bucket_id = 'cms-uploads'::text))
    $policy$;

    EXECUTE $policy$
      create policy "tenant_delete_isolation"
      on "storage"."objects"
      as permissive
      for delete
      to authenticated
      using (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())))
    $policy$;

    EXECUTE $policy$
      create policy "tenant_select_isolation"
      on "storage"."objects"
      as permissive
      for select
      to authenticated
      using (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())))
    $policy$;

    EXECUTE $policy$
      create policy "tenant_update_isolation"
      on "storage"."objects"
      as permissive
      for update
      to authenticated
      using (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())))
    $policy$;

    EXECUTE $policy$
      create policy "tenant_upload_isolation"
      on "storage"."objects"
      as permissive
      for insert
      to authenticated
      with check (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())))
    $policy$;

    DROP TRIGGER IF EXISTS tr_sync_storage_to_files ON storage.objects;
    CREATE TRIGGER tr_sync_storage_to_files AFTER INSERT OR DELETE OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.handle_storage_sync();

    DROP TRIGGER IF EXISTS update_objects_updated_at ON storage.objects;
    CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();
  END IF;

  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'Skipping storage.buckets triggers; relation is unavailable.';
  ELSE
    DROP TRIGGER IF EXISTS enforce_bucket_name_length_trigger ON storage.buckets;
    CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();
  END IF;
END $$;
