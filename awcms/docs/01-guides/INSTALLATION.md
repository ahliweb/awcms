
# Installation Guide

## Prerequisites

Before you begin, ensure you have the following installed:

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Node.js | 20.x or higher | `node --version` |
| npm | 10.x or higher | `npm --version` |
| Git | Latest | `git --version` |

> **Note:** Node.js 18.x is also compatible but 20.x is recommended for best performance.

---

## Step-by-Step Setup

### 1. Clone Repository

```bash
git clone https://github.com/ahliweb/awcms.git
cd awcms
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:

- React 18.3.1
- Vite 7.2.7
- Supabase client 2.87.1
- TipTap editor 3.13.0
- And all other dependencies...

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Supabase credentials:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Optional: For server-side admin operations
VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> **⚠️ Security Warning:** Never commit `.env.local` to version control. It contains sensitive credentials.

### 4. Start Development Server

```bash
npm run dev
```

The application will be available at: **<http://localhost:3000>**

---

## Supabase Setup

### Create a Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your **Project URL** and **anon key** from Settings > API

### Import Database Schema

Run the SQL migrations in your Supabase SQL Editor:

```sql
-- See docs/02-reference/DATABASE_SCHEMA.md for full schema
```

Or use the Supabase CLI:

```bash
supabase db push
```

---

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Development | `npm run dev` | Start Vite dev server with HMR |
| Build | `npm run build` | Create production build |
| Preview | `npm run preview` | Preview production build locally |
| Lint | `npm run lint` | Run ESLint checks |
| Lint Fix | `npm run lint:fix` | Auto-fix linting issues |

---

## Verification

After setup, verify everything works:

1. **Check npm audit:**

   ```bash
   npm audit
   # Should show: found 0 vulnerabilities
   ```

2. **Run build:**

   ```bash
   npm run build
   # Should complete without errors
   ```

3. **Access the app:**
   - Open <http://localhost:3000>
   - You should see the AWCMS landing page

---

## Troubleshooting

### Common Issues

#### Error: Cannot find module 'xyz'

```bash
rm -rf node_modules package-lock.json
npm install
```

#### Error: Supabase connection failed

- Verify your `.env.local` credentials
- Check if your Supabase project is active
- Ensure network access to Supabase

#### Port 3000 already in use

- Vite will automatically use the next available port (3001, 3002, etc.)

---

## Next Steps

- [Configuration Guide](CONFIGURATION.md) - Customize your AWCMS instance
- [Database Schema](../02-reference/DATABASE_SCHEMA.md) - Understand the data model
- [Deployment Guide](DEPLOYMENT.md) - Deploy to production
