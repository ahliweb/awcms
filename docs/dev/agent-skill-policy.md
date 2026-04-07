> **Documentation Authority**: [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [../../AGENTS.md](../../AGENTS.md) -> [../../README.md](../../README.md) -> [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Updated:** 2026-04-04

# Agent Skill Policy

## Purpose

Define the AWCMS-specific local skill footprint under `.agents/skills/` so the repository keeps only the skills that directly support the current stack and workflows.

## Policy

- Keep a small local core for the current AWCMS stack and daily workflows.
- Remove adjacent but non-core skills from the repository and install them only when a task explicitly requires them.
- Remove skills that are not relevant to the current AWCMS ecosystem.
- Prefer AWCMS authority docs and verified Context7 library IDs over generic skill bundles when there is overlap.

## Core Retained Skills

These stay in `.agents/skills/` because they map directly to the maintained stack in `SYSTEM_MODEL.md`, the implementation guidance in `AGENTS.md`, and the current MCP/runtime workflow.

| Skill | Why it stays local | AWCMS / Context7 basis |
| --- | --- | --- |
| `astro` | Primary public portal framework skill | `awcms-public/*` uses Astro 6.0.8; Context7: `withastro/docs` |
| `cloudflare` | Primary edge/pages/storage platform skill | `awcms-edge/`, Cloudflare Pages, Workers, R2; Context7: `cloudflare/cloudflare-docs` |
| `code-reviewer` | Direct fit for JS/TS review work in admin/public/edge packages | `AGENTS.md` requires code-review behavior for review tasks |
| `create-plan` | Matches the repo’s explicit plan-first workflow when users ask for a plan | `docs/dev/ai-planning-workflow.md` |
| `frontend-design` | Direct fit for Admin + Public UI work and already matches repo frontend guidance | `AGENTS.md` frontend rules, `awcms/`, `awcms-public/` |
| `gh-fix-ci` | Direct fit for GitHub Actions debugging in the maintained CI setup | `docs/dev/ci-cd.md`, GitHub MCP, `.github/workflows/*.yml` |
| `react-19` | Direct fit for Admin + Public React 19 code generation | React 19.2.4 in `SYSTEM_MODEL.md`; Context7: `websites/react_dev` |
| `supabase-usage` | Direct fit for Supabase Auth, schema, RLS, and query guidance | Supabase is the system of record; Context7: `supabase/supabase`, `supabase/supabase-js`, `supabase/cli` |
| `vite` | Direct fit for Vite config/build/plugin work in the admin workspace | `awcms/` uses Vite `^8.0.5`; Context7: `vitejs/vite` |
| `vitest` | Direct fit for unit/integration testing in maintained JS/TS workspaces | Vitest is the maintained test framework in the repo |

## Remove From Repo, Install On Demand

These are plausible for occasional AWCMS work, but they are not common enough or AWCMS-specific enough to justify always carrying them in `.agents/skills/`.

Install them only when the task explicitly needs their specialty.

| Skill | Install on demand when | Basis |
| --- | --- | --- |
| `API Integration Specialist` | Integrating or hardening third-party APIs/webhooks | AWCMS has external API touchpoints, but not as a daily repo-wide workflow |
| `code-review` | A review explicitly needs the Sentry-style review lens instead of the broader JS/TS reviewer | Overlaps heavily with retained `code-reviewer` |
| `content-creator` | Producing marketing/editorial content for public-facing properties | Public portals exist, but repo work is primarily implementation-oriented |
| `google-analytics` | Auditing analytics or traffic behavior for public portals | Relevant only for analytics investigations |
| `react-best-practices` | Performance-specific React review/refactor work | Useful occasionally; broader than current daily React 19 implementation work |
| `research-lookup` | Current external research or standards lookup is required | Helpful for research spikes, not core day-to-day coding |
| `senior-architect` | Major architecture/trade-off design work is requested | Helpful for system design, but not the daily execution baseline |
| `senior-backend` | Deep backend design/review is needed beyond the retained Cloudflare/Supabase skills | Generic backend guidance; AWCMS backend is Cloudflare + Supabase specific |
| `senior-devops` | CI/CD or deployment design work goes beyond the current maintained workflows | Relevant to release engineering, but not needed in every clone |
| `SEO Optimizer` | Public-portal SEO work is the main task | SEO is relevant to content sites, but not to the core engineering loop |
| `ui-design-system` | Building or refactoring a design system/documentation set | Useful occasionally, not daily |
| `ux-researcher-designer` | UX research or usability synthesis is the actual deliverable | Not part of the normal implementation baseline |

## Remove As Not Relevant To The Current AWCMS Ecosystem

These do not match the maintained AWCMS stack, current product scope, or active MCP/runtime workflows.

| Skill | Why removed |
| --- | --- |
| `artifacts-builder` | Artifact-generation toolkit, not part of the AWCMS product/runtime workflow |
| `axolotl` | LLM fine-tuning workflow not present in AWCMS |
| `chroma` | Vector database skill not part of the maintained stack |
| `clip` | Vision-language/image classification workflow not part of the current product |
| `cocoindex` | ETL/AI indexing workflow not part of AWCMS runtime or CI |
| `deepchem` | Molecular ML not related to AWCMS |
| `dspy` | DSPy workflow not part of the current OpenClaw/Ollama baseline |
| `Excel Analysis` | Spreadsheet analysis is not part of the repository’s engineering workflow |
| `instructor` | Structured LLM extraction library not part of the current stack |
| `langchain` | Not part of the maintained OpenClaw/Ollama architecture |
| `llamaindex` | Not part of the maintained OpenClaw/Ollama architecture |
| `n8n-code-javascript` | n8n is not part of the AWCMS stack |
| `n8n-expression-syntax` | n8n is not part of the AWCMS stack |
| `n8n-node-configuration` | n8n is not part of the AWCMS stack |
| `n8n-workflow-patterns` | n8n is not part of the AWCMS stack |
| `outlines` | Structured generation library not part of the maintained stack |
| `paper-2-web` | Academic paper dissemination workflow does not match AWCMS product scope |
| `PDF Processing` | PDF workflow is not part of the core AWCMS engineering/runtime path |
| `PDF Processing Pro` | PDF workflow is not part of the core AWCMS engineering/runtime path |
| `polars` | Dataframe/data-analysis workflow not part of the product/runtime |
| `pytorch-fsdp` | Distributed model training not related to AWCMS |
| `qdrant-vector-search` | Vector DB/search not part of the maintained stack |
| `tailwind` | This local skill targets Tailwind CSS v3, while AWCMS uses Tailwind CSS v4 and already points to Context7 `websites/tailwindcss` |
| `torch-geometric` | Graph ML not related to AWCMS |
| `unsloth` | LLM fine-tuning workflow not part of AWCMS |
| `web-artifacts-builder` | Artifact-generation toolkit, not part of the AWCMS product/runtime workflow |
| `whisper` | Speech-to-text is not part of the current AWCMS stack |

## Installation Guidance For On-Demand Skills

- Install an on-demand skill only when the task’s primary deliverable matches the skill’s own documented purpose.
- Prefer direct Context7 guidance first when the task is already covered by an AWCMS-verified library ID.
- Remove the on-demand skill again after the task if it does not become part of the maintained operating baseline.

## Current Local Core

The maintained local core under `.agents/skills/` is:

- `astro`
- `cloudflare`
- `code-reviewer`
- `create-plan`
- `frontend-design`
- `gh-fix-ci`
- `react-19`
- `supabase-usage`
- `vite`
- `vitest`

## Related Docs

- [../../SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
- [../../AGENTS.md](../../AGENTS.md)
- [../../README.md](../../README.md)
- [../../DOCS_INDEX.md](../../DOCS_INDEX.md)
- [ci-cd.md](./ci-cd.md)
- [prompt-guide.md](./prompt-guide.md)
