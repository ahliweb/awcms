> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Last Updated**: 2026-03-08
>
> **Context7 Sources**: `ollama/ollama`, `openclaw/openclaw`

# Ollama Integration

## Purpose

Document how AWCMS uses Ollama as a local model runtime, how it fits behind OpenClaw,
and which boundaries must remain in place so Ollama never becomes a bypass around tenancy,
RLS, or secret-handling rules.

## Current Role in AWCMS

AWCMS treats Ollama as a local, self-hosted model runtime for development, experimentation,
or tenant-specific AI routing behind OpenClaw.

- Ollama provides the local model server and OpenAI-compatible API.
- OpenClaw remains the tenant-routing and workspace-isolation layer.
- Supabase and Cloudflare Workers remain the sources of truth for data access and edge logic.
- Ollama is not a direct replacement for AWCMS authorization, tenancy, or database policy enforcement.

## Context7 Baseline

Based on Context7 (`ollama/ollama`, `openclaw/openclaw`), AWCMS uses these patterns:

1. Run Ollama locally and call it through `http://127.0.0.1:11434/v1` for OpenAI-compatible flows.
2. Keep model management explicit (`ollama pull <model>`), rather than assuming models are preloaded.
3. Use OpenClaw for multi-agent routing, workspace isolation, and token-protected gateway access.
4. Keep secrets and privileged database credentials out of Ollama runtime configuration.

## Topology

| Layer | Current AWCMS Role | Source of Truth |
| --- | --- | --- |
| Ollama runtime | Local LLM serving, streaming, and tool-calling backend | Local Ollama daemon on `localhost:11434` |
| OpenClaw gateway | Tenant-aware routing, workspace isolation, gateway auth | `openclaw/openclaw.json`, `~/.openclaw/openclaw.json` |
| AWCMS apps/workers | UI, workflows, ABAC/RLS-enforced data access | `awcms/`, `awcms-public/`, `awcms-edge/`, `supabase/` |

## Quick Start

```bash
# Install Ollama using the platform-specific installer

# Pull recommended models
ollama pull qwen3
ollama pull llama3.2

# Verify the daemon is serving models
curl http://localhost:11434/api/tags
```

## Supported Integration Patterns

### OpenAI-Compatible SDK Usage

Context7 confirms Ollama exposes an OpenAI-compatible endpoint. In AWCMS, point SDK clients to Ollama explicitly:

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:11434/v1/',
  apiKey: 'ollama',
});
```

### Native Ollama SDK Usage

For local experimentation or worker-side adapters, the native `ollama` SDK can be used for chat,
streaming, and tool-calling flows.

### OpenClaw Hand-Off Pattern

When tenant isolation matters, route requests through OpenClaw instead of calling Ollama directly.
Use per-tenant workspaces and explicit agent IDs as documented in
`docs/architecture/openclaw-gateway.md`.

## Configuration Notes

| Surface | Guidance |
| --- | --- |
| Model URL | Use `http://127.0.0.1:11434/v1` for OpenAI-compatible clients |
| Local network exposure | Prefer loopback-only access unless a trusted proxy/front door is deliberately configured |
| Tenant isolation | Enforce in OpenClaw agent config, not inside Ollama |
| Secrets | Never put `SUPABASE_SECRET_KEY`, Cloudflare tokens, or database credentials in Ollama prompts/config |

## Security Rules

- Do not let Ollama talk directly to privileged database paths unless a controlled server-side tool layer mediates access.
- Do not treat Ollama as an authorization system.
- Keep OpenClaw gateway auth enabled when exposing AI capabilities outside local development.
- Keep tenant-specific workspaces separate so context does not bleed across tenants.

## Operational Guidance

- Use `ollama pull` as part of explicit environment setup, not application startup.
- Validate model availability before enabling a tenant/agent route that depends on Ollama.
- Keep Ollama optional: cloud-hosted model providers can remain the primary path where required.
- Track model/runtime decisions in `openclaw/openclaw.json` rather than scattering them across workspace docs.

## References

- `docs/architecture/openclaw-gateway.md`
- `SYSTEM_MODEL.md`
- `AGENTS.md`
- `openclaw/openclaw.json`
