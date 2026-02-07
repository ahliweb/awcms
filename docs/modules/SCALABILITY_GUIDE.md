> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack) and Section 2 (Data Integrity)

# Scalability Guide

## Purpose

Outline scalability considerations for AWCMS deployments.

## Audience

- Operators planning growth
- Engineers optimizing performance

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for scalability patterns
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/modules/PERFORMANCE.md`

## Core Concepts

- Horizontal scalability via stateless clients.
- Supabase handles database and auth scaling.
- Cloudflare Pages provides edge caching for public content.

## How It Works

- Public portal uses static output with edge caching for assets.
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
