🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0002-bun-only-runtime.id.md)

# ADR-0002 — Bun-only runtime & tooling

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** `AGENTS.md` (rule 14), `docs/awcms/10_template_kode_coding_standard.md` (§Backend platform standard), `docs/awcms/18_configuration_env_reference.md` (§Runtime & tooling)

## Context

Running two runtimes (Node.js + Bun) adds behavioural branching, toolchain size, and bug surface. Bun provides a runtime, package manager, test runner, and built-in APIs (`Bun.serve`, `Bun.sql`) that are fast and sufficient for the base's needs.

## Decision

We decided on **Bun-only**: the entire backend, scripts, tests, migrations, build, and repository tooling run with `bun`. Adding `node`/`npm`/`npx`/`pnpm`/`yarn` or an adapter that **forces** the Node.js runtime is forbidden. `node:*` imports are allowed (Bun built-in APIs). Bins with a node shebang (e.g. `astro`, `vite`) are invoked with `bun --bun`. A Node.js exception is only allowed with maintainer permission and a record in the standards audit.

## Consequences

- **Positive:** one toolchain, simpler CI, better performance, runtime ambiguity gone.
- **Trade-off:** Astro does not yet have a first-party Bun adapter — SSR uses a `Bun.serve` seam or `@astrojs/node` running on top of Bun (recorded as a sanctioned exception).
- **Neutral:** pure-JS npm dependencies that are Bun-compatible may still be used.

## Alternatives considered

- **Node.js as the primary platform** — rejected: throws away Bun's advantages and adds a second runtime.
- **Bun + Node.js side by side** — rejected: behavioural branching and maintenance cost.
