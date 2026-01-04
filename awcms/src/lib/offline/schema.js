/**
 * schema.js
 * Defines the local schema for the Offline-First architecture.
 * Mirrors key Supabase tables to SQLite (wa-sqlite).
 */

export const CORE_SCHEMA = [
    // Tenants (Global Context)
    `CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    logo_url TEXT,
    subscription_tier TEXT DEFAULT 'free',
    config JSON,
    created_at TEXT,
    updated_at TEXT
  );`,

    // Users (Auth Context)
    `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    role_id TEXT,
    tenant_id TEXT,
    created_at TEXT,
    updated_at TEXT
  );`,

    // Articles (Content)
    `CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    title TEXT,
    slug TEXT,
    content TEXT,
    excerpt TEXT,
    featured_image TEXT,
    status TEXT DEFAULT 'draft',
    author_id TEXT,
    category_id TEXT,
    tags TEXT, -- JSON array or comma separated
    is_active INTEGER DEFAULT 1, -- Boolean as Integer
    is_public INTEGER DEFAULT 1,
    published_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    
    -- Offline Sync Metadata
    _sync_status TEXT DEFAULT 'synced', -- 'synced', 'pending_insert', 'pending_update', 'pending_delete'
    _last_synced_at TEXT
  );`,

    // Pages (Content)
    `CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    title TEXT,
    slug TEXT,
    content TEXT,
    status TEXT DEFAULT 'draft',
    published_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    editor_type TEXT DEFAULT 'richtext',
    puck_layout_jsonb TEXT, -- JSON string
    
    -- Offline Sync Metadata
    _sync_status TEXT DEFAULT 'synced',
    _last_synced_at TEXT
  );`,

    // Files (Media)
    `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT,
    file_path TEXT,
    file_size INTEGER,
    file_type TEXT,
    is_public INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    
    -- Offline Sync Metadata
    _sync_status TEXT DEFAULT 'synced',
    _last_synced_at TEXT
  );`
];

/**
 * Applies the schema to the database instance.
 * @param {object} db - SQLite database instance
 * @param {function} runQuery - Helper to run queries
 */
export async function applySchema(runQuery) {
    console.log('[Offline] Applying Local Schema...');

    for (const query of CORE_SCHEMA) {
        try {
            await runQuery(query);
        } catch (err) {
            console.error('[Offline] Schema Error:', err, query);
            // Don't throw, try to continue or handle gracefully
        }
    }

    // Verify
    try {
        const tables = await runQuery("SELECT name FROM sqlite_master WHERE type='table'");
        console.log('[Offline] Tables created:', tables.map(t => t.name));
    } catch (e) {
        console.error('[Offline] Verification failed', e);
    }
}
