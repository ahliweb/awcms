
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
    console.error('Missing Supabase credentials. check .env file.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey);

async function backfillLocale() {
    console.log('Starting backfill of locale data...');

    // 1. Pages
    const { data: pages, error: pagesError } = await supabase
        .from('pages')
        .select('id, title, slug')
        .is('locale', null); // Check for NULL explicitly if default didn't apply retrospectively or just to be safe

    if (pagesError) {
        console.error('Error fetching pages:', pagesError);
    } else {
        console.log(`Found ${pages.length} pages to check/update.`);
        // In theory, the migration default 'en' should handle new inserts, but let's ensure existing ones are 'en'
        // Actually, adding a column with DEFAULT 'en' fills existing rows too. 
        // So this might just be a verification step or "fix" if something went wrong.

        // However, the task also mentions: "Fix: Re-run migration script ... force update to visual + populate layout_data"
        // Let's do that part specifically.
    }

    // 2. Fix Visual Editor Pages (Legacy Migration Fix)
    console.log('Fixing Visual Editor types...');
    const visualCandidates = ['home', 'about', 'services', 'contact', 'pricing', 'features'];

    const { data: legacyPages, error: legacyError } = await supabase
        .from('pages')
        .select('*')
        .in('slug', visualCandidates);

    if (legacyError) console.error('Error fetching legacy pages:', legacyError);

    for (const page of legacyPages || []) {
        if (page.editor_type !== 'visual') {
            console.log(`Converting page "${page.title}" (${page.slug}) to Visual Editor...`);

            const { error: updateError } = await supabase
                .from('pages')
                .update({
                    editor_type: 'visual',
                    // Ensure we have at least an empty layout if null
                    puck_layout_jsonb: page.puck_layout_jsonb || { props: {}, root: { props: { title: page.title } }, content: [], zones: {} }
                })
                .eq('id', page.id);

            if (updateError) console.error(`Failed to update ${page.slug}:`, updateError);
            else console.log(`Successfully updated ${page.slug}`);
        } else {
            console.log(`Page "${page.title}" (${page.slug}) is already Visual.`);
        }
    }

    // 3. Verify Locale is 'en' for all
    const { error: localeError } = await supabase
        .from('pages')
        .update({ locale: 'en' })
        .is('locale', null);

    if (localeError) console.error('Error backfilling NULL locales:', localeError);

    console.log('Backfill complete.');
}

backfillLocale();
