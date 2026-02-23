# Programmatic Content Type Schemas

AWCMS leverages Supabase for its foundational database structure, but defining a new content type requires bridging the PostgreSQL schema with the React application layer. This guide details the programmatic workflow for defining, registering, and consuming a new custom content type (e.g., `events`).

## 1. Database Migration (SQL Structure)

Every new content type begins with a table structure migrated via the Supabase CLI. AWCMS schemas strictly require audit fields (`created_at`, `created_by`, `updated_at`, `updated_by`) and tenant isolation (`tenant_id`).

```sql
-- supabase/migrations/20260223000000_create_events_schema.sql

CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    location TEXT,
    is_published BOOLEAN DEFAULT false,
    
    -- Standard AWCMS Audit Fields
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES auth.users(id)
);

-- Indexing for performance and tenant isolation
CREATE INDEX idx_events_tenant ON public.events(tenant_id);
CREATE INDEX idx_events_date ON public.events(start_date DESC);

-- Enable Row Level Security
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
```

## 2. Resource Registration (`resources_registry`)

For the AWCMS ABAC (Attribute-Based Access Control) system and Admin UI to recognize the new content type as a manageable entity, it must be registered programmatically in the `resources_registry`.

```typescript
// src/api/schemaRegistry.ts
import { supabase } from '@/lib/supabaseClient';

export async function registerContentType() {
  const { data, error } = await supabase
    .from('resources_registry')
    .insert([
      {
        resource_key: 'events',
        display_name: 'Events',
        description: 'Manage tenant events and schedules',
        base_table: 'events',
        icon: 'Calendar',
        is_dynamic: true,
        schema_version: '1.0.0'
      }
    ]);

  if (error) throw new Error(`Schema registration failed: ${error.message}`);
  return data;
}
```

## 3. UI and Component Wiring (`component_registry`)

AWCMS uses dynamic block editors (Puck/TipTap). To make the new content type available to the visual builder (e.g., an "Event List" block), its schema definition maps into the `component_registry`.

```typescript
// src/api/componentRegistry.ts
import { supabase } from '@/lib/supabaseClient';

export interface ComponentConfig {
  name: string;
  props: Record<string, any>;
  defaultData: Record<string, any>;
}

export async function registerEventBlocks(tenantId: string) {
  const eventListConfig: ComponentConfig = {
    name: 'EventListFeature',
    props: {
      limit: { type: 'number', default: 3 },
      showLocation: { type: 'boolean', default: true }
    },
    defaultData: {
      querySort: 'start_date:asc'
    }
  };

  const { error } = await supabase
    .from('component_registry')
    .upsert({
      tenant_id: tenantId,
      component_type: 'puck_block',
      identifier: 'events_list',
      configuration: eventListConfig,
      is_active: true
    });

  if (error) throw new Error('UI Component registration failed');
}
```

## 4. Application Layer interfaces (TypeScript)

On the React frontend, schemas are strictly typed. This interface bridges the API boundary and enables IntelliSense for frontend developers building forms or displaying the content.

```typescript
// src/types/schemas/events.ts
import { BaseEntity } from './core';

export interface EventEntity extends BaseEntity {
  title: string;
  start_date: string; // ISO 8601
  end_date?: string;  // ISO 8601
  location?: string;
  is_published: boolean;
}

// Hook for Data Fetching
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export function useEvents(tenantId: string) {
  return useQuery({
    queryKey: ['events', tenantId],
    queryFn: async (): Promise<EventEntity[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('start_date', { ascending: true });
        
      if (error) throw error;
      return data as EventEntity[];
    }
  });
}
```

## Summary Workflow

1. **SQL Migration**: Define strict table structure and RLS.
2. **`resources_registry`**: Expose the table to the API and ABAC permissions engine.
3. **`component_registry`**: Map the content to visual parameters for the visual editor.
4. **TypeScript layer**: Bind it all together in the React application using standard `@supabase/supabase-js` patterns and strongly typed interfaces.
