/// AWCMS Mobile - App Router
///
/// Konfigurasi routing menggunakan GoRouter.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/auth_service.dart';
import '../features/home/screens/home_screen.dart';
import '../features/auth/screens/login_screen.dart';
import '../features/articles/screens/articles_screen.dart';
import '../features/articles/screens/article_detail_screen.dart';

/// Route names
class AppRoutes {
  static const String home = '/';
  static const String login = '/login';
  static const String articles = '/articles';
  static const String articleDetail = '/articles/:id';
}

/// Router provider
final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    initialLocation: AppRoutes.home,
    debugLogDiagnostics: true,
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
        path: AppRoutes.articles,
        name: 'articles',
        builder: (context, state) => const ArticlesScreen(),
      ),
      GoRoute(
        path: AppRoutes.articleDetail,
        name: 'articleDetail',
        builder: (context, state) {
          final id = state.pathParameters['id']!;
          return ArticleDetailScreen(articleId: id);
        },
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
