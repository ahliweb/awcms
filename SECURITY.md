# Security Policy

AWCMS is a Bun + Astro 7 + PostgreSQL ERP and business-integration platform built on a modular monolith foundation standard. Security reports should be handled privately and must not include production secrets, customer data, database dumps, access tokens, or screenshots that expose restricted information — this applies with extra weight here given the ERP scope (financial, HR/payroll, and tenant business data).

## Supported Versions

| Version                            | Supported                                                        |
| ----------------------------------- | ------------------------------------------------------------------ |
| `main` / latest tagged release     | Yes — actively developed and supported                           |
| Older tagged releases (not latest) | Best-effort only; upgrading to latest is the primary remediation |

`package.json` is the release version (SemVer, Changesets-driven — see `CHANGELOG.md`). Contract (OpenAPI/AsyncAPI `info.version`) and module descriptor (`src/modules/*/module.ts` `version`/`status`) follow their own independent SemVer policy (see `docs/adr/`) and are not mechanically tied to the package release version.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting from the repository Security tab whenever possible:

<https://github.com/ahliweb/awcms/security/advisories/new>

Include:

- affected file, workflow, dependency, or documented control
- reproduction steps or proof of concept using synthetic data only
- impact and affected security property (especially for ERP modules: financial ledgers, payroll, tax/integration data)
- suggested fix, if known

Do not open public issues for exploitable vulnerabilities. Public issues are acceptable only for non-sensitive hardening work that does not reveal an exploit path.

## Baseline Security Controls

- Runtime and package manager: Bun.
- Backend platform: Bun-only; Node.js is not allowed unless a maintainer-approved, documented exception exists.
- Database target: PostgreSQL with RLS, enforced on every tenant-scoped and business-entity-scoped table (ERP modules included).
- RBAC/ABAC default-deny access control on all non-public endpoints.
- Idempotency required on high-risk ERP mutations (posting transactions, payroll runs, financial adjustments, integration syncs).
- Audit trail with redaction on sensitive business/financial actions.
- Security automation: GitHub secret scanning, push protection, Dependabot alerts/security updates, and CodeQL code scanning.
- Repository policy: no real secrets, credentials, customer data, database dumps, or raw production logs in Git, issues, pull requests, or documentation.
- External business-solution integrations (payment gateways, marketplaces, tax/Coretax, logistics providers) connect via outbox/queue, never direct synchronous calls from critical transaction paths.

## Response Process

1. Triage privately and confirm the affected scope.
2. Patch in the smallest safe scope.
3. Add or update tests, docs, and audit notes when the issue changes behavior or operating procedure.
4. Verify with available Bun commands and GitHub security checks.
5. Publish an advisory only after the fix is available or an agreed disclosure window is reached.

## Target Response Times

Best-effort targets for good-faith private reports:

| Stage                       | Target                                                    |
| ---------------------------- | ------------------------------------------------------------ |
| Acknowledge receipt         | within 3 business days                                    |
| Initial severity assessment | within 7 business days                                    |
| Fix or mitigation plan      | within 30 days for high/critical                          |
| Coordinated disclosure      | after fix is available, or 90 days, whichever comes first |

These are goals, not guarantees; timelines depend on severity and complexity.

## Scope

**In scope:** documented security controls and standards in this repository (RBAC/ABAC/RLS design, audit/masking rules, idempotency, sync HMAC, ERP module security), CI/workflow configuration, dependency manifests, and the code under `src/`, `server/`, `scripts/`, and `sql/`.

**Out of scope:** third-party services and providers referenced only as optional integrations, findings that require a compromised host or physical access, and issues in example/illustrative domain content that do not affect the platform standard.

## Safe Harbor

We consider good-faith security research conducted under this policy to be authorized. If you make a good-faith effort to comply with this policy during your research, we will not pursue or support legal action against you for that research. Good faith includes: using only synthetic/test data, not accessing or modifying data you do not own, not degrading service for others, and giving us a reasonable time to remediate before any disclosure. If in doubt, ask first via the private advisory channel.

## Recognition

With your consent, we are happy to credit reporters in the advisory and release notes.
