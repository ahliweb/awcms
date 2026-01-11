// Supabase Edge Function: mailketing
// Handles email sending via Mailketing API
// Deploy with: supabase functions deploy mailketing

import { corsHeaders } from '../_shared/cors.ts';

const MAILKETING_API = 'https://api.mailketing.co.id/api/v1';

interface SendEmailRequest {
    action: 'send' | 'subscribe' | 'credits' | 'lists';
    from_name?: string;
    from_email?: string;
    recipient?: string;
    subject?: string;
    content?: string;
    attach1?: string;
    attach2?: string;
    attach3?: string;
    // For subscriber
    email?: string;
    first_name?: string;
    last_name?: string;
    list_id?: number;
    phone?: string;
    mobile?: string;
    city?: string;
    state?: string;
    country?: string;
    company?: string;
}

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const apiToken = Deno.env.get('MAILKETING_API_TOKEN');
        if (!apiToken) {
            return new Response(
                JSON.stringify({ error: 'MAILKETING_API_TOKEN not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body: SendEmailRequest = await req.json();
        const { action } = body;

        let endpoint: string;
        let params: Record<string, string | number>;

        switch (action) {
            case 'send':
                endpoint = '/send';
                params = {
                    api_token: apiToken,
                    from_name: body.from_name || 'AWCMS',
                    from_email: body.from_email || 'noreply@awcms.com',
                    recipient: body.recipient || '',
                    subject: body.subject || '',
                    content: body.content || '',
                };
                if (body.attach1) params.attach1 = body.attach1;
                if (body.attach2) params.attach2 = body.attach2;
                if (body.attach3) params.attach3 = body.attach3;
                break;

            case 'subscribe':
                endpoint = '/addsubtolist';
                params = {
                    api_token: apiToken,
                    list_id: body.list_id || Deno.env.get('MAILKETING_DEFAULT_LIST_ID') || 1,
                    email: body.email || '',
                };
                if (body.first_name) params.first_name = body.first_name;
                if (body.last_name) params.last_name = body.last_name;
                if (body.phone) params.phone = body.phone;
                if (body.mobile) params.mobile = body.mobile;
                if (body.city) params.city = body.city;
                if (body.state) params.state = body.state;
                if (body.country) params.country = body.country;
                if (body.company) params.company = body.company;
                break;

            case 'credits':
                endpoint = '/ceksaldo';
                params = { api_token: apiToken };
                break;

            case 'lists':
                endpoint = '/viewlist';
                params = { api_token: apiToken };
                break;

            default:
                return new Response(
                    JSON.stringify({ error: 'Invalid action. Use: send, subscribe, credits, lists' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
        }

        // Call Mailketing API
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            formData.append(key, String(value));
        }

        const response = await fetch(`${MAILKETING_API}${endpoint}`, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const result = await response.json();

        // Extract client IP from request headers (Cloudflare/Supabase sets these)
        const clientIp = req.headers.get('cf-connecting-ip')
            || req.headers.get('x-real-ip')
            || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || 'unknown';

        console.log(`[Mailketing] ${action}:`, result, 'IP:', clientIp);

        return new Response(
            JSON.stringify({ ...result, client_ip: clientIp }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[Mailketing] Error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
