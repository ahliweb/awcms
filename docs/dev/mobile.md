> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Mobile App Development

## 1. Overview

`awcms-mobile/primary` is a cross-platform Flutter application (iOS, Android, Web) that uses **Supabase** as its backend and **Riverpod** for state management. It allows tenant end-users to browse and interact with content managed in AWCMS.

---

## 2. Architecture

| Layer | Technology |
|-------|-----------|
| UI | Flutter Widgets |
| State | Riverpod (`AsyncNotifierProvider`) |
| Backend | `supabase_flutter` package |
| Auth | Supabase Auth (Magic Link / Google OAuth) |
| Real-time | Supabase Realtime (PostgreSQL broadcasts) |
| Secure Storage | `flutter_secure_storage` for session tokens |

---

## 3. Supabase Client Initialization

Initialize the Supabase client once on app startup using the **publishable key**. Never use the service role (secret) key in the mobile app.

```dart
// lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: const String.fromEnvironment('SUPABASE_URL'),
    anonKey: const String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY'),
  );

  runApp(const ProviderScope(child: AwcmsMobileApp()));
}

// Global accessor used throughout the app
final supabase = Supabase.instance.client;
```

---

## 4. Authentication — Login & Session Management

AWCMS Mobile uses Supabase Auth with magic link email sign-in as the primary flow.

```dart
// lib/features/auth/auth_service.dart
import 'package:supabase_flutter/supabase_flutter.dart';

class AuthService {
  final _client = Supabase.instance.client;

  // 1. Request magic link
  Future<void> signInWithEmail(String email) async {
    await _client.auth.signInWithOtp(email: email);
  }

  // 2. Sign out 
  Future<void> signOut() async {
    await _client.auth.signOut();
  }

  // 3. Listen for session changes
  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;

  // 4. Get current user's tenant_id from metadata
  String? get tenantId => 
      _client.auth.currentUser?.userMetadata?['tenant_id'] as String?;
}
```

### Riverpod Provider

```dart
// lib/features/auth/auth_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final authProvider = StreamProvider<AuthState>((ref) {
  return Supabase.instance.client.auth.onAuthStateChange;
});

final currentUserProvider = Provider<User?>((ref) {
  final auth = ref.watch(authProvider);
  return auth.valueOrNull?.session?.user;
});
```

---

## 5. Fetching Dynamic Content

Retrieve tenant-scoped content using a Riverpod `AsyncNotifierProvider`. RLS ensures only content belonging to the authenticated user's tenant is returned.

```dart
// lib/features/articles/articles_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

// Model
class Article {
  final String id;
  final String title;
  final String? body;
  final DateTime publishedAt;

  Article({required this.id, required this.title, this.body, required this.publishedAt});

  factory Article.fromJson(Map<String, dynamic> json) => Article(
        id: json['id'] as String,
        title: json['title'] as String,
        body: json['body'] as String?,
        publishedAt: DateTime.parse(json['published_at'] as String),
      );
}

// Notifier
class ArticlesNotifier extends AsyncNotifier<List<Article>> {
  @override
  Future<List<Article>> build() => _fetch();

  Future<List<Article>> _fetch() async {
    final data = await Supabase.instance.client
        .from('blogs')
        .select('id, title, body, published_at')
        .eq('is_published', true)
        .order('published_at', ascending: false)
        .limit(20);
    return data.map<Article>((row) => Article.fromJson(row)).toList();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }
}

final articlesProvider = AsyncNotifierProvider<ArticlesNotifier, List<Article>>(
  ArticlesNotifier.new,
);
```

---

## 6. Real-Time Content Updates

Use Supabase Realtime to push content updates to the Flutter app without polling, delivering near real-time UX.

```dart
// lib/features/articles/articles_realtime.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Subscribes to INSERT/UPDATE events on the `blogs` table for the user's tenant.
final articlesRealtimeProvider = StreamProvider<List<Map<String, dynamic>>>((ref) {
  final client = Supabase.instance.client;

  return client
      .from('blogs')
      .stream(primaryKey: ['id'])
      .eq('is_published', true)
      .order('published_at', ascending: false)
      .limit(20);
});
```

### Using in a Widget

```dart
// lib/features/articles/articles_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'articles_realtime.dart';

class ArticlesScreen extends ConsumerWidget {
  const ArticlesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final articlesAsync = ref.watch(articlesRealtimeProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Latest News')),
      body: articlesAsync.when(
        data: (articles) => ListView.builder(
          itemCount: articles.length,
          itemBuilder: (ctx, i) => ListTile(
            title: Text(articles[i]['title'] as String),
            subtitle: Text(articles[i]['published_at'] as String),
          ),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
      ),
    );
  }
}
```

---

## 7. Security Rules

| Rule | Reason |
|------|--------|
| Use `SUPABASE_PUBLISHABLE_KEY` only | Publishable key is safe to bundle; secret key is not |
| Store session in `flutter_secure_storage` | Protects JWT from plain-text access |
| All privileged operations via Edge Functions | Functions hold the service role key server-side |
| RLS policies enforce tenant isolation | Guarantees users only see their own tenant's data |

---

## 8. Setup & Running

```bash
cd awcms-mobile/primary
cp .env.example .env        # fill SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
flutter pub get
flutter run                 # iOS simulator, Android emulator, or web
```

### Build Flavors

| Flavor | Purpose | Config |
|--------|---------|--------|
| `dev` | Local / staging Supabase | `.env.dev` |
| `prod` | Production Supabase | `.env.prod` |

```bash
flutter run --dart-define-from-file=.env.dev
flutter build apk --dart-define-from-file=.env.prod
```
