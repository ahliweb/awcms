# Contributing to AWCMS

## Purpose
Provide contribution guidelines aligned to AWCMS core standards.

## Prerequisites
- Read `AGENTS.md`
- Read `awcms/docs/00-core/CORE_STANDARDS.md`

## Development Setup

See `README.md` and `DOCS_INDEX.md` for package-specific setup instructions.

## Core Rules

- Multi-tenancy is mandatory: always scope by `tenant_id` and respect RLS.
- Permission keys must follow `scope.resource.action` and be enforced at UI and data layers.
- Soft delete only: update `deleted_at`, never hard delete tenant data.
- Supabase is the only backend (no custom servers).
- Admin panel uses JavaScript (ES2022+); public portal uses TypeScript.
- Use shadcn/ui components and `useToast` for UI feedback.

## Pull Request Checklist

- Update documentation when behavior changes.
- Add or update tests where appropriate.
- Ensure linting and tests pass locally.
- Reference relevant issues and describe scope clearly.

## Issue Reporting

- Use GitHub Issues for bugs and feature requests.
- Include reproduction steps and environment details.

## Code of Conduct

See `CODE_OF_CONDUCT.md`.
