
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4Y2xuaHxrYnh1eG95YmJ0ZnYiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzM5MzMyNDQ2LCJleHAiOjIwNTQ5MDg0NDZ9.SERVICE_ROLE_KEY_PLACEHOLDER';

// Override with the hardcoded one if needed, or just use the one from env if it works. 
// But since previous script used hardcoded, I will use same approach for consistency if env fails.
// Actually, let's try to use the one from the migration script.

const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_KEY || supabaseServiceKey);

async function verify() {
    const { data: pages, error } = await supabase
        .from('pages')
        .select('slug, title, editor_type, status')
        .in('slug', ['about', 'services', 'pricing', 'contact']);

    if (error) {
        console.error('Error fetching pages:', error);
        return;
    }

    console.table(pages);
}

verify();
