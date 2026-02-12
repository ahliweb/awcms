SET statement_timeout = '10s';
SELECT c.relname as tablename, p.polname as policyname, p.polcmd as cmd, p.polpermissive as permissive
FROM pg_policy p
JOIN pg_class c ON p.polrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND p.polpermissive = true
AND c.relname IN ('blogs','categories','funfacts','orders','partners','services','teams')
ORDER BY c.relname, p.polcmd, p.polname;
