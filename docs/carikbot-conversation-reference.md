# CarikBot conversational-flow concepts — AWCMS ownership assessment

## Document control
- Version: v1.0.0
- Date: 2026-11-10
- Status: F0 research only
- Issue: https://github.com/ahliweb/awcms/issues/1253
- Document changeset: Typed conversational-flow reference under existing channel/workflow authorities.

## Verified status and non-duplication
AWCMS already owns tenant access, workflow-approval, channel-accounts, WhatsApp/Telegram delivery and audit. Existing inbound omnichannel architecture #1144 and unified inbox implementation #1164 govern provider events and projections. CarikBot concepts must NOT establish another actor master, provider gateway, business state store, agent runtime or generalized chat webhook.

## Candidate reuse
The Carik engine demonstrates intent/entity/handler mapping; the ecosystem uses Freemind/JSON MindFlow, nested menus, simple API POST and menu/button/form responses. Consider a typed, versioned, low-code flow definition ONLY if real user research establishes a gap over existing AWCMS forms and workflow-approval. Hermes may classify intent or suggest replies using sanitized, authorized context, but AWCMS must deterministically validate every action and outgoing message.

## Proposed logical contract — NOT existing API
- VerifiedEvent: tenant, channel account, provider event ID, actor reference, conversation ID, timestamp, provenance and correlation.
- FlowDefinition: tenant, flow ID/version, approved publisher, start node, node catalogue, data classification, purpose, allowed commands, retention and rollback revision.
- Node variants: text, choice, typed form, approval, command request, end.
- CallbackIntent: opaque expiring token bound to tenant/channel/actor/session/flow version/command; idempotency key and expected prior state.
- Renderer: approved channel capability snapshot, safe text fallback, optional verified buttons/menus.
- Business action: existing authorized application service and outbox; never arbitrary provider URL/SQL.

## Verification matrix
1. Cross-tenant spoofed callback must fail ABAC and FORCE RLS.
2. Text-only channel must render menu without unsupported buttons.
3. Form field validation handles min/max, prohibited fields, CANCEL and retention.
4. Regex collisions and unbounded patterns fail static validation.
5. Human workflow approval remains required for sensitive transactions.
6. Duplicate provider event/retry is idempotent and traceable.
7. Unauthorized service URL, loopback, unsafe redirect or webhook signature is rejected.
8. CRM summarization by Hermes cannot send or alter authoritative records without a separate checked command.

## Research backlog
First audit current modules, provider-specific channel policy, workflow/form capabilities and actual API contracts; compare embedding simple state machine versus external BPMN; define UX prototype and contract; only after Gate 9 can new implementation issue be proposed. No new microservice per flow and no copying Carik source.

## Security
Use least privilege, signature verification, tenant authorization, CSRF/replay control, rate limit, encrypted/redacted sensitive data, explicit consent, provenance, immutable events, approval and audit correlation. All LLM/proxy outputs are untrusted. Standards: UU 27/2022, PP 71/2019, applicable SPBE, ISO/IEC 27001/27002/27005/27034/27701/42001 and OWASP API/Agentic.


## Sources examined
- Engine: https://github.com/luridarmawan/Carik/blob/master/README.md and source/carik/routes.pas
- Ecosystem: https://github.com/CarikBot/ecosystem/blob/main/README.md
- MindFlow: https://github.com/CarikBot/ecosystem/blob/main/docs/mindmap-structure.md
- API: https://github.com/CarikBot/ecosystem/blob/main/docs/api-structure.md
- Package registry: https://github.com/CarikBot/ecosystem/blob/main/data/package.json
- Real PHP examples: https://github.com/CarikBot/ecosystem/blob/main/source/services/lib/lib.php and source/services/tools/echo/index.php
- Workflow: https://github.com/CarikBot/ecosystem/blob/main/.github/workflows/updater-development.yml
- License: https://github.com/luridarmawan/Carik/blob/master/LICENSE.txt

No Pascal, FastPlaz, PHP or Carik source is licensed for reuse by assumption. The Carik engine license text lacks a detailed grant, while ecosystem package.json declares MIT but an equivalent root LICENSE file was not found in this review. Independent implementation of concepts only.


## Changelog
- v1.0.0 — 2026-11-10: Research-only owner and interface boundary.
