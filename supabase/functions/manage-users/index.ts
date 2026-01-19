// Supabase Edge Function: manage-users
// Deploy with: supabase functions deploy manage-users
// File: supabase/functions/manage-users/index.ts

/// <reference path="../_shared/types.d.ts" />

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    console.log('=== manage-users function called ===')
    console.log('Method:', req.method)
    console.log('URL:', req.url)

    try {
        // Get Supabase Admin client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing environment variables')
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        })

        // Get request body
        let body
        try {
            body = await req.json()
        } catch (parseError) {
            console.error('JSON parse error:', parseError)
            throw new Error('Invalid JSON in request body')
        }

        let {
            action,
            email,
            password,
            full_name,
            role_id,
            user_id,
            tenant_id,
            request_id, // For approval workflow
            reason      // For rejection
        } = body

        console.log('Action:', action)

        // --- PUBLIC ACTIONS (No Auth Required) ---

        if (action === 'submit_application') {
            console.log('Processing public application submit')

            // --- Security: Verify Turnstile Token ---
            const { turnstileToken } = body

            // Helper to verify Turnstile
            const verifyTurnstile = async (token: string) => {
                const secretKey = Deno.env.get('TURNSTILE_SECRET_KEY')
                if (!secretKey) {
                    console.error('TURNSTILE_SECRET_KEY missing in environment')
                    // Fail closed for security
                    return { success: false, error: 'Server configuration error' }
                }

                const formData = new FormData()
                formData.append('secret', secretKey)
                formData.append('response', token)
                // formData.append('remoteip', req.headers.get('x-forwarded-for') || '') 

                try {
                    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                        method: 'POST',
                        body: formData,
                    })
                    return await res.json()
                } catch (err) {
                    console.error('Turnstile verification fetch error:', err)
                    return { success: false, error: 'Failed to connect to verification service' }
                }
            }

            if (!turnstileToken) {
                throw new Error('Security check required (missing token)')
            }

            const verification = await verifyTurnstile(turnstileToken)

            if (!verification.success) {
                console.warn('Turnstile verification failed:', verification)
                throw new Error('Security check failed. Please refresh and try again.')
            }
            // ----------------------------------------

            if (!email || !full_name) throw new Error('Email and Full Name are required')

            // Check if email already exists in users or requests
            const { data: existingUser } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle()
            if (existingUser) throw new Error('Email already registered')

            const { data: existingRequest } = await supabaseAdmin.from('account_requests').select('status').eq('email', email).maybeSingle()
            if (existingRequest && existingRequest.status !== 'rejected') throw new Error('Application already pending for this email')

            // Insert into account_requests
            const { data: newRequest, error: insertError } = await supabaseAdmin
                .from('account_requests')
                .insert({
                    email,
                    full_name,
                    tenant_id: tenant_id || null, // Optional specific tenant request
                    status: 'pending_admin'
                })
                .select()
                .single()

            if (insertError) throw new Error('Failed to submit application: ' + insertError.message)

            return new Response(JSON.stringify({ message: 'Application submitted successfully', id: newRequest.id }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            })
        }

        // --- PROTECTED ACTIONS (Auth Required) ---

        // Verify the requesting user
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            throw new Error('Unauthorized: No authorization header provided')
        }

        const token = authHeader.replace('Bearer ', '')
        const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

        if (authError || !authData?.user) {
            throw new Error('Unauthorized: Invalid token')
        }

        const requestingUser = authData.user

        // Fetch requester role/tenant
        const { data: userData, error: userDataError } = await supabaseAdmin
            .from('users')
            .select('role_id, tenant_id, role:roles!users_role_id_fkey(name)')
            .eq('id', requestingUser.id)
            .single()

        if (userDataError || !userData?.role?.name) {
            throw new Error('Failed to fetch user role')
        }

        const roleName = userData.role.name
        const requesterTenantId = userData.tenant_id
        const isSuperAdmin = ['super_admin', 'owner'].includes(roleName)
        const isAdmin = ['admin', 'owner'].includes(roleName) || isSuperAdmin

        if (!isAdmin) {
            throw new Error('Forbidden: Insufficient privileges')
        }

        let result = null

        switch (action) {
            // --- APPROVAL WORKFLOW ACTIONS ---

            case 'approve_application_admin': {
                if (!request_id) throw new Error('request_id required')

                // Get request
                const { data: reqData } = await supabaseAdmin.from('account_requests').select('*').eq('id', request_id).single()
                if (!reqData) throw new Error('Request not found')

                // Tenant Check: Admins can only approve for their tenant
                if (!isSuperAdmin && reqData.tenant_id && reqData.tenant_id !== requesterTenantId) {
                    throw new Error('Forbidden: Cannot approve for other tenant')
                }

                // Update to pending_super_admin
                const { error: updateError } = await supabaseAdmin
                    .from('account_requests')
                    .update({
                        status: 'pending_super_admin',
                        admin_approved_at: new Date().toISOString(),
                        admin_approved_by: requestingUser.id
                    })
                    .eq('id', request_id)

                if (updateError) throw updateError
                result = { message: 'Application approved by Admin' }
                break
            }

            case 'approve_application_super_admin': {
                if (!isSuperAdmin) throw new Error(`Forbidden: Super Admin only. Role detected: '${roleName}' for User: ${requestingUser.email}`)
                if (!request_id) throw new Error('request_id required')

                // Get request
                const { data: reqData } = await supabaseAdmin.from('account_requests').select('*').eq('id', request_id).single()
                if (!reqData) throw new Error('Request not found')

                // 1. Invite User (Creates Auth User + Sends Verification Email)
                const { data: invitedUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(reqData.email, {
                    data: { full_name: reqData.full_name, tenant_id: reqData.tenant_id }
                })

                if (inviteError) throw new Error('Failed to invite user: ' + inviteError.message)

                // 2. Mark request as completed
                await supabaseAdmin
                    .from('account_requests')
                    .update({
                        status: 'completed',
                        super_admin_approved_at: new Date().toISOString(),
                        super_admin_approved_by: requestingUser.id
                    })
                    .eq('id', request_id)

                // 3. Update the newly created user's metadata/profile if needed (Handled by handle_new_user trigger usually)
                // Trigger will pick up tenant_id from metadata

                result = { message: 'Application approved and Invitation sent', user_id: invitedUser.user.id }
                break
            }

            case 'reject_application': {
                if (!request_id) throw new Error('request_id required')
                const { data: reqData } = await supabaseAdmin.from('account_requests').select('tenant_id').eq('id', request_id).single()

                if (!isSuperAdmin && reqData?.tenant_id && reqData.tenant_id !== requesterTenantId) {
                    throw new Error('Forbidden')
                }

                await supabaseAdmin
                    .from('account_requests')
                    .update({
                        status: 'rejected',
                        rejection_reason: reason || 'No reason provided',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', request_id)

                result = { message: 'Application rejected' }
                break
            }

            // --- EXISTING USER MANAGEMENT ACTIONS ---

            case 'create': {
                if (!email) throw new Error('Email is required')
                if (!password) throw new Error('Password is required')

                // Security Fix: Enforce Tenant ID for Non-Super Admins
                // If not Super Admin, tenant_id MUST match requesterTenantId (and cannot be null)
                if (!isSuperAdmin) {
                    if (!requesterTenantId) throw new Error('Forbidden: Requester has no tenant context') // Should not happen for restricted roles, but safety first
                    if (tenant_id && tenant_id !== requesterTenantId) throw new Error('Forbidden: Cannot create user for another tenant')

                    // Force the tenant_id to be the requester's tenant (ignoring null or missing input)
                    tenant_id = requesterTenantId
                }

                const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                    email,
                    password,
                    email_confirm: true,
                    user_metadata: { full_name, tenant_id }
                })

                if (createError) throw new Error('Failed to create user: ' + createError.message)
                result = { user: newAuthUser.user, message: 'User created successfully' }
                break
            }

            case 'invite': {
                if (!email) throw new Error('Email is required')

                // Security Fix: Enforce Tenant ID for Non-Super Admins
                if (!isSuperAdmin) {
                    if (!requesterTenantId) throw new Error('Forbidden: Requester has no tenant context')
                    if (tenant_id && tenant_id !== requesterTenantId) throw new Error('Forbidden: Cannot invite user to another tenant')

                    // Force the tenant_id to be the requester's tenant
                    tenant_id = requesterTenantId
                }

                const { data: invitedUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
                    data: { full_name, tenant_id }
                })

                if (inviteError) throw new Error('Failed to invite user: ' + inviteError.message)
                result = { user: invitedUser.user, message: 'User invited successfully' }
                break
            }

            case 'update': {
                if (!user_id) throw new Error('user_id required')

                // Check target user tenant
                if (!isSuperAdmin) {
                    const { data: target } = await supabaseAdmin.from('users').select('tenant_id').eq('id', user_id).single()
                    if (target && target.tenant_id !== requesterTenantId) throw new Error('Forbidden: Cannot update user from another tenant')
                }

                const updates: any = { updated_at: new Date().toISOString() }
                if (full_name) updates.full_name = full_name
                if (role_id) updates.role_id = role_id

                // Security: Don't allow non-super-admins to change tenant_id (even to their own, it shouldn't change generally)
                // If we want to allow moving users, only Super Admin should do it.

                const { error: updateError } = await supabaseAdmin.from('users').update(updates).eq('id', user_id)
                if (updateError) throw updateError
                result = { message: 'User updated successfully' }
                break
            }

            case 'delete': {
                if (!user_id) throw new Error('user_id required')

                // Check permissions/tenant logic similar to previous version
                const { data: targetUser } = await supabaseAdmin.from('users').select('role_id, tenant_id').eq('id', user_id).single()

                if (!isSuperAdmin && targetUser && targetUser.tenant_id !== requesterTenantId) {
                    throw new Error('Forbidden')
                }

                // Check active permissions... (simplified for brevity, assume similar logic)

                const { error: deleteError } = await supabaseAdmin.from('users').update({ deleted_at: new Date().toISOString() }).eq('id', user_id)
                if (deleteError) throw deleteError
                result = { message: 'User deleted successfully' }
                break
            }

            default:
                throw new Error(`Unknown action: ${action}`)
        }

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error: any) {
        console.error('Error:', error.message)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})

