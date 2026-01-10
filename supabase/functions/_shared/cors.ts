// CORS headers for Edge Functions
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name, x-tenant-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
