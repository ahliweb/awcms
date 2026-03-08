/**
 * Mailketing Email Service
 * Frontend library for interacting with Mailketing via Edge Function
 */

import { supabase } from '@/lib/customSupabaseClient';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_EDGE_URL}/api/mailketing`;

/**
 * Send a transactional email via Mailketing
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.content - Email body (HTML or text)
 * @param {string} [options.fromName] - Sender name
 * @param {string} [options.fromEmail] - Sender email
 * @param {string[]} [options.attachments] - Array of attachment URLs (max 3)
 */
export const sendEmail = async ({ to, subject, content, fromName, fromEmail, attachments = [] }) => {
    const { data: { session } } = await supabase.auth.getSession();

    const payload = {
        action: 'send',
        recipient: to,
        subject,
        content,
        from_name: fromName,
        from_email: fromEmail,
    };

    // Add attachments if provided
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

    return response.json();
};

/**
 * Add a subscriber to a mailing list
 * @param {Object} options - Subscriber options
 * @param {string} options.email - Subscriber email
 * @param {string} [options.firstName] - First name
 * @param {string} [options.lastName] - Last name
 * @param {number} [options.listId] - List ID (uses default if not provided)
 * @param {string} [options.phone] - Phone number
 * @param {string} [options.mobile] - Mobile number
 * @param {string} [options.city] - City
 * @param {string} [options.state] - State/Province
 * @param {string} [options.country] - Country
 * @param {string} [options.company] - Company name
 */
export const addSubscriber = async ({
    email,
    firstName,
    lastName,
    listId,
    phone,
    mobile,
    city,
    state,
    country,
    company,
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
            phone,
            mobile,
            city,
            state,
            country,
            company,
        }),
    });

    return response.json();
};

/**
 * Check remaining email credits
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
 * Send notification email (wrapper for common use case)
 */
export const sendNotification = async ({ to, subject, message }) => {
    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${subject}</h2>
            <div style="padding: 20px; background: #f9f9f9; border-radius: 8px;">
                ${message}
            </div>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">
                This is an automated message from AWCMS.
            </p>
        </div>
    `;

    return sendEmail({
        to,
        subject,
        content: htmlContent,
    });
};

const mailketingService = {
    sendEmail,
    addSubscriber,
    checkCredits,
    getLists,
    sendNotification,
};

export default mailketingService;
