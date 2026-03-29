> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.6 (MCP Topology)

# Release Summary: MCP Configuration Optimization (2026-03-29)

## Audience

- Platform maintainers managing developer tooling
- AI Agent operators using OpenCode + MCP servers

## Overview

This release optimized the AWCMS MCP (Model Context Protocol) server topology to resolve tool count overruns in OpenCode and ensure stable AI tool integration. The changes affect developer tooling only — no production runtime or Supabase schema was modified.

## Changes

### 1. Paper MCP Server — Disabled

The `paper` MCP server (`http://127.0.0.1:29979/mcp`) was set to `enabled: false` in `mcp.json`.

**Reason:** The local Paper server is not available in the standard dev environment and was causing MCP initialization errors.

**Impact:** Paper-assisted documentation lookups are unavailable until a local Paper server is running. To re-enable, set `"enabled": true` in `mcp.json` and ensure the Paper server is running on port `29979`.

### 2. GitHub MCP — Toolset Restriction

The GitHub MCP server invocation was updated to pass `--toolsets=default,git`. Previously the server was launched without an explicit toolset filter.

**Before:**

```bash
scripts/start_github_mcp.sh
```

**After:**

```bash
scripts/start_github_mcp.sh --toolsets=default,git
```

**Reason:** The GitHub MCP server exposes a large number of tools. Restricting to `default` and `git` toolsets reduces the tool surface significantly, keeping the total OpenCode tool count within the 100-tool limit.

**Impact:** GitHub tools for Actions, Notifications, Orgs, Projects, Pull Requests and other advanced toolsets are not automatically loaded. Core repo, issue, code search, and git log operations remain available.

### 3. Cloudflare MCP — Disabled Tools List

A curated `disabledTools` list was added to the Cloudflare MCP server entry in `mcp.json`. The following Cloudflare capability groups were disabled:

| Group | Disabled tools |
| --- | --- |
| D1 (Cloudflare Database) | `d1_*` |
| Durable Objects | `do_*` |
| AI (Workers AI) | `ai_*` |
| Service Bindings | `service_binding_*` |
| WorkersForPlatforms | `wfp_*` |
| Workflows | `workflow_*` |
| Wrangler Config | `wrangler_config_*` |
| Domain management | `domain_list` |
| Worker versioning | `version_*` |
| R2 bucket management | `r2_create_bucket`, `r2_delete_bucket` |
| Queue operations | `queue_delete_message`, `queue_get_message`, `queue_update_visibility` |
| Templates | `template_*` |

**Reason:** AWCMS does not use D1, Durable Objects, Workers AI, WorkersForPlatforms, or Workflows. Disabling these groups removes ~30+ unused tools from the tool registry.

**Kept enabled:** R2 object ops, KV ops, Worker deploy/get/list/delete, queue create/list/send, route management, zone management, secret/env management, analytics, CRON management.

## Files Changed

| File | Change |
| --- | --- |
| `mcp.json` | `paper.enabled: false`; `github.args` updated with `--toolsets=default,git`; `cloudflare.disabledTools` list added |
| `SYSTEM_MODEL.md` | §1.6 updated to reflect disabled paper, GitHub toolset restriction, and Cloudflare disabled tools |
| `docs/architecture/tech-stack.md` | Wrangler `^4.77.0` added to backend/edge table |
| `docs/dev/documentation-audit-tracker.md` | Baseline counts updated to 2026-03-29 reality |

## Verification

```bash
# Confirm MCP topology via OpenCode
opencode mcp list

# Confirm docs still pass link check
cd awcms && npm run docs:check
```

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) §1.6 — MCP Topology
- [mcp.json](../../mcp.json) — Repo MCP config
- [docs/dev/setup.md](./setup.md) — MCP Tooling (OpenCode)
