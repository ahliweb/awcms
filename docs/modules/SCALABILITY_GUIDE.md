# Scalability Guide

## Purpose

Outline scalability considerations for AWCMS deployments.

## Audience

- Operators planning growth
- Engineers optimizing performance

## Prerequisites

- `docs/modules/PERFORMANCE.md`

## Core Concepts

- Horizontal scalability via stateless clients.
- Supabase handles database and auth scaling.
- Cloudflare Pages provides edge caching for public content.

## How It Works

- Public portal uses SSR with edge runtime.
- Admin panel remains a SPA and relies on Supabase APIs.
- Analytics dashboards read from `analytics_daily` to avoid scanning raw events.

## Implementation Patterns

- Use pagination and server-side filtering.
- Avoid loading unscoped data across tenants.
- Index `tenant_id` and `created_at` on high-volume tables like `analytics_events`.

## Security and Compliance Notes

- Tenant isolation must hold under scale.

## References

- `docs/modules/PERFORMANCE.md`
- `docs/architecture/overview.md`
