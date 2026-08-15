🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0007-openapi-asyncapi-contracts.id.md)

# ADR-0007 — OpenAPI & AsyncAPI as mandatory contracts

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** `docs/awcms/05_openapi_asyncapi_detail.md`, `docs/awcms/10_template_kode_coding_standard.md`

## Context

Without an explicit contract, APIs and events easily drift between modules/derived applications, and are hard to test or verify for consistency. The base needs one source of truth for the REST surface and domain events.

## Decision

We decided to make **OpenAPI** the mandatory contract for REST (`openapi/`) and **AsyncAPI** the mandatory contract for domain events (`asyncapi/`). Every new/changed API must update OpenAPI; every new/changed event must update AsyncAPI. Consistency between contract ↔ module registry is validated automatically (`api:spec:check`): every event declared in `publishes` must be registered as an AsyncAPI channel. The response envelope and the error code catalogue are standardised.

## Consequences

- **Positive:** the contract becomes the source of truth; drift is detected in CI; contract tests and API documentation stay consistent.
- **Trade-off:** extra discipline — an API/event change must not happen without a contract update.
- **Neutral:** a derived application adds its own domain paths/events in `openapi/modules/` and its own AsyncAPI.

## Alternatives considered

- **Contracts generated from the code only** — rejected for the design stage: the contract is used before the code exists (design-first).
- **No event contract** — rejected: cross-module events without a contract are fragile and hard to test.
