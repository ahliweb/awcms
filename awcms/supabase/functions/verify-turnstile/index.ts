// Supabase Edge Function: verify-turnstile
// Verifies Cloudflare Turnstile CAPTCHA tokens
// Deploy with: supabase functions deploy verify-turnstile
// Set secret: supabase secrets set TURNSTILE_SECRET_KEY=your-secret-key

/// <reference path="../_shared/types.d.ts" />

import { corsHeaders } from '../_shared/cors.ts'
import { resolveSecretKey } from '../_shared/turnstile.ts'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface TurnstileVerifyResponse {
    success: boolean
    'error-codes'?: string[]
    challenge_ts?: string
    hostname?: string
    action?: string
    cdata?: string
}

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    console.log('=== verify-turnstile function called (CORS Updated) ===')

    try {
        // Get secret key from environment
        const secretKeyResolution = resolveSecretKey(req)
        const secretKey = secretKeyResolution.key

        if (!secretKey) {
            console.error('TURNSTILE_SECRET_KEY not configured')
            throw new Error('Turnstile verification is not configured')
        }

        console.log('Turnstile secret key source:', secretKeyResolution.source, 'Host:', secretKeyResolution.host)

        // Parse request body
        let body
        try {
            body = await req.json()
        } catch (parseError) {
            console.error('JSON parse error:', parseError)
            throw new Error('Invalid JSON in request body')
        }

        const { token } = body

        if (!token) {
            throw new Error('Turnstile token is required')
        }

        console.log('Verifying Turnstile token...')

        // Get client IP (optional, for additional verification)
        const clientIP = req.headers.get('cf-connecting-ip') ||
            req.headers.get('x-forwarded-for')?.split(',')[0] ||
            undefined

        // Verify token with Cloudflare
        const formData = new FormData()
        formData.append('secret', secretKey)
        formData.append('response', token)
        if (clientIP) {
            formData.append('remoteip', clientIP)
        }

        const verifyResponse = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            body: formData,
        })

        if (!verifyResponse.ok) {
            console.error('Cloudflare API error:', verifyResponse.status)
            throw new Error('Failed to verify with Cloudflare')
        }

        const result: TurnstileVerifyResponse = await verifyResponse.json()

        console.log('Turnstile verification result:', {
            success: result.success,
            hostname: result.hostname,
            errorCodes: result['error-codes'],
        })

        if (!result.success) {
            const errorCodes = result['error-codes'] || []
            console.error('Turnstile verification failed:', errorCodes)

            // Map error codes to user-friendly messages
            let errorMessage = 'Security verification failed'
            if (errorCodes.includes('invalid-input-response')) {
                errorMessage = 'Invalid security token. Please try again.'
            } else if (errorCodes.includes('timeout-or-duplicate')) {
                errorMessage = 'Security token expired. Please refresh and try again.'
            }

            return new Response(JSON.stringify({
                success: false,
                error: errorMessage,
                errorCodes,
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            })
        }

        console.log('=== Turnstile verification SUCCESS ===')

        return new Response(JSON.stringify({
            success: true,
            message: 'Verification successful',
            hostname: result.hostname,
            challengeTimestamp: result.challenge_ts,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error: unknown) {
        console.error('=== ERROR in verify-turnstile ===')
        const err = error as Error
        console.error('Error:', err?.message)

        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'

        return new Response(JSON.stringify({
            success: false,
            error: errorMessage,
            timestamp: new Date().toISOString(),
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        })
    }
})
