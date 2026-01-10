// Type declarations for Deno runtime (for IDE support)
// These types are automatically available in Supabase Edge Functions runtime

declare namespace Deno {
    export interface Env {
        get(key: string): string | undefined;
        set(key: string, value: string): void;
        delete(key: string): void;
        toObject(): { [key: string]: string };
    }

    export const env: Env;

    export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

// Supabase client module declaration for HTTP imports
declare module 'https://esm.sh/@supabase/supabase-js@2' {
    export interface SupabaseClient {
        auth: {
            getUser(token: string): Promise<{ data: { user: any }; error: any }>;
            admin: {
                createUser(options: any): Promise<{ data: { user: any }; error: any }>;
                inviteUserByEmail(email: string, options?: any): Promise<{ data: { user: any }; error: any }>;
            };
        };
        from(table: string): {
            select(columns?: string, options?: { count?: string; head?: boolean }): any;
            insert(data: any): any;
            update(data: any): any;
            delete(): any;
            eq(column: string, value: any): any;
            is(column: string, value: any): any;
            single(): any;
            range(from: number, to: number): any;
            order(column: string, options?: { ascending?: boolean }): any;
        };
        functions: {
            invoke(name: string, options?: any): Promise<{ data: any; error: any }>;
        };
    }

    export function createClient(url: string, key: string, options?: any): SupabaseClient;
}
