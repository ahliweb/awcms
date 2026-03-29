/// AWCMS Mobile - App Router
///
/// Konfigurasi routing menggunakan GoRouter.
library;

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/access_audit_service.dart';
import '../core/services/auth_service.dart';
import '../features/home/screens/home_screen.dart';
import '../features/auth/screens/login_screen.dart';
import '../features/blogs/screens/blogs_screen.dart';
import '../features/blogs/screens/blog_detail_screen.dart';
import '../features/notifications/screens/notifications_screen.dart';
import '../features/profile/screens/profile_screen.dart';

/// Route names
class AppRoutes {
  static const String home = '/';
  static const String login = '/login';
  static const String blogs = '/blogs';
  static const String blogDetail = '/blogs/:id';
  static const String notifications = '/notifications';
  static const String profile = '/profile';
}

/// Router provider
final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    initialLocation: AppRoutes.home,
    debugLogDiagnostics: true,
    observers: [_AccessAuditObserver()],
    redirect: (context, state) {
      final isLoggedIn = authState.isAuthenticated;
      final isLoggingIn = state.matchedLocation == AppRoutes.login;

      // If not logged in and not on login page, redirect to login
      // Note: For public content, you might want to allow unauthenticated access
      // Uncomment the following lines if you want to require authentication:
      // if (!isLoggedIn && !isLoggingIn) {
      //   return AppRoutes.login;
      // }

      // If logged in and on login page, redirect to home
      if (isLoggedIn && isLoggingIn) {
        return AppRoutes.home;
      }

      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.home,
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.blogs,
        name: 'blogs',
        builder: (context, state) => const BlogsScreen(),
      ),
      GoRoute(
        path: AppRoutes.blogDetail,
        name: 'blogDetail',
        builder: (context, state) {
          final id = state.pathParameters['id']!;
          return BlogDetailScreen(blogId: id);
        },
      ),
      GoRoute(
        path: AppRoutes.notifications,
        name: 'notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: AppRoutes.profile,
        name: 'profile',
        builder: (context, state) => const ProfileScreen(),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.red),
            const SizedBox(height: 16),
            Text(
              'Page not found',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(state.matchedLocation),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => context.go(AppRoutes.home),
              child: const Text('Go Home'),
            ),
          ],
        ),
      ),
    ),
  );
});

class _AccessAuditObserver extends NavigatorObserver {
  void _log(Route<dynamic>? route) {
    final routeName = route?.settings.name;
    final screenName = route?.settings.name ?? route?.settings.toString();
    unawaited(
      AccessAuditService.instance.logAccessEvent(
        action: 'screen.view',
        resource: 'mobile_screen',
        actorType: 'user',
        moduleName: 'mobile_app',
        featureName: 'navigation',
        actionName: 'view',
        resourceType: 'screen',
        routePath: routeName,
        screenName: screenName,
        purpose: 'track mobile screen access',
        triggerSource: 'go_router',
        businessIntent: 'mobile_navigation',
        accessMechanism: 'navigator_observer',
        authMethod: 'session',
      ),
    );
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    _log(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    _log(newRoute);
  }
}
