/// AWCMS Mobile - Auth Service
///
/// Service untuk autentikasi dengan Supabase Auth.
/// Mendukung email/password, magic link, dan session management.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Authentication state
enum AuthStatus { initial, authenticated, unauthenticated, loading }

/// Auth state data class
class AuthState {
  final AuthStatus status;
  final User? user;
  final String? errorMessage;

  const AuthState({
    this.status = AuthStatus.initial,
    this.user,
    this.errorMessage,
  });

  AuthState copyWith({AuthStatus? status, User? user, String? errorMessage}) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      errorMessage: errorMessage,
    );
  }

  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isLoading => status == AuthStatus.loading;
}

/// Auth Service using Riverpod Notifier
class AuthService extends Notifier<AuthState> {
  @override
  AuthState build() {
    // Listen to auth state changes
    _listenToAuthChanges();

    // Check initial session
    final session = Supabase.instance.client.auth.currentSession;
    if (session != null) {
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
          state = AuthState(
            status: AuthStatus.authenticated,
            user: session?.user,
          );
          break;
        case AuthChangeEvent.signedOut:
          state = const AuthState(status: AuthStatus.unauthenticated);
          break;
        case AuthChangeEvent.tokenRefreshed:
          state = state.copyWith(user: session?.user);
          break;
        default:
          break;
      }
    });
  }

  /// Sign in with email and password
  Future<void> signInWithEmail(String email, String password) async {
    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);

    try {
      final response = await Supabase.instance.client.auth.signInWithPassword(
        email: email,
        password: password,
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
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
    } catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'An unexpected error occurred',
      );
    }
  }

  /// Sign in with magic link (OTP)
  Future<void> signInWithMagicLink(String email) async {
    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);

    try {
      await Supabase.instance.client.auth.signInWithOtp(email: email);

      // Stay in loading state - user needs to check email
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: null,
      );
    } on AuthException catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
    }
  }

  /// Sign up with email and password
  Future<void> signUp(String email, String password, {String? name}) async {
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
      state = const AuthState(status: AuthStatus.unauthenticated);
    } catch (e) {
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

      return profile?['tenant_id'] as String?;
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
