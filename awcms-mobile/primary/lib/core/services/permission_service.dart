/// AWCMS Mobile - Permission Service
///
/// Service untuk ABAC (Attribute-Based Access Control) di mobile.
/// Port dari web admin permission context untuk Flutter.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'auth_service.dart';

/// Channel enum untuk multi-device access control
enum AppChannel { web, mobile, api }

/// Permission actions
enum PermissionAction {
  read,
  create,
  update,
  delete,
  restore,
  permanentDelete,
  publish,
}

/// Role hierarchy
enum UserRole {
  owner,
  superAdmin,
  admin,
  editor,
  author,
  member,
  subscriber,
  public_,
  noAccess,
}

extension UserRoleExtension on UserRole {
  String get value {
    switch (this) {
      case UserRole.owner:
        return 'owner';
      case UserRole.superAdmin:
        return 'super_admin';
      case UserRole.admin:
        return 'admin';
      case UserRole.editor:
        return 'editor';
      case UserRole.author:
        return 'author';
      case UserRole.member:
        return 'member';
      case UserRole.subscriber:
        return 'subscriber';
      case UserRole.public_:
        return 'public';
      case UserRole.noAccess:
        return 'no_access';
    }
  }

  static UserRole fromString(String? value) {
    switch (value) {
      case 'owner':
        return UserRole.owner;
      case 'super_admin':
        return UserRole.superAdmin;
      case 'admin':
        return UserRole.admin;
      case 'editor':
        return UserRole.editor;
      case 'author':
        return UserRole.author;
      case 'member':
        return UserRole.member;
      case 'subscriber':
        return UserRole.subscriber;
      case 'no_access':
        return UserRole.noAccess;
      default:
        return UserRole.public_;
    }
  }

  /// Check if role is admin-level or higher
  bool get isAdmin =>
      this == UserRole.owner ||
      this == UserRole.superAdmin ||
      this == UserRole.admin;

  /// Check if role can create content
  bool get canCreate =>
      this == UserRole.owner ||
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.editor ||
      this == UserRole.author;

  /// Check if role can publish
  bool get canPublish =>
      this == UserRole.owner ||
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.editor;
}

/// Permission state
class PermissionState {
  final UserRole role;
  final List<String> permissions;
  final String? tenantId;
  final bool isLoading;
  final String? error;

  const PermissionState({
    this.role = UserRole.public_,
    this.permissions = const [],
    this.tenantId,
    this.isLoading = false,
    this.error,
  });

  PermissionState copyWith({
    UserRole? role,
    List<String>? permissions,
    String? tenantId,
    bool? isLoading,
    String? error,
  }) {
    return PermissionState(
      role: role ?? this.role,
      permissions: permissions ?? this.permissions,
      tenantId: tenantId ?? this.tenantId,
      isLoading: isLoading ?? this.isLoading,
      error: error,
    );
  }
}

/// Permission Service
class PermissionService extends Notifier<PermissionState> {
  @override
  PermissionState build() {
    // Watch auth state
    ref.listen(authProvider, (previous, next) {
      if (next.isAuthenticated && next.user != null) {
        _loadPermissions(next.user!.id);
      } else {
        state = const PermissionState();
      }
    });

    // Check initial state
    final authState = ref.read(authProvider);
    if (authState.isAuthenticated && authState.user != null) {
      _loadPermissions(authState.user!.id);
    }

    return const PermissionState(isLoading: true);
  }

  Future<void> _loadPermissions(String userId) async {
    state = state.copyWith(isLoading: true, error: null);

    try {
      // Get user profile with role
      final profile = await Supabase.instance.client
          .from('profiles')
          .select('role, tenant_id')
          .eq('id', userId)
          .maybeSingle();

      if (profile == null) {
        state = const PermissionState(role: UserRole.public_);
        return;
      }

      final role = UserRoleExtension.fromString(profile['role'] as String?);
      final tenantId = profile['tenant_id'] as String?;

      // Get role permissions
      final permissions = await _fetchRolePermissions(role.value);

      state = PermissionState(
        role: role,
        permissions: permissions,
        tenantId: tenantId,
        isLoading: false,
      );
    } catch (e) {
      state = PermissionState(
        isLoading: false,
        error: 'Failed to load permissions: $e',
      );
    }
  }

  Future<List<String>> _fetchRolePermissions(String roleName) async {
    try {
      final result = await Supabase.instance.client
          .from('role_permissions')
          .select('permissions(name)')
          .eq('roles.name', roleName);

      return (result as List)
          .map((r) => r['permissions']['name'] as String)
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Check if user has specific permission
  bool hasPermission(String permission) {
    // Super admin and owner bypass
    if (state.role == UserRole.owner || state.role == UserRole.superAdmin) {
      return true;
    }

    return state.permissions.contains(permission);
  }

  /// Check module permission (e.g., 'tenant.blog.read')
  bool canAccess(String module, PermissionAction action) {
    final permission = 'tenant.$module.${action.name}';
    return hasPermission(permission);
  }

  /// Check if user can create content in module
  bool canCreate(String module) => canAccess(module, PermissionAction.create);

  /// Check if user can read content in module
  bool canRead(String module) => canAccess(module, PermissionAction.read);

  /// Check if user can update content in module
  bool canUpdate(String module) => canAccess(module, PermissionAction.update);

  /// Check if user can delete content in module
  bool canDelete(String module) => canAccess(module, PermissionAction.delete);

  /// Check if user can publish content in module
  bool canPublish(String module) => canAccess(module, PermissionAction.publish);

  /// Mobile-specific restrictions (from ABAC docs)
  /// Mobile can: Create, Update (drafts)
  /// Mobile cannot: Delete permanent, Publish (governance)
  bool isMobileRestricted(PermissionAction action) {
    // Per ABAC docs: Governance & Publish -> Web Only
    return action == PermissionAction.publish ||
        action == PermissionAction.permanentDelete;
  }

  /// Check permission with mobile channel restriction
  bool canAccessMobile(String module, PermissionAction action) {
    // Block mobile-restricted actions
    if (isMobileRestricted(action)) {
      return false;
    }
    return canAccess(module, action);
  }
}

/// Provider for permission service
final permissionProvider = NotifierProvider<PermissionService, PermissionState>(
  () => PermissionService(),
);

/// Helper provider for current role
final currentRoleProvider = Provider<UserRole>((ref) {
  return ref.watch(permissionProvider).role;
});

/// Helper provider for tenant ID
final currentTenantIdProvider = Provider<String?>((ref) {
  return ref.watch(permissionProvider).tenantId;
});

/// Helper provider for checking admin status
final isAdminProvider = Provider<bool>((ref) {
  return ref.watch(permissionProvider).role.isAdmin;
});
