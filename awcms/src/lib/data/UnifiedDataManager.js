import { supabase } from '@/lib/customSupabaseClient';

const CACHE_PREFIX = 'udm_cache_';
const CACHE_TTL = 60 * 1000; // 60 Seconds default TTL

/**
 * UnifiedDataManager
 * Abstracts data access and provides Local Storage Caching for performance.
 * Replaces the previous Offline-First (SQLite) architecture with a Cache-First approach.
 */
class UnifiedDataManager {
    constructor(table) {
        this.table = table;
        this.query = {
            type: 'select', // select, insert, update, delete
            columns: '*',
            options: {},    // { count: 'exact' }
            filters: [],
            orders: [],
            range: null,    // { from, to }
            limit: null,
            single: false,
            payload: null
        };
    }

    static from(table) {
        return new UnifiedDataManager(table);
    }

    select(columns = '*', options = {}) {
        this.query.type = 'select';
        this.query.columns = columns;
        this.query.options = options;
        return this;
    }

    insert(payload) {
        this.query.type = 'insert';
        this.query.payload = payload;
        return this;
    }

    update(payload) {
        this.query.type = 'update';
        this.query.payload = payload;
        return this;
    }

    delete() {
        this.query.type = 'delete';
        return this;
    }

    // --- FILTERS ---

    eq(column, value) {
        this.query.filters.push({ column, operator: '=', value });
        return this;
    }

    neq(column, value) {
        this.query.filters.push({ column, operator: '!=', value });
        return this;
    }

    in(column, values) {
        this.query.filters.push({ column, operator: 'IN', value: values });
        return this;
    }

    is(column, value) {
        this.query.filters.push({ column, operator: 'IS', value });
        return this;
    }

    not(column, operator, value) {
        if (operator === 'is') {
            this.query.filters.push({ column, operator: 'IS NOT', value });
        } else {
            this.query.filters.push({ column, operator: 'NOT ' + operator, value });
        }
        return this;
    }

    ilike(column, value) {
        this.query.filters.push({ column, operator: 'ILIKE', value });
        return this;
    }

    // --- ORDER / PAGE ---

    order(column, { ascending = true } = {}) {
        this.query.orders.push({ column, ascending });
        return this;
    }

    range(from, to) {
        this.query.range = { from, to };
        return this;
    }

    limit(count) {
        this.query.limit = count;
        return this;
    }

    single() {
        this.query.single = true;
        return this;
    }

    /**
     * Executes the query.
     * Uses Local Storage Caching for optimization.
     */
    async then(resolve, reject) {
        try {
            // READ Operation
            if (this.query.type === 'select') {
                // 1. Check Cache
                const cachedData = this._getCache();
                if (cachedData) {
                    // console.log(`[UDM] Cache Hit: ${this.table}`);
                    resolve(cachedData);
                    // Optional: Re-validate in background (Stale-While-Revalidate) could be added here
                    return;
                }

                // 2. Remote Fetch
                const result = await this._executeRemote();

                // 3. Set Cache (if success)
                if (!result.error && result.data) {
                    this._setCache(result);
                }

                resolve(result);
                return;
            }

            // WRITE Operation (Insert/Update/Delete)
            // 1. Remote Write
            const result = await this._executeRemoteWrite();

            // 2. Invalidate Cache for this table (simple invalidation)
            if (!result.error) {
                this._invalidateCache();
            }

            resolve(result);

        } catch (error) {
            console.error('[UDM] Execution Error:', error);
            reject(error);
        }
    }

    // --- CACHE INTERNALS ---

    _generateCacheKey() {
        // Create a unique key based on table and all query parameters
        // Sort filters and orders to ensure consistent keys
        const q = this.query;
        const keyObj = {
            table: this.table,
            type: q.type,
            cols: q.columns,
            opts: q.options,
            // Sort filters by column to ensure order doesn't matter
            filters: [...q.filters].sort((a, b) => a.column.localeCompare(b.column)),
            orders: q.orders,
            range: q.range,
            limit: q.limit,
            single: q.single
        };
        return CACHE_PREFIX + JSON.stringify(keyObj);
    }

