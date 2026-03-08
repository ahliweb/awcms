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

Initialize the Supabase client once on app startup using the **publishable key**. Never use `SUPABASE_SECRET_KEY` in the mobile app.

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

## 5. Secure Retrieval + Realtime (Benchmark-Ready)

### Objective

Stream tenant-scoped, published content with a safe fallback path for realtime outages.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `tenantId` | `userMetadata['tenant_id']` | Yes | Do not accept from UI input |
| Session | `auth.currentSession` | Yes | Block when signed out |
| Table | Supabase table | Yes | Must include `tenant_id` and `status` |
| Primary Key | Stream config | Yes | Use `.stream(primaryKey: ['id'])` |

### Workflow

1. Initialize Supabase client on app start.
2. Block reads when no active session exists.
3. Build a realtime stream scoped to `tenant_id`, `status = 'published'`, and `deleted_at is null`.
4. Provide a fallback fetch if the realtime stream errors.
5. Render explicit loading, error, empty, and success states.

### Reference Implementation

```dart
// lib/features/articles/articles_data.dart
import 'package:supabase_flutter/supabase_flutter.dart';

final supabase = Supabase.instance.client;

String? resolveTenantId() {
  return supabase.auth.currentUser?.userMetadata?['tenant_id'] as String?;
}

Stream<List<Map<String, dynamic>>> articlesStream(String tenantId) {
  return supabase
      .from('blogs')
      .stream(primaryKey: ['id'])
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .filter('deleted_at', 'is', null)
      .order('published_at', ascending: false)
      .limit(20);
}

Future<List<Map<String, dynamic>>> fetchFallback(String tenantId) {
  return supabase
      .from('blogs')
      .select('id, title, body, published_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .filter('deleted_at', 'is', null)
      .order('published_at', ascending: false)
      .limit(20);
}
```

```dart
// lib/features/articles/articles_screen.dart
import 'package:flutter/material.dart';
import 'articles_data.dart';

class ArticlesScreen extends StatefulWidget {
  const ArticlesScreen({super.key});

  @override
  State<ArticlesScreen> createState() => _ArticlesScreenState();
}

class _ArticlesScreenState extends State<ArticlesScreen> {
  @override
  Widget build(BuildContext context) {
    if (supabase.auth.currentSession == null) {
      return const Center(child: Text('Please sign in.'));
    }

    final tenantId = resolveTenantId();
    if (tenantId == null) {
      return const Center(child: Text('Missing tenant context.'));
    }

    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: articlesStream(tenantId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return FutureBuilder<List<Map<String, dynamic>>>(
            future: fetchFallback(tenantId),
            builder: (context, fallback) {
              if (fallback.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (fallback.hasError) {
                return Center(child: Text('Error: ${fallback.error}'));
              }
              final rows = fallback.data ?? const [];
              if (rows.isEmpty) return const Center(child: Text('No articles yet.'));
              return ListView.builder(
                itemCount: rows.length,
                itemBuilder: (ctx, i) => ListTile(
                  title: Text(rows[i]['title'] as String),
                  subtitle: Text(rows[i]['published_at'] as String),
                ),
              );
            },
          );
        }

        final rows = snapshot.data ?? const [];
        if (rows.isEmpty) return const Center(child: Text('No articles yet.'));

        return ListView.builder(
          itemCount: rows.length,
          itemBuilder: (ctx, i) => ListTile(
            title: Text(rows[i]['title'] as String),
            subtitle: Text(rows[i]['published_at'] as String),
          ),
        );
      },
    );
  }
}
```

### Validation Checklist

- Stream does not start when the user is signed out.
- Queries always include `tenant_id`, `status = 'published'`, and `deleted_at is null`.
- Realtime errors still show data through fallback fetch.
- UI shows deterministic loading, error, empty, and success states.

### Failure Modes and Guardrails

- Tenant spoofing from input: always derive tenant from authenticated profile metadata.
- Draft leakage: enforce `status = 'published'` in both stream and fallback query.
- Empty UI on websocket outage: fallback query path must remain enabled.
- Secret exposure: never use `SUPABASE_SECRET_KEY` in mobile clients.

---

## 6. Security Rules

| Rule | Reason |
|------|--------|
| Use `SUPABASE_PUBLISHABLE_KEY` only | Publishable key is safe to bundle; secret key is not |
| Store session in `flutter_secure_storage` | Protects JWT from plain-text access |
| All privileged operations via server-side edge logic | Cloudflare Workers or approved Supabase functions hold `SUPABASE_SECRET_KEY` server-side |
| RLS policies enforce tenant isolation | Guarantees users only see their own tenant's data |

---

## 7. Setup & Running

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
