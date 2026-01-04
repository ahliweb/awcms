import * as SQLite from 'wa-sqlite';
import SQLiteAsyncESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import { applySchema } from './schema';

let sqlite3;
let db;

/**
 * Initializes the local SQLite database using IndexedDB backend (IDBBatchAtomicVFS).
 * This backend is highly performant and compatible with most modern browsers.
 */
export async function initDB() {
    if (db) return db;

    try {
        const module = await SQLiteAsyncESMFactory();
        sqlite3 = SQLite.Factory(module);

        // Use IDBBatchAtomicVFS for persistence
        const vfs = new IDBBatchAtomicVFS('awcms-local-db');
        sqlite3.vfs_register(vfs, true);

        db = await sqlite3.open_v2('awcms.sqlite',
            SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_CREATE,
            'awcms-local-db' // specific VFS name
        );

        console.log('[Offline] Local Database Initialized');

        // Apply Schema
        // We pass a bound runQuery function or just the raw helpers if we export them carefully.
        // But runQuery depends on db/sqlite3 vars which are module level here.
        // So we can wrap runQuery to pass to applySchema.
        await applySchema(async (sql, params) => {
            return runQuery(sql, params);
        });


        // Enable WAL mode for better concurrency if supported, or other PRAGMAs
        // await runQuery('PRAGMA journal_mode=WAL;'); // WAL not always supported in VFS

        return db;
    } catch (error) {
        console.error('[Offline] Failed to initialize local DB:', error);
        throw error;
    }
}

/**
 * Executes a SQL query against the local database.
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} - Result rows
 */
export async function runQuery(sql, params = []) {
    if (!db) {
        // Avoid infinite recursion if initDB calls runQuery -> applySchema -> runQuery -> initDB
        // However, initDB sets 'db' variable *before* calling applySchema? No, it sets it after open_v2.
        // 'db' is set at line 23. applySchema is called at line 34 (in replacement).
        // So 'db' is available.
        // But if runQuery checks !db -> initDB, and if initDB hasn't finished...
        // Ideally applySchema is called only once.
        // If runQuery is called explicitly from outside, it calls initDB.
        // If initDB calls applySchema -> runQuery, 'db' is set, so it skips initDB recursion.
        // Checks out.
        await initDB();
    }

    const str = sqlite3.str_new(db, sql);
    const prepared = await sqlite3.prepare_v2(db, sqlite3.str_value(str));

    try {
        if (params.length > 0) {
            sqlite3.bind_collection(prepared, params);
        }

        const rows = [];
        while ((await sqlite3.step(prepared)) === SQLite.SQLITE_ROW) {
            rows.push(sqlite3.column_values(prepared));
        }

        // Convert array of values to objects if column names are needed (requires extra step)
        // For now returning raw rows or we can map them if we fetch column names
        const columnNames = sqlite3.column_names(prepared);
        return rows.map(row => {
            const obj = {};
            columnNames.forEach((name, index) => {
                obj[name] = row[index];
            });
            return obj;
        });

    } finally {
        sqlite3.finalize(prepared);
    }
}

/**
 * Executes a batch of SQL queries in a transaction
 */
export async function runBatch(queries) {
    if (!db) await initDB();
    await runQuery('BEGIN TRANSACTION');
    try {
        for (const q of queries) {
            await runQuery(q.sql, q.params);
        }
        await runQuery('COMMIT');
    } catch (e) {
        await runQuery('ROLLBACK');
        throw e;
    }
}
