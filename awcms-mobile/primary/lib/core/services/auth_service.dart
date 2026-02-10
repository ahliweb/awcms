/// AWCMS Mobile - Auth Service
///
/// Service untuk autentikasi dengan Supabase Auth.
/// Mendukung email/password, magic link, dan session management.
/// Menggunakan secure storage untuk token.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'secure_storage_service.dart';
import 'security_service.dart';

import 'dart:developer' as developer;

/// Authentication state
enum AuthStatus { initial, authenticated, unauthenticated, loading, blocked }

/// Auth state data class
class AuthState {
  final AuthStatus status;
  final User? user;
  final String? errorMessage;
  final bool isDeviceSecure;

  const AuthState({
    this.status = AuthStatus.initial,
    this.user,
    this.errorMessage,
    this.isDeviceSecure = true,
  });

  AuthState copyWith({
    AuthStatus? status,
    User? user,
    String? errorMessage,
    bool? isDeviceSecure,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      errorMessage: errorMessage,
      isDeviceSecure: isDeviceSecure ?? this.isDeviceSecure,
    );
  }

  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isLoading => status == AuthStatus.loading;
  bool get isBlocked => status == AuthStatus.blocked;
}

/// Auth Service using Riverpod Notifier
class AuthService extends Notifier<AuthState> {
  final _secureStorage = SecureStorageService.instance;

  @override
  AuthState build() {
    // Listen to auth state changes
    _listenToAuthChanges();

    // Check initial session
    final session = Supabase.instance.client.auth.currentSession;
    if (session != null) {
      // Store tokens securely
      _storeTokensSecurely(session);
      return AuthState(status: AuthStatus.authenticated, user: session.user);
    }
    return const AuthState(status: AuthStatus.unauthenticated);
  }

  void _listenToAuthChanges() {
    Supabase.instance.client.auth.onAuthStateChange.listen((data) {
      final AuthChangeEvent event = data.event;
      final Session? session = data.session;

      switch (event) {
        case AuthChangeEvent.signedIn:
          if (session != null) {
            _storeTokensSecurely(session);
          }
          state = AuthState(
            status: AuthStatus.authenticated,
            user: session?.user,
          );
          break;
        case AuthChangeEvent.signedOut:
          _clearTokens();
          state = const AuthState(status: AuthStatus.unauthenticated);
          break;
        case AuthChangeEvent.tokenRefreshed:
          if (session != null) {
            _storeTokensSecurely(session);
          }
          state = state.copyWith(user: session?.user);
          break;
        default:
          break;
      }
    });
  }

  /// Store tokens in secure storage
  Future<void> _storeTokensSecurely(Session session) async {
    await _secureStorage.storeAuthTokens(
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    );
  }

  /// Clear tokens from secure storage
  Future<void> _clearTokens() async {
    await _secureStorage.clearAuthTokens();
  }

  /// Check device security before auth
  Future<bool> _checkDeviceSecurity() async {
    final securityService = SecurityService();
    final isCompromised = await securityService.isDeviceCompromised();

    if (isCompromised) {
      state = const AuthState(
        status: AuthStatus.blocked,
        errorMessage: 'Perangkat tidak aman (root/jailbreak)',
        isDeviceSecure: false,
      );
      return false;
    }
    return true;
  }

  /// Sign in with email and password
  Future<void> signInWithEmail(String email, String password) async {
    developer.log('[AuthService] signInWithEmail called for $email');
    // Check device security first
    if (!await _checkDeviceSecurity()) {
      developer.log('[AuthService] Device security check failed');
      return;
    }

    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);

    try {
      developer.log('[AuthService] Calling Supabase signInWithPassword...');
      final response = await Supabase.instance.client.auth.signInWithPassword(
        email: email,
        password: password,
      );
      developer.log(
        '[AuthService] Supabase response received. User: ${response.user?.id}',
      );

      if (response.user != null) {
        state = AuthState(
          status: AuthStatus.authenticated,
          user: response.user,
        );
      } else {
        state = const AuthState(
          status: AuthStatus.unauthenticated,
          errorMessage: 'Login failed',
        );
      }
    } on AuthException catch (e) {
      developer.log('[AuthService] AuthException: ${e.message}');
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
    } catch (e) {
      developer.log('[AuthService] Unexpected error: $e');
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'An unexpected error occurred',
      );
    }
  }

  /// Sign in with magic link (OTP)
  Future<void> signInWithMagicLink(String email) async {
    if (!await _checkDeviceSecurity()) return;

    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);

    try {
      await Supabase.instance.client.auth.signInWithOtp(email: email);
      state = const AuthState(status: AuthStatus.unauthenticated);
    } on AuthException catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
    }
  }

  /// Sign up with email and password
  Future<void> signUp(String email, String password, {String? name}) async {
    if (!await _checkDeviceSecurity()) return;

    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);

    try {
      final response = await Supabase.instance.client.auth.signUp(
        email: email,
        password: password,
        data: name != null ? {'name': name} : null,
      );

      if (response.user != null) {
        state = AuthState(
          status: AuthStatus.authenticated,
          user: response.user,
        );
      }
    } on AuthException catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
    }
  }

  /// Sign out
  Future<void> signOut() async {
    state = state.copyWith(status: AuthStatus.loading);

    try {
      await Supabase.instance.client.auth.signOut();
      await _clearTokens();
      state = const AuthState(status: AuthStatus.unauthenticated);
    } catch (e) {
      await _clearTokens();
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  /// Reset password
  Future<void> resetPassword(String email) async {
    try {
      await Supabase.instance.client.auth.resetPasswordForEmail(email);
    } on AuthException catch (e) {
      state = state.copyWith(errorMessage: e.message);
    }
  }

  /// Get current user's role from profiles table
  Future<String?> getUserRole() async {
    final user = state.user;
    if (user == null) return null;

    try {
      final profile = await Supabase.instance.client
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

      return profile?['role'] as String?;
    } catch (e) {
      return null;
    }
  }

  /// Get current user's tenant ID
  Future<String?> getTenantId() async {
    final user = state.user;
    if (user == null) return null;

    try {
      final profile = await Supabase.instance.client
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .maybeSingle();

      final tenantId = profile?['tenant_id'] as String?;

      // Store tenant ID securely
      if (tenantId != null) {
        await _secureStorage.storeTenantId(tenantId);
      }

      return tenantId;
    } catch (e) {
      return null;
    }
  }
}

/// Auth provider
final authProvider = NotifierProvider<AuthService, AuthState>(
  () => AuthService(),
);

/// Helper provider for checking auth status
final isAuthenticatedProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).isAuthenticated;
});

/// Helper provider for current user
final currentUserProvider = Provider<User?>((ref) {
  return ref.watch(authProvider).user;
});

/// Helper provider for device security status
final isDeviceSecureProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).isDeviceSecure;
});
