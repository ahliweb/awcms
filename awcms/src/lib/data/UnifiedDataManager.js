import { supabase } from '@/lib/customSupabaseClient';
import { runQuery } from '@/lib/offline/db';
import { syncEngine } from '@/lib/offline/SyncEngine';

/**
 * UnifiedDataManager
 * Abstracts data access to support Offline-First architecture.
 * Mimics Supabase SDK chaining syntax for easy migration.
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
        // value is typically null
        this.query.filters.push({ column, operator: 'IS', value });
        return this;
    }

    not(column, operator, value) {
        // Mapping 'is' to 'IS NOT' if operator is 'is'
        if (operator === 'is') {
            this.query.filters.push({ column, operator: 'IS NOT', value });
        } else {
            // generic not? Supabase 'not' is tricky. 
            // For simple 'not eq' we have neq. 
            // For now supporting the specific use case: .not('deleted_at', 'is', null)
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
     * Checks connection status and routes to Remote or Local.
     */
    async then(resolve, reject) {
        const isOnline = navigator.onLine;

        try {
            // READ Operation
            if (this.query.type === 'select') {
                let result;
                if (isOnline) {
                    result = await this._executeRemote();
                } else {
                    result = await this._executeLocal();
                }
                resolve(result);
                return;
            }

            // WRITE Operation (Insert/Update/Delete)
            // 1. Queue for Sync (Remote)
            await syncEngine.queueMutation(
                this.table,
                this.query.type.toUpperCase(),
                this.query.payload || { id: this._extractIdFromFilters() }
            );

            // 2. Optimistic Update (Local)
            const localResult = await this._executeLocalWrite();

            resolve(localResult);

        } catch (error) {
            reject(error);
        }
    }

    _extractIdFromFilters() {
        const idFilter = this.query.filters.find(f => f.column === 'id');
        return idFilter ? idFilter.value : null;
    }

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

    async _executeLocal() {
        // READ Logic
        // Sanitize columns for Local SQLite (strip PostgREST joins like '*, owner:...')
        let localColumns = this.query.columns;
        if (localColumns !== '*' && (localColumns.includes('(') || localColumns.includes('!') || localColumns.includes(':'))) {
            // console.warn('[UDM] Complex select detected, falling back to * for Local SQLite:', localColumns);
            localColumns = '*';
        }

        let sql = `SELECT ${localColumns}`;

        // Count Handling
        let count = null;
        if (this.query.options?.count) {
            // We need a separate count query
            const { sql: whereSql, params } = this._buildWhereClause();
            const countSql = `SELECT COUNT(*) as total FROM "${this.table}" ${whereSql}`;
            const countRes = await runQuery(countSql, params);
            count = countRes[0]?.total || 0;
        }

        sql += ` FROM "${this.table}"`;
        const { sql: whereSql, params } = this._buildWhereClause();

        sql += whereSql;

        if (this.query.orders.length > 0) {
            const orders = this.query.orders.map(o => `"${o.column}" ${o.ascending ? 'ASC' : 'DESC'}`);
            sql += ' ORDER BY ' + orders.join(', ');
        }

        if (this.query.range) {
            const limit = this.query.range.to - this.query.range.from + 1;
            const offset = this.query.range.from;
            sql += ` LIMIT ${limit} OFFSET ${offset}`;
        } else if (this.query.limit) {
            sql += ` LIMIT ${this.query.limit}`;
        }

        console.log(`[UDM] Local Read: ${sql}`, params);

        try {
            const rows = await runQuery(sql, params);
            let data = rows;
            if (this.query.single) {
                data = rows.length > 0 ? rows[0] : null;
            }
            return { data, error: null, count };
        } catch (err) {
            console.error('[UDM] Local Read Error:', err);
            return { data: null, error: err };
        }
    }

    _buildWhereClause() {
        const params = [];
        const whereClauses = [];

        this.query.filters.forEach(f => {
            if (f.operator === 'IN') {
                const placeholders = f.value.map(() => '?').join(',');
                whereClauses.push(`"${f.column}" IN (${placeholders})`);
                params.push(...f.value);
            } else if (f.operator === 'IS') {
                if (f.value === null) whereClauses.push(`"${f.column}" IS NULL`);
                else { whereClauses.push(`"${f.column}" = ?`); params.push(f.value); }
            } else if (f.operator === 'IS NOT') {
                if (f.value === null) whereClauses.push(`"${f.column}" IS NOT NULL`);
                else { whereClauses.push(`"${f.column}" != ?`); params.push(f.value); }
            } else if (f.operator === 'ILIKE') {
                whereClauses.push(`"${f.column}" LIKE ?`); // SQLite defaults to case-insensitive LIKE for ASCII
                params.push(f.value);
            } else {
                whereClauses.push(`"${f.column}" ${f.operator} ?`);
                params.push(f.value);
            }
        });

        return {
            sql: whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : '',
            params
        };
    }

    async _executeLocalWrite() {
        // Optimistic Write to Local SQLite
        // 1. INSERT
        if (this.query.type === 'insert') {
            const payload = this.query.payload;
            const columns = Object.keys(payload);
            const placeholders = columns.map(() => '?').join(',');
            const sql = `INSERT INTO "${this.table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`;
            const params = Object.values(payload);

            try {
                await runQuery(sql, params);
                return { data: payload, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        }

        // 2. UPDATE
        if (this.query.type === 'update') {
            const payload = this.query.payload;
            const columns = Object.keys(payload);
            const sets = columns.map(c => `"${c}" = ?`).join(',');
            let sql = `UPDATE "${this.table}" SET ${sets}`;
            const params = Object.values(payload);

            // Add Where
            // For update, typically we filter by ID
            const { sql: whereSql, params: whereParams } = this._buildWhereClause();

            sql += whereSql;
            params.push(...whereParams);

            try {
                await runQuery(sql, params);
                return { data: payload, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        }

        // 3. DELETE
        if (this.query.type === 'delete') {
            let sql = `DELETE FROM "${this.table}"`;
            const { sql: whereSql, params } = this._buildWhereClause();
            sql += whereSql;

            try {
                await runQuery(sql, params);
                return { data: null, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        }
    }
}

export const udm = UnifiedDataManager;