    _getCache() {
        try {
            const key = this._generateCacheKey();
            const raw = localStorage.getItem(key);
            if (!raw) return null;

            const entry = JSON.parse(raw);
            const now = Date.now();

            if (now - entry.timestamp > CACHE_TTL) {
                // Expired
                localStorage.removeItem(key);
                return null;
            }

            return entry.data; // { data, error, count }
        } catch (e) {
            console.warn('[UDM] Cache Read Failed:', e);
            return null;
        }
    }

    _setCache(resultData) {
        try {
            const key = this._generateCacheKey();
            const entry = {
                timestamp: Date.now(),
                data: resultData
            };
            localStorage.setItem(key, JSON.stringify(entry));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.warn('[UDM] LocalStorage Full. Clearing old cache...');
                this._clearOldCache();
            } else {
                console.warn('[UDM] Cache Write Failed:', e);
            }
        }
    }

    _invalidateCache() {
        try {
            // Simple Strategy: Remove ALL cache entries for this TABLE
            // Since strict keys include filters, determining exact keys to invalidate is hard.
            // Clearing all 'udm_cache_{ "table": "X" ... }' is safer.

            // Helper to match prefix
            const targetPrefix = `${CACHE_PREFIX}{"table":"${this.table}"`;

            // Iterate and remove
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(CACHE_PREFIX) && key.includes(`"table":"${this.table}"`)) {
                    keysToRemove.push(key);
                }
            }

            keysToRemove.forEach(k => localStorage.removeItem(k));
            console.log(`[UDM] Invalidated ${keysToRemove.length} cache entries for table: ${this.table}`);
        } catch (e) {
            console.warn('[UDM] Cache Invalidation Failed:', e);
        }
    }

    _clearOldCache() {
        // Fallback: Clear all UDM cache if quota exceeded
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
        });
    }

    // --- REMOTE EXECUTION ---

    async _executeRemote() {
        let builder = supabase.from(this.table);

        // READ Logic
        if (this.query.type === 'select') {
            builder = builder.select(this.query.columns, this.query.options);
            this._applyFilters(builder);

            if (this.query.single) {
                builder = builder.single();
            }

            if (this.query.range) {
                builder = builder.range(this.query.range.from, this.query.range.to);
            }

            return builder;
        }

        return { data: null, error: null };
    }

    async _executeRemoteWrite() {
        let builder = supabase.from(this.table);

        // INSERT
        if (this.query.type === 'insert') {
            return builder.insert(this.query.payload);
        }

        // UPDATE
        if (this.query.type === 'update') {
            builder = builder.update(this.query.payload);
            this.query.filters.forEach(f => {
                if (f.operator === '=') builder = builder.eq(f.column, f.value);
                if (f.operator === '!=') builder = builder.neq(f.column, f.value);
            });
            return builder;
        }

        // DELETE
        if (this.query.type === 'delete') {
            builder = builder.update({ deleted_at: new Date().toISOString() });
            this.query.filters.forEach(f => {
                if (f.operator === '=') builder = builder.eq(f.column, f.value);
                if (f.operator === '!=') builder = builder.neq(f.column, f.value);
            });
            return builder;
        }

        return { data: null, error: null };
    }

    _applyFilters(builder) {
        this.query.filters.forEach(f => {
            if (f.operator === '=') builder.eq(f.column, f.value);
            if (f.operator === '!=') builder.neq(f.column, f.value);
            if (f.operator === 'IN') builder.in(f.column, f.value);
            if (f.operator === 'IS') builder.is(f.column, f.value);
            if (f.operator === 'IS NOT') builder.not(f.column, 'is', f.value);
            if (f.operator === 'ILIKE') builder.ilike(f.column, f.value);
        });
        this.query.orders.forEach(o => {
            builder.order(o.column, { ascending: o.ascending });
        });
        if (this.query.limit) builder.limit(this.query.limit);
    }
}

export const udm = UnifiedDataManager;
