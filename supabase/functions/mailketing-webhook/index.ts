// Supabase Edge Function: mailketing-webhook
// Handles incoming webhook events from Mailketing
// Deploy with: supabase functions deploy mailketing-webhook

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface WebhookPayload {
    type: 'newsubscriber' | 'unsubscribe' | 'emailopen' | 'emailclick' | 'bounce';
    email: string;
    date?: string;
    mobile?: string;
    first_name?: string;
    last_name?: string;
    link_clicked?: string;
    reason?: string;
}

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SECRET_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const payload: WebhookPayload = await req.json();
        console.log('[Mailketing Webhook] Received:', payload);

        // Map webhook type to event type
        const eventTypeMap: Record<string, string> = {
            'newsubscriber': 'subscribed',
            'unsubscribe': 'unsubscribed',
            'emailopen': 'opened',
            'emailclick': 'clicked',
            'bounce': 'bounced',
        };

        const eventType = eventTypeMap[payload.type] || payload.type;

        // Log the event
        const { error } = await supabase.from('email_logs').insert({
            event_type: eventType,
            recipient: payload.email,
            metadata: {
                type: payload.type,
                date: payload.date,
                mobile: payload.mobile,
                first_name: payload.first_name,
                last_name: payload.last_name,
                link_clicked: payload.link_clicked,
                reason: payload.reason,
            },
        });

        if (error) {
            console.error('[Mailketing Webhook] DB Error:', error);
        }

        // Handle specific events
        if (payload.type === 'bounce' || payload.type === 'unsubscribe') {
            // Update user's email status if needed
            await supabase
                .from('users')
                .update({
                    email_verified: false,
                    metadata: {
                        email_status: payload.type === 'bounce' ? 'bounced' : 'unsubscribed',
                        email_status_reason: payload.reason,
                        email_status_date: payload.date || new Date().toISOString(),
                    }
                })
                .eq('email', payload.email);
        }

        return new Response(
            JSON.stringify({ status: 'success', event: eventType }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[Mailketing Webhook] Error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
