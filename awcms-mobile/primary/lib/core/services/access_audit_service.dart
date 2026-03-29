library;

import 'dart:async';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class AccessAuditService {
  AccessAuditService._();

  static final AccessAuditService instance = AccessAuditService._();
  final SupabaseClient _supabase = Supabase.instance.client;
  final DeviceInfoPlugin _deviceInfo = DeviceInfoPlugin();

  Future<void> logAccessEvent({
    String? tenantId,
    String? userId,
    String action = 'access',
    String resource = 'access',
    Map<String, dynamic>? details,
    String? actorType,
    String? actorRole,
    Map<String, dynamic>? authContext,
    String? moduleName,
    String? featureName,
    String? actionName,
    String? resourceType,
    String? resourceId,
    String? permissionKey,
    DateTime? clientTimestamp,
    int? requestDurationMs,
    String? routePath,
    String? screenName,
    String? purpose,
    String? triggerSource,
    String? businessIntent,
    String? accessMechanism,
    String? authMethod,
  }) async {
    try {
      final session = _supabase.auth.currentSession;
      final resolvedUserId = userId ?? session?.user.id;
      final resolvedTenantId =
          tenantId ?? session?.user.userMetadata?['tenant_id'] as String?;

      final deviceMetadata = await _buildDeviceMetadata();

      final payload = {
        'p_tenant_id': resolvedTenantId,
        'p_user_id': resolvedUserId,
        'p_action': action,
        'p_resource': resource,
        'p_details': details ?? <String, dynamic>{},
        'p_channel': 'mobile',
        'p_actor_type':
            actorType ?? (resolvedUserId != null ? 'user' : 'guest'),
        'p_actor_role': actorRole,
        'p_auth_context':
            authContext ?? <String, dynamic>{'has_session': session != null},
        'p_module_name': moduleName,
        'p_feature_name': featureName,
        'p_action_name': actionName ?? action,
        'p_resource_type': resourceType ?? resource,
        'p_resource_id': resourceId,
        'p_permission_key': permissionKey,
        'p_client_timestamp':
            clientTimestamp?.toIso8601String() ??
            DateTime.now().toIso8601String(),
        'p_request_duration_ms': requestDurationMs,
        'p_workspace_source': 'awcms-mobile/primary',
        'p_route_path': routePath,
        'p_screen_name': screenName,
        'p_device_metadata': deviceMetadata,
        'p_purpose': purpose,
        'p_trigger_source': triggerSource,
        'p_business_intent': businessIntent,
        'p_access_channel': 'mobile',
        'p_access_mechanism': accessMechanism ?? 'go_router',
        'p_auth_method':
            authMethod ?? (session != null ? 'supabase_session' : 'anonymous'),
      };

      final response = await _supabase.rpc('log_access_event', params: payload);
      if (response.error != null) {
        throw response.error!;
      }
    } catch (_) {
      // Access logging must not break the mobile app flow.
    }
  }

  Future<Map<String, dynamic>> _buildDeviceMetadata() async {
    try {
      final androidInfo = await _deviceInfo.androidInfo;
      return {
        'platform': 'android',
        'model': androidInfo.model,
        'manufacturer': androidInfo.manufacturer,
        'sdk_int': androidInfo.version.sdkInt,
      };
    } catch (_) {
      return {'platform': 'mobile'};
    }
  }
}
