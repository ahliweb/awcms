🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0129-idempotency-key-is-a-shared-openapi-parameter-component.id.md)

# ADR-0129 — `Idempotency-Key` is a shared OpenAPI parameter component

- **Status:** Accepted
- **Date:** 2026-10-05
- **Decision maker:** ahliweb
- **Amends:** [ADR-0026](0026-modular-openapi-ownership-and-composition.md) (the root fragment owns genuinely shared components; this admits one more shared parameter) — an amendment, not a supersession
- **Related:** Issue #896; PR #893 (the bound itself); `src/lib/security/idempotency-key-bound.ts`; `openapi/awcms-public-api.src.yaml`; `tests/openapi-idempotency-key-component.test.ts`

## Context

PR #893 made the middleware refuse an `Idempotency-Key` outside 1 to 255 visible ASCII characters with `400 IDEMPOTENCY_KEY_INVALID`, before any route handler runs. Every operation that takes the header declared it inline (93 declarations across 21 files, 84 with no bound at all and 9 with only `maxLength: 255`), so the contract said nothing about a rule that applies to every route. The bound was documented only in `docs/awcms/database-pooling.md` and the `awcms-idempotency` skill.

Two approaches were open: add `maxLength` and `pattern` to each inline declaration, kept in sync by a codemod and a gate, or admit one shared parameter component.

## Decision

1. **One shared component, `components.parameters.IdempotencyKey`**, in the root fragment next to `CorrelationId`: `in: header`, `name: Idempotency-Key`, `required: true`, `schema` `type: string`, `minLength: 1`, `maxLength: 255`, `pattern: "^[!-~]{1,255}$"`. The description states the `400 IDEMPOTENCY_KEY_INVALID` refusal. Module fragments reference it with `$ref: "#/components/parameters/IdempotencyKey"`, as they already do for `CorrelationId`.
2. **`required` does not vary.** All 93 inline declarations were `required: true`, so a single component loses no information. If a route ever needs the header optional, it adds a second named component (for example `IdempotencyKeyOptional`) — never an inline override.
3. **The component agrees with the runtime.** `IDEMPOTENCY_KEY_MAX_LENGTH` and `IDEMPOTENCY_KEY_PATTERN` in `src/lib/security/idempotency-key-bound.ts` stay the single source of truth; a test asserts the OpenAPI `maxLength`/`minLength`/`pattern` accept and reject exactly what the runtime pattern does.
4. **A gate forbids inline declarations.** `tests/openapi-idempotency-key-component.test.ts` (part of `bun run test`, hence `bun run check`) fails on any `name: Idempotency-Key` parameter in `openapi/awcms-public-api.src.yaml` or `openapi/modules/*.yaml`, so a new module cannot reintroduce an unbounded declaration.
5. **The frozen pre-migration snapshot is not edited.** `tests/openapi-bundle.test.ts` now compares `components.parameters` and every pre-migration path with the `Idempotency-Key` parameter set aside on both sides (the inline declaration in the snapshot, the `$ref` in the bundle), and asserts `IdempotencyKey` is the only parameter component added. This is the one reviewed change to that contract: the parameter gained a bound, a narrowing for a caller that already sent an out-of-bound value.

## Consequences

- **Positive:** the bound is visible in the contract and in the generated reference; one place to change; a gate keeps it that way.
- **Neutral:** no migration, endpoint, event or runtime change. `info.version` is unchanged.
- **Negative:** consumers that generate clients from the bundle see a `$ref` where they saw an inline parameter, and now see the length bound. Behaviour was already enforced at the edge.

## Alternatives considered

- **Inline `maxLength`/`pattern` on every declaration plus a codemod gate** — rejected: 93 copies of one rule, and a gate that must check each copy's text instead of a single definition.
- **Documenting the bound only in prose** — rejected: that is the state this ADR fixes.
