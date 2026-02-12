-- Check policies for the consolidated tables
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd 
FROM pg_policies 
WHERE tablename IN ('blogs', 'categories', 'funfacts', 'orders', 'partners', 'services', 'teams')
ORDER BY tablename, cmd;
