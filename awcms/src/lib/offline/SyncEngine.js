import { supabase } from '@/lib/customSupabaseClient';
import { runQuery, runBatch } from '@/lib/offline/db';
import { SYNC_TABLES, TABLE_SCHEMAS, generateCreateTable } from '@/lib/offline/schemaConverter';

/**
 * SyncEngine
 * Manages bidirectional synchronization between Supabase and Local SQLite.
 */
class SyncEngine {
    constructor() {
        this.isSyncing = false;
        this.onlineListener = null;
        this.initialized = false;
    }

    /**
     * Initializes internal sync tables and the sync engine.
     */
    async init() {
        if (this.initialized) return;
        console.log('[SyncEngine] Initializing...');

        // 1. Create Internal Tables
        await runQuery(`
      CREATE TABLE IF NOT EXISTS _sync_meta (
        table_name TEXT PRIMARY KEY,
        last_pulled_at TEXT
      );
    `);

        await runQuery(`
      CREATE TABLE IF NOT EXISTS _sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        action TEXT NOT NULL, -- INSERT, UPDATE, DELETE
        payload TEXT NOT NULL, -- JSON
        status TEXT DEFAULT 'PENDING', -- PENDING, SYNCED, FAILED
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        error_msg TEXT
      );
    `);

        // 2. Initialize App Tables
        for (const table of SYNC_TABLES) {
            const columns = TABLE_SCHEMAS[table];
            if (columns) {
                const sql = generateCreateTable(table, columns);
                await runQuery(sql);
            }
        }
        console.log(`[SyncEngine] Initialized ${SYNC_TABLES.length} local tables.`);

        // 3. Start Listeners
        this.startAutoSync();
        this.initialized = true;
    }

    startAutoSync() {
        if (this.onlineListener) return;

        const handleOnline = () => {
            console.log('[SyncEngine] Online detected. Starting Push...');
            this.pushChanges();
        };

        window.addEventListener('online', handleOnline);
        this.onlineListener = handleOnline;

        // Initial Push if online
        if (navigator.onLine) {
            this.pushChanges();
        }
    }

    /**
     * PULL: Fetches changes from Remote -> Local
     * @param {string} table 
     */
    async pull(table) {
        if (!navigator.onLine) return;

        try {
            console.log(`[SyncEngine] Pulling ${table}...`);

            // 1. Get Last Sync Time
            const meta = await runQuery('SELECT last_pulled_at FROM _sync_meta WHERE table_name = ?', [table]);
            const lastPulledAt = meta.length > 0 ? meta[0].last_pulled_at : '1970-01-01T00:00:00.000Z';

            // 2. Fetch from Supabase
            // Using 'updated_at' is standard. Assumes tables have updated_at.
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .gt('updated_at', lastPulledAt);

            if (error) throw error;
            if (!data || data.length === 0) {
                console.log(`[SyncEngine] No new data for ${table}`);
                return;
            }

            console.log(`[SyncEngine] Received ${data.length} rows for ${table}`);

            // 3. Upsert into Local SQLite
            // SQLite UPSERT: INSERT INTO ... ON CONFLICT(id) DO UPDATE SET ...
            // We need to know columns. For now assumig we can extract keys.
            if (data.length > 0) {
                const columns = Object.keys(data[0]);
                const placeholders = columns.map(() => '?').join(',');
                const updates = columns.map(c => `"${c}"=excluded."${c}"`).join(',');

                const sql = `
          INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')})
          VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET ${updates}
        `;

                const queries = data.map(row => ({
                    sql: sql,
                    params: columns.map(c => {
                        const val = row[c];
                        return (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val;
                    })
                }));

                await runBatch(queries);
            }

            // 4. Update Meta
            const maxTime = data.reduce((max, r) => r.updated_at > max ? r.updated_at : max, lastPulledAt);
            await runQuery(`
        INSERT INTO _sync_meta (table_name, last_pulled_at)
        VALUES (?, ?)
        ON CONFLICT(table_name) DO UPDATE SET last_pulled_at=excluded.last_pulled_at
      `, [table, maxTime]);

            console.log(`[SyncEngine] Pull ${table} complete. New watermark: ${maxTime}`);

        } catch (err) {
            console.error(`[SyncEngine] Pull failed for ${table}:`, err);
        }
    }

    /**
     * PUSH: Sends Local Changes -> Remote
     */
    async pushChanges() {
        if (this.isSyncing || !navigator.onLine) return;
        this.isSyncing = true;

        try {
            // 1. Get Pending Items
            const pending = await runQuery(`
        SELECT * FROM _sync_queue 
        WHERE status = 'PENDING' 
        ORDER BY created_at ASC
      `);

            if (pending.length === 0) {
                this.isSyncing = false;
                return;
            }

            console.log(`[SyncEngine] Pushing ${pending.length} changes...`);

            for (const item of pending) {
                const payload = JSON.parse(item.payload);
                const { table_name, action, id } = item;

                try {
                    if (action === 'INSERT') {
                        const { error } = await supabase.from(table_name).insert(payload);
                        if (error) throw error;
                    } else if (action === 'UPDATE') {
                        // Basic Conflict Resolution: Last Write Wins (Supabase handles it usually)
                        // We just push.
                        const { error } = await supabase.from(table_name).update(payload).eq('id', payload.id);
                        if (error) throw error;
                    } else if (action === 'DELETE') {
                        const { error } = await supabase.from(table_name).delete().eq('id', payload.id);
                        if (error) throw error;
                    }

                    // Mark Synced
                    await runQuery('UPDATE _sync_queue SET status = ?, error_msg = NULL WHERE id = ?', ['SYNCED', id]);

                } catch (err) {
                    console.error(`[SyncEngine] Push failed for item ${id}:`, err);
                    // Mark Failed but keep in queue or retry?
                    // For now mark FAILED so we don't loop forever blocking others.
                    await runQuery('UPDATE _sync_queue SET status = ?, error_msg = ? WHERE id = ?', ['FAILED', err.message, id]);
                }
            }

        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Queues a local mutation to be synced.
     */
    async queueMutation(table, action, payload) {
        // 1. Write to Queue
        await runQuery(`
      INSERT INTO _sync_queue (table_name, action, payload, status)
      VALUES (?, ?, ?, 'PENDING')
    `, [table, action, JSON.stringify(payload)]);

        // 2. Try to push immediately if online
        if (navigator.onLine) {
            this.pushChanges(); // Non-blocking
        }
    }
}

export const syncEngine = new SyncEngine();
