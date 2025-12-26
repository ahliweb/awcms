/// AWCMS Mobile - Tenant Utilities
///
/// Helper functions untuk multi-tenant support.
/// Mengikuti pola yang sama dengan web admin AWCMS.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';

/// Tenant data model
class Tenant {
  final String id;
  final String name;
  final String? domain;
  final String? subdomain;
  final Map<String, dynamic>? config;
  final String? subscriptionTier;

  const Tenant({
    required this.id,
    required this.name,
    this.domain,
    this.subdomain,
    this.config,
    this.subscriptionTier,
  });

  factory Tenant.fromJson(Map<String, dynamic> json) {
    return Tenant(
      id: json['id'] as String,
      name: json['name'] as String,
      domain: json['domain'] as String?,
      subdomain: json['subdomain'] as String?,
      config: json['config'] as Map<String, dynamic>?,
      subscriptionTier: json['subscription_tier'] as String?,
    );
  }

  /// Get branding colors from config
  String? get primaryColor => config?['primary_color'] as String?;
  String? get logoUrl => config?['logo_url'] as String?;
}

/// Tenant state notifier
class TenantNotifier extends Notifier<Tenant?> {
  @override
  Tenant? build() {
    // Check for default tenant from config
    _loadDefaultTenant();
    return null;
  }

  Future<void> _loadDefaultTenant() async {
    final defaultTenantId = AppConfig.defaultTenantId;
    if (defaultTenantId != null) {
      await loadTenant(defaultTenantId);
    }
  }

  /// Load tenant by ID
  Future<void> loadTenant(String tenantId) async {
    try {
      final response = await Supabase.instance.client
          .from('tenants')
          .select('id, name, domain, subdomain, config, subscription_tier')
          .eq('id', tenantId)
          .maybeSingle();

      if (response != null) {
        state = Tenant.fromJson(response);
      }
    } catch (e) {
      // Handle error silently - tenant not found
      state = null;
    }
  }

  /// Load tenant by domain
  Future<void> loadTenantByDomain(String domain) async {
    try {
      final response = await Supabase.instance.client
          .from('tenants')
          .select('id, name, domain, subdomain, config, subscription_tier')
          .eq('domain', domain)
          .maybeSingle();

      if (response != null) {
        state = Tenant.fromJson(response);
      }
    } catch (e) {
      state = null;
    }
  }

  /// Load tenant by subdomain
  Future<void> loadTenantBySubdomain(String subdomain) async {
    try {
      final response = await Supabase.instance.client
          .from('tenants')
          .select('id, name, domain, subdomain, config, subscription_tier')
          .eq('subdomain', subdomain)
          .maybeSingle();

      if (response != null) {
        state = Tenant.fromJson(response);
      }
    } catch (e) {
      state = null;
    }
  }

  /// Clear current tenant
  void clearTenant() {
    state = null;
  }
}

/// Tenant provider
final tenantProvider = NotifierProvider<TenantNotifier, Tenant?>(
  () => TenantNotifier(),
);

/// Helper provider for tenant ID
final tenantIdProvider = Provider<String?>((ref) {
  return ref.watch(tenantProvider)?.id;
});

/// Helper provider for tenant config
final tenantConfigProvider = Provider<Map<String, dynamic>?>((ref) {
  return ref.watch(tenantProvider)?.config;
});
