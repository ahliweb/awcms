# OpenClaw AI Gateway

> **Documentation Authority:** [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
> **Last Updated:** 2026-02-24
> **Context7 Source:** `openclaw/openclaw`

## Purpose

Document how AWCMS uses OpenClaw as a per-tenant AI gateway, including tenant-to-agent mapping, routing, security controls, and operational runbooks.

## Context7 Baseline for AWCMS

Based on Context7 (`openclaw/openclaw`), AWCMS adopts these OpenClaw patterns:

1. **Multi-agent routing** using `agents.list` and `bindings`.
2. **Workspace isolation** per agent to prevent context bleed.
3. **Token-authenticated gateway** with rate limiting.
4. **Webhook/API ingress** (`/hooks/agent`, `/v1/chat/completions`) for external automation.

These are implemented in `openclaw/openclaw.json` and mirrored to `~/.openclaw/openclaw.json` in runtime.

## AWCMS Per-Tenant Mapping Model

| AWCMS Concept | OpenClaw Field | Rule |
| --- | --- | --- |
| Tenant identity (`tenant_id`, `slug`) | `agents.list[].id` | Use stable per-tenant IDs (example: `tenant_smk_1`) |
| Tenant working context | `agents.list[].workspace` | One workspace folder per tenant |
| Tenant AI policy | `agents.list[].tools.profile` + `allow`/`deny` | Restrict capabilities by tenant use case |
| Tenant communication channel | `bindings[].match` | Bind channel/account identifiers to the same tenant agent |
| Tenant routing target | `bindings[].agentId` | Must point to the correct tenant agent ID |

Recommended convention:

- `agentId`: `tenant_<tenant_slug>`
- `workspace`: `~/.openclaw/workspace-tenant-<tenant_slug>`

## Configuration Topology

| File | Scope | Notes |
| --- | --- | --- |
| `openclaw/openclaw.json` | Repository template | Version-controlled baseline; do not store secrets |
| `~/.openclaw/openclaw.json` | Host runtime | Active runtime config used by OpenClaw CLI |
| `~/.openclaw/workspace-tenant-*` | Tenant runtime state | Per-tenant prompts, memory, and sessions |

Sync template to runtime with strict permissions:

```bash
mkdir -p ~/.openclaw
install -m 600 openclaw/openclaw.json ~/.openclaw/openclaw.json
```

## Current AWCMS Gateway Controls

AWCMS enforces these hardened defaults in `openclaw/openclaw.json`:

```json
{
  "gateway": {
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "rateLimit": {
        "maxAttempts": 10,
        "windowMs": 60000,
        "lockoutMs": 300000,
        "exemptLoopback": true
      }
    },
    "trustedProxies": ["127.0.0.1"],
    "tools": { "deny": ["browser"] }
  }
}
```

- `bind: loopback` keeps the gateway internal by default.
- `auth.mode: token` enforces authenticated ingress.
- `rateLimit` throttles brute-force attempts.
- `tools.deny: ["browser"]` reduces high-risk tool surface.

## Per-Tenant Onboarding Workflow

### 1) Prepare tenant workspace

```bash
mkdir -p ~/.openclaw/workspace-tenant-<tenant_slug>
```

### 2) Add tenant agent entry

Add a new object in `agents.list`:

```json
{
  "id": "tenant_<tenant_slug>",
  "workspace": "~/.openclaw/workspace-tenant-<tenant_slug>",
  "model": {
    "primary": "anthropic/claude-3-5-sonnet"
  },
  "tools": {
    "profile": "messaging",
    "deny": ["browser"]
  }
}
```

### 3) Add channel/account bindings

Bind incoming channel traffic to the same tenant agent:

```json
{
  "agentId": "tenant_<tenant_slug>",
  "match": {
    "channel": "whatsapp",
    "accountId": "<tenant_whatsapp_account_id>"
  }
}
```

Repeat for other channels (Telegram/Slack/Discord) as needed.

### 4) Validate gateway health

```bash
openclaw gateway status
openclaw health
openclaw logs --follow
```

### 5) Smoke-test tenant routing

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-openclaw-agent-id: tenant_<tenant_slug>" \
  -d '{
    "model": "openclaw",
    "messages": [{"role":"user","content":"tenant routing check"}]
  }'
```

If successful, logs should show the request served by the target tenant agent/workspace.

## Calling OpenClaw from AWCMS Flows

For event-driven automation (notifications, summaries, workflow signals), AWCMS should call OpenClaw with an explicit tenant agent ID.

Context7-aligned webhook pattern:

```bash
curl -X POST http://127.0.0.1:18789/hooks/agent \
  -H "Authorization: Bearer $OPENCLAW_HOOKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "tenant_<tenant_slug>",
    "message": "Summarize today\'s moderation queue",
    "wakeMode": "now",
    "deliver": true,
    "channel": "whatsapp",
    "to": "+62xxxxxxxxxx",
    "timeoutSeconds": 120
  }'
```

AWCMS integration rules:

- Resolve tenant context from AWCMS (`tenant_id`/`slug`) before calling OpenClaw.
- Never route without explicit `agentId` for tenant-scoped events.
- Keep Supabase secret keys and database credentials out of OpenClaw config/workspaces.
- Respect ABAC/RLS boundaries; OpenClaw is an orchestration layer, not a bypass layer.

## Operational Runbook

| Task | Action | Verification |
| --- | --- | --- |
| Onboard tenant | Create workspace, add `agent`, add `bindings` | Routing smoke test returns from tenant agent |
| Suspend tenant AI | Remove/disable tenant bindings | Requests no longer reach tenant agent |
| Rotate gateway token | Update token in runtime environment and restart gateway | Old token returns `401` |
| Change tenant model/tools | Update `agents.list[]` model or `tools` policy | `openclaw health` + functional prompt test |
| Audit routing correctness | Review `openclaw logs --follow` during test traffic | Channel/account IDs map to expected agent IDs |

## Security Guardrails

- Keep gateway bound to loopback unless a controlled reverse-proxy path is required.
- Keep `~/.openclaw/openclaw.json` permissions at `600`.
- Never commit tokens, channel API keys, or webhook secrets.
- Keep per-tenant workspaces separate; do not reuse one workspace for multiple tenants.
- Apply least privilege in `tools.profile` and per-agent `allow`/`deny` lists.

## Troubleshooting

- **Wrong tenant receives messages**: verify `bindings` specificity (`channel` + `accountId`) and `agentId` spelling.
- **Unauthorized (`401`)**: token mismatch or missing `Authorization` header.
- **Tool blocked unexpectedly**: check gateway/global `tools.deny` and tenant tool policy.
- **No response from hooks**: confirm gateway process is healthy and hook endpoint/token are enabled.

## Verified Against

- Context7 library: `openclaw/openclaw` (gateway auth, multi-agent routing, webhook/API patterns)
- Project configuration: `openclaw/openclaw.json`
- System constraints: `SYSTEM_MODEL.md` section 1.4
