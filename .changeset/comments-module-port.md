---
"awcms": minor
---

Port the `comments` module from awcms-micro (ADR-0041) — moderation-first
commenting over published, public resources.

Registers the 21st base module. Content modules declare which of their resources
accept comments through the new `ModuleDescriptor.commentableResources`
descriptor list (`MODULE_CONTRACT_VERSION` 2.2.0 → 2.3.0, additive optional
field); `comments` discovers them via `listModules()` and depends only on Core,
so nothing depends on it and the DAG stays acyclic. `blog_content` contributes
the first descriptor.

Ships seven tables (`sql/066`, all ENABLE + FORCE RLS), eight permissions
(`sql/067`, reusing existing `AccessAction` literals — no union widening), ten
API routes, an SSR moderation queue at `/admin/comments`, three domain events, a
legal-hold-aware retention sweep (`bun run comments:retention`), and a registry
gate (`bun run comments:resources:check`).

Because this is an unauthenticated public write surface: bodies are stored as
plain text and escaped on render (no stored HTML, so no stored XSS); public
submit responses are uniform, so the endpoint cannot be used as an oracle for
blocked terms or unpublished content; author email, IP, and user-agent are only
ever stored hashed or masked; and notification recipients are encrypted under
their own key, with an unresolvable sentinel rather than plaintext when no key
is configured.

Three defects in the source were fixed rather than carried over: a
millisecond-rounded keyset cursor that skipped rows, `published_at` being
cleared on archive, and a worker INSERT grant justified by a retention event
that was never written.
