import { supabase } from '@/lib/customSupabaseClient';

const sanitizeText = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const sanitizeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export async function logAccessAudit(event) {
  const payload = {
    p_tenant_id: event.tenantId ?? null,
    p_user_id: event.userId ?? null,
    p_action: sanitizeText(event.action) || 'access',
    p_resource: sanitizeText(event.resource) || 'access',
    p_details: sanitizeObject(event.details),
    p_ip_address: sanitizeText(event.ipAddress),
    p_channel: sanitizeText(event.channel),
    p_actor_type: sanitizeText(event.actorType),
    p_actor_role: sanitizeText(event.actorRole),
    p_auth_context: sanitizeObject(event.authContext),
    p_module_name: sanitizeText(event.moduleName),
    p_feature_name: sanitizeText(event.featureName),
    p_action_name: sanitizeText(event.actionName),
    p_resource_type: sanitizeText(event.resourceType),
    p_resource_id: sanitizeText(event.resourceId),
    p_permission_key: sanitizeText(event.permissionKey),
    p_server_timestamp: event.serverTimestamp ?? new Date().toISOString(),
    p_client_timestamp: event.clientTimestamp ?? null,
    p_request_duration_ms: Number.isFinite(event.requestDurationMs) ? event.requestDurationMs : null,
    p_workspace_source: sanitizeText(event.workspaceSource),
    p_route_path: sanitizeText(event.routePath),
    p_url: sanitizeText(event.url),
    p_screen_name: sanitizeText(event.screenName),
    p_user_agent: sanitizeText(event.userAgent),
    p_device_metadata: sanitizeObject(event.deviceMetadata),
    p_purpose: sanitizeText(event.purpose),
    p_workflow_state: sanitizeText(event.workflowState),
    p_trigger_source: sanitizeText(event.triggerSource),
    p_business_intent: sanitizeText(event.businessIntent),
    p_access_channel: sanitizeText(event.accessChannel),
    p_access_mechanism: sanitizeText(event.accessMechanism),
    p_integration_source: sanitizeText(event.integrationSource),
    p_auth_method: sanitizeText(event.authMethod),
  };

  const { error } = await supabase.rpc('log_access_event', payload);
  if (error) {
    throw error;
  }
}
