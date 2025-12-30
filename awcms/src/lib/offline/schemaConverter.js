/**
 * Schema Converter & Definitions
 * Maps Supabase PostgreSQL types to SQLite compatible types.
 * Defines the core schema for Offline tables.
 */

const PG_TO_SQLITE = {
    'uuid': 'TEXT',
    'text': 'TEXT',
    'varchar': 'TEXT',
    'character varying': 'TEXT',
    'integer': 'INTEGER',
    'bigint': 'INTEGER',
    'boolean': 'INTEGER', // 0 or 1
    'timestamp with time zone': 'TEXT', // ISO8601
    'timestamptz': 'TEXT',
    'jsonb': 'TEXT', // JSON string
    'json': 'TEXT'
};

/**
 * Generates SQL to create a local table.
 */
export function generateCreateTable(tableName, columns) {
    const definitions = columns.map(col => {
        const sqliteType = PG_TO_SQLITE[col.type.toLowerCase()] || 'TEXT';
        let def = `"${col.name}" ${sqliteType}`;

        if (col.isPrimaryKey) {
            def += ' PRIMARY KEY';
        }

        return def;
    });

    return `CREATE TABLE IF NOT EXISTS "${tableName}" (${definitions.join(', ')});`;
}

// Minimal Schema Definitions for P0/P1
// We only define columns we strictly need for the offline UI + Sync
const BASE_COLUMNS = [
    { name: 'id', type: 'uuid', isPrimaryKey: true },
    { name: 'created_at', type: 'timestamptz' },
    { name: 'updated_at', type: 'timestamptz' },
    { name: 'deleted_at', type: 'timestamptz' },
    { name: 'tenant_id', type: 'uuid' }
];

export const TABLE_SCHEMAS = {
    'tenants': [
        { name: 'id', type: 'uuid', isPrimaryKey: true },
        { name: 'name', type: 'text' },
        { name: 'slug', type: 'text' },
        { name: 'domain', type: 'text' },
        { name: 'subscription_tier', type: 'text' }
    ],
    'users': [
        ...BASE_COLUMNS,
        { name: 'email', type: 'text' },
        { name: 'full_name', type: 'text' },
        { name: 'avatar_url', type: 'text' },
        { name: 'role_id', type: 'uuid' },
        { name: 'status', type: 'text' }
    ],
    'articles': [
        ...BASE_COLUMNS,
        { name: 'title', type: 'text' },
        { name: 'slug', type: 'text' },
        { name: 'content', type: 'text' },
        { name: 'excerpt', type: 'text' },
        { name: 'featured_image', type: 'text' },
        { name: 'status', type: 'text' }, // published, draft
        { name: 'author_id', type: 'uuid' }
    ],
    'pages': [
        ...BASE_COLUMNS,
        { name: 'title', type: 'text' },
        { name: 'slug', type: 'text' },
        { name: 'content', type: 'jsonb' }, // Puck JSON
        { name: 'status', type: 'text' },
        { name: 'is_active', type: 'boolean' }
    ],
    'roles': [
        { name: 'id', type: 'uuid', isPrimaryKey: true },
        { name: 'name', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'tenant_id', type: 'uuid' }
    ],
    'permissions': [
        { name: 'id', type: 'uuid', isPrimaryKey: true },
        { name: 'name', type: 'text' },
        { name: 'module', type: 'text' },
        { name: 'action', type: 'text' }
    ],
    'role_permissions': [
        { name: 'role_id', type: 'uuid' }, // Composite PK not fully supported in simple generator
        { name: 'permission_id', type: 'uuid' }
    ],
    'policies': [
        { name: 'id', type: 'uuid', isPrimaryKey: true },
        { name: 'name', type: 'text' },
        { name: 'definition', type: 'jsonb' }, // ABAC Rules
        { name: 'tenant_id', type: 'uuid' }
    ],
    'role_policies': [
        { name: 'role_id', type: 'uuid' },
        { name: 'policy_id', type: 'uuid' }
    ]
};

export const SYNC_TABLES = Object.keys(TABLE_SCHEMAS);
