const fs = require('fs');

const inputFile = 'supabase/migrations/raw_storage_dump.sql';
const outputFile = 'supabase/migrations/20260201140600_fix_storage_schema.sql';

try {
    const content = fs.readFileSync(inputFile, 'utf8');

    // Regex to match CREATE OR REPLACE FUNCTION blocks
    const regex = /CREATE OR REPLACE FUNCTION[\s\S]*?\$\w*\$;/g;

    const matches = content.match(regex);

    if (matches) {
        // Reordering logic
        // Helper to find index of function definition
        // Note: The dump might quote names differently, but usually "storage"."name" matches
        const findFn = (name) => matches.findIndex(m => m.includes(`FUNCTION "storage"."${name}"`));

        // Dependencies to move to top
        const priorityFuncs = ['get_level', 'get_prefix', 'get_prefixes'];
        const prioritized = [];

        // Extract priority functions
        for (const name of priorityFuncs) {
            const idx = findFn(name);
            if (idx !== -1) {
                prioritized.push(matches[idx]);
                // Remove from original array so we don't duplicate
                // But removing by index shifts indices? 
                // Better to mark as used or filter. We are splicing which is fine if we search fresh each time or traverse carefully.
                // Actually, if we splice, the indices change.
                // But findIndex searches fresh on 'matches' (which is mutated).
                // Yes, splicing modifies 'matches' in place.
                matches.splice(idx, 1);
            } else {
                console.warn(`Warning: function ${name} not found in dump.`);
            }
        }

        // Combine: prioritized + rest
        const finalMatches = [...prioritized, ...matches];

        // Add the SET option at the top
        const finalSql = "SET check_function_bodies = false;\n\n" + finalMatches.join('\n\n');

        // Remove OWNER TO statements from the blocks if any made it into the block (usually they are separate statements in dump)
        // The regex usually stops at $tag$; so OWNER TO (which is usually `ALTER FUNCTION ... OWNER TO ...;`) is mostly EXCLUDED by the regex!
        // Wait, the regex `CREATE ... $tag$;` will NOT include the subsequent `ALTER FUNCTION ... OWNER TO ...;`.
        // This is GOOD! We don't want OWNER TO.
        // So we don't need to replace them.

        // But just in case some weird formatting
        const cleanSql = finalSql.replace(/ALTER FUNCTION.*?OWNER TO.*?;/g, '');

        fs.writeFileSync(outputFile, cleanSql);
        console.log(`Extracted ${finalMatches.length} functions to ${outputFile} (reordered)`);
    } else {
        console.log('No functions found.');
    }

} catch (err) {
    console.error(err);
    process.exit(1);
}
