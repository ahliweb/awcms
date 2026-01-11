
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Credentials extracted from .env
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://imveukxxtdwjgwsafwfl.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY is missing in .env');
    console.error('Please add it to your .env file (do NOT commit .env).');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runCleanup() {
    console.log('Running Cleanup (Merge Roles)...');

    // 1. Get IDs
    const { data: ownerRole } = await supabase.from('roles').select('id').eq('name', 'owner').single();
    const { data: oldRole } = await supabase.from('roles').select('id').eq('name', 'super_super_admin').single();

    if (!ownerRole) {
        console.error('Error: Owner role missing! Cannot merge.');
        return;
    }
    if (!oldRole) {
        console.log('Success: super_super_admin role already gone.');
        return;
    }

    console.log(`Merging super_super_admin (${oldRole.id}) -> owner (${ownerRole.id})...`);

    // 2. Move Users
    const { data: usersToMove, error: usersError } = await supabase
        .from('users')
        .update({ role_id: ownerRole.id })
        .eq('role_id', oldRole.id)
        .select();

    if (usersError) console.error('Error moving users:', usersError);
    else console.log(`Moved ${usersToMove.length} users to Owner role.`);

    // 3. Delete Old Role
    console.log('Deleting super_super_admin role...');
    // Requires deleting dependent rows first usually, but `role_permissions` has CASCADE usually. 
    // `users` referencing it are moved.

    // Check constraints via delete
    const { error: deleteError } = await supabase
        .from('roles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', oldRole.id);

    if (deleteError) {
        console.error('Error deleting role:', deleteError);
        console.log('Try deleting permissions first explicitly if needed...');
        await supabase.from('role_permissions').update({ deleted_at: new Date().toISOString() }).eq('role_id', oldRole.id);
        await supabase.from('role_policies').update({ deleted_at: new Date().toISOString() }).eq('role_id', oldRole.id);
        // Retry soft delete
        const { error: deleteError2 } = await supabase
            .from('roles')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', oldRole.id);
        if (deleteError2) console.error('Still failed:', deleteError2);
        else console.log('Role soft deleted.');
    } else {
        console.log('Role super_super_admin soft deleted successfully.');
    }

    console.log('Cleanup Complete.');
}

runCleanup();
