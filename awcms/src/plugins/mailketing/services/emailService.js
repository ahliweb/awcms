/**
 * Mailketing Email Service
 * All email operations go through this service
 */

import { supabase } from '@/lib/customSupabaseClient';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mailketing`;

/**
 * Get tenant-specific email configuration
 */
export const getTenantEmailConfig = async (tenantId) => {
    const { data } = await supabase
        .from('settings')
        .select('key, value')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .like('key', 'email.%');

    const config = {};
    data?.forEach((setting) => {
        const key = setting.key.replace('email.', '');
        try {
            config[key] = JSON.parse(setting.value);
        } catch {
            config[key] = setting.value;
        }
    });

    return config;
};

/**
 * Save tenant email configuration
 */
export const saveTenantEmailConfig = async (tenantId, config) => {
    const updates = Object.entries(config).map(([key, value]) => ({
        tenant_id: tenantId,
        key: `email.${key}`,
        value: JSON.stringify(value),
        deleted_at: null,
    }));

    for (const update of updates) {
        await supabase.from('settings').upsert(update, {
            onConflict: 'tenant_id,key',
        });
    }

    // Log config change to audit trail
    await supabase.from('audit_logs').insert({
        tenant_id: tenantId,
        action: 'config_change',
        table_name: 'settings',
        metadata: { plugin: 'mailketing', changes: Object.keys(config) },
    });

    return { success: true };
};

/**
 * Send email via Mailketing API
 */
export const sendEmail = async ({
    to,
    subject,
    content,
    fromName,
    fromEmail,
    attachments = [],
    tenantId,
}) => {
    const { data: { session } } = await supabase.auth.getSession();

    const payload = {
        action: 'send',
        recipient: to,
        subject,
        content,
        from_name: fromName,
        from_email: fromEmail,
        tenant_id: tenantId,
    };

    attachments.forEach((url, index) => {
        if (index < 3) {
            payload[`attach${index + 1}`] = url;
        }
    });

    const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify(payload),
    });

    const result = await response.json();

    // Log to email_logs
    await supabase.from('email_logs').insert({
        tenant_id: tenantId,
        event_type: result.status === 'success' ? 'sent' : 'failed',
        recipient: to,
        subject,
        metadata: { response: result },
    });

    return result;
};

/**
 * Add subscriber to mailing list
 */
export const addSubscriber = async ({
    email,
    firstName,
    lastName,
    listId,
    tenantId,
    ...extra
}) => {
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
            action: 'subscribe',
            email,
            first_name: firstName,
            last_name: lastName,
            list_id: listId,
            tenant_id: tenantId,
            ...extra,
        }),
    });

    return response.json();
};

/**
 * Check email credits balance
 */
export const checkCredits = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ action: 'credits' }),
    });

    return response.json();
};

/**
 * Get all mailing lists
 */
export const getLists = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ action: 'lists' }),
    });

    return response.json();
};

/**
 * Get email logs for a tenant
 */
export const getEmailLogs = async (tenantId, { limit = 50, offset = 0, eventType, recipient } = {}) => {
    let query = supabase
        .from('email_logs')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (eventType) {
        query = query.eq('event_type', eventType);
    }
    if (recipient) {
        query = query.ilike('recipient', `%${recipient}%`);
    }

    return query;
};

/**
 * Send test email to verify configuration
 */
export const sendTestEmail = async (tenantId, toEmail) => {
    return sendEmail({
        to: toEmail,
        subject: 'AWCMS Email Test',
        content: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>Email Configuration Test</h2>
                <p>This is a test email from your AWCMS installation.</p>
                <p>If you received this email, your Mailketing integration is working correctly.</p>
                <hr>
                <small>Sent at: ${new Date().toISOString()}</small>
            </div>
        `,
        tenantId,
    });
};

const emailService = {
    getTenantEmailConfig,
    saveTenantEmailConfig,
    sendEmail,
    addSubscriber,
    checkCredits,
    getLists,
    getEmailLogs,
    sendTestEmail,
};

export default emailService;
