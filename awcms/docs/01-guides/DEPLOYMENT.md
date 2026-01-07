# Deployment Guide

AWCMS is a **Monorepo** containing two distinct applications. You will deploy them separately to different hosting providers (or the same one as separate projects), connecting to the **same GitHub Repository**.

---

## 1. Public Portal (`awcms-public`)

**Recommended Host**: Cloudflare Pages
**Why**: Native support for Astro Edge SSR and high performance.

### Public Portal Setup

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) > **Workers & Pages**.
2. Click **Create Application** > **Connect to Git**.
3. Select your GitHub Repository (`ahliweb/awcms`).
4. **Configure Build Settings** (Crucial!):
    * **Project Name**: `your-brand-portal`
    * **Production Branch**: `main`
    * **Framework Preset**: Select `Astro`
    * **Root Directory**: `/awcms-public` (⚠️ Important: Do not leave empty)
    * **Build Command**: `npm run build`
    * **Output Directory**: `dist`
5. **Environment Variables**:
    * `PUBLIC_SUPABASE_URL`: Your Supabase Project URL.
    * `PUBLIC_SUPABASE_ANON_KEY`: Your Supabase Anon Key.
6. Click **Save and Deploy**.

---

## 2. Admin Panel (`awcms`)

**Recommended Host**: Cloudflare Pages
**Why**: Keeps deployment in a single platform and works well for React SPAs.

### Admin Panel Setup

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) > **Workers & Pages**.
2. Click **Create Application** > **Connect to Git**.
3. Select your GitHub Repository (`ahliweb/awcms`).
4. **Configure Build Settings**:
    * **Project Name**: `your-brand-admin`
    * **Production Branch**: `main`
    * **Framework Preset**: Select `None` (or `Vite` if available)
    * **Root Directory**: `/awcms` (⚠️ Important: Do not leave empty)
    * **Build Command**: `npm run build`
    * **Output Directory**: `dist`
    * **Node Version**: `20` (Set via Environment Variable `NODE_VERSION`)
5. **Environment Variables**:
    * `VITE_SUPABASE_URL`: Your Supabase Project URL.
    * `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon Key.
    * `VITE_TURNSTILE_SITE_KEY`: Your **Production** Cloudflare Turnstile Site Key (Do not use the Test Key).
    * `NODE_VERSION`: `20` (Required for Vite v5+)
6. Click **Save and Deploy**.

---

## 3. Connect the Dots (Supabase)

Once both sites are live, you need to update Supabase Authentication settings.

1. Go to Supabase Dashboard > **Authentication** > **URL Configuration**.
2. **Site URL**: Set to your **Admin Panel** URL (e.g., `https://admin.your-project.pages.dev`).
    * This is where "Magic Links" and Password Resets will redirect by default.
3. **Redirect URLs**: Add your Public Portal and Admin URLs.
    * `https://your-brand-portal.pages.dev/*`
    * `https://your-brand-admin.pages.dev/*`
    * `https://*.your-brand-portal.pages.dev/*` (If using wildcards for tenants)

---

## 4. DNS & Custom Domains (Multi-Tenancy)

### For Public Portal (Tenants)

To allow tenants to use subdomains (e.g., `tenant1.yoursite.com`) or custom domains (`tenant.com`):

1. In Cloudflare Pages > **Custom Domains**, add your main domain (`yoursite.com`).
2. For subdomains: Add a CNAME record `*` pointing to `your-brand-portal.pages.dev` in your DNS provider.
3. **AWCMS Configuration**:
    * Go to Admin Panel > **Tenants**.
    * Edit a Tenant -> Update **Subdomain** or **Custom Domain** field.
    * The Public Portal Middleware (`src/middleware.ts`) will automatically resolve the host.

### For Admin Panel

Typically lives on a secure subdomain like `admin.yoursite.com` or `app.yoursite.com`.

---

## 5. Mobile Application (`awcms-mobile`)

The mobile app is a Flutter project located in `/awcms-mobile`.

**Prerequisites**:

* Flutter SDK 3.x+
* Android Studio / Xcode

### Build & Deploy

1. **Configuration**:
   * Ensure `lib/core/constants/app_constants.dart` points to your Supabase URL.
   * Update `android/app/build.gradle` and `ios/Runner.xcodeproj` with your App ID.

2. **Build for Stores**:

   ```bash
   cd awcms-mobile
   
   # Android App Bundle (Play Store)
   flutter build appbundle --release
   
   # iOS Archive (App Store)
   flutter build ipa --release
   ```

3. **CI/CD**:
   * Automated builds are configured in [ci.yml](../../../.github/workflows/ci.yml).
   * Artifacts are uploaded to GitHub Actions releases.

For more details, see [Mobile Development](../01-guides/MOBILE_DEVELOPMENT.md).
