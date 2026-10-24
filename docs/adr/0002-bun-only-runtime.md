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

## Enforcement

The rule is held by tests, not by review. The `Repo hygiene` CI job greps `package.json` scripts; `tests/bun-only-launch-manifests.test.ts` (Issue #1170) covers every place a job or worker is **launched**:

- It discovers `Dockerfile*`, `*.crontab`, `docker-compose*.yml` / `compose*.yml`, `*.service` units, `*.sh` and `.github/workflows`, and rejects any Node.js launcher (`node`, `npm`, `npx`, `pnpm`, `yarn`, `tsx`, `ts-node`, ...) as a command, path, container image or shebang. A Node-only Socket.IO / `ws` daemon is rejected by the same rule.
- Every `oven/bun` image and `setup-bun` version must equal the `packageManager` pin in `package.json` (CI's `engines.bun` floor cell excepted).
- Every scheduled job and every module-registry job resolves to a `package.json` script that is Bun end to end.
- Process identity: each guarded worker entrypoint is imported in a child process and must see `process.versions.bun`, the `Bun` global and a Bun `process.execPath`.
- Allowed, and covered by negative fixtures: `node:*` built-ins, `node_modules`, `NODE_ENV`, `@astrojs/node` hosted under Bun, pure npm packages run by Bun, and comments or prose that merely mention Node.

**Extending it.** A future delivery adapter (StarSender/Meta, Mailketing v2, Telegram customer, social publication, a Bun realtime gateway) is covered with no test edit when its worker is a module `jobs` entry or crontab line and its launch manifest is one of the discovered kinds. Add its job target to `CHANNEL_WORKER_TARGETS` in the test so dropping it from the registry fails instead of passing silently. A new manifest kind (for example a Kubernetes manifest) needs a classifier in `discoverManifests` and a scanner in `tests/support/bun-only-launch-scan.ts`, with positive and negative fixtures. A deployed-container smoke test (`docker run <image> bun -e ...`) needs a Docker daemon and is not part of this static gate.
