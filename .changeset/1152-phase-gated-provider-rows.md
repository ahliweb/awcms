---
"awcms": minor
---

feat(channel_accounts): phase-gated provider rows in the capability matrix (Issue #1152, ADR-0148 section 3). Nine providers now have a row in the omnichannel readiness pack's §3 matrix and in its code mirror `PROVIDER_MATRIX`: X, LINE Official Account, Pinterest and Google Business Profile (phase P3), Discord, Bluesky, Mastodon, Snapchat and Reddit (phase P4). Each row cites the provider's official documentation as read on 11 November 2026 (with the version or last-updated date where the page shows one), uses the same `candidate`/`restricted`/`n/o`/`unverified` cells as the admitted providers, and states the approval or evidence an admission would need per capability. Anything that needs an approval, an allowlist, a beta or a paid credit is `restricted`; anything not read on an official page is `unverified`; Reddit's official pages could not be retrieved and its row is all `unverified`.

**Nothing becomes connectable or usable.** A phase-gated row carries a `phase`, is not registrable, declares no account kind or authentication mode, and `cellGrantability` refuses every one of its cells (`PROVIDER_UNVERIFIED`) whatever the cell reads, so no capability can be recorded or granted for these providers until each passes its own admission ADR (release gates G1 to G6). No existing cell changed, so `PROVIDER_MATRIX_VERSION` stays 1 and no existing grant goes stale.

`GET /api/v1/channel-accounts/providers` returns the nine extra providers and a new nullable `phase` field (`P3`, `P4` or `null`, additive). `/admin/channel-accounts` lists them under "What can be connected" as phase-gated, with no Connect action. New English and Indonesian labels for the nine providers and the phase-gated availability.

Telegram's customer scope stays with #1155 and ADR-0152 and is not re-decided here. No migration, permission, route, dependency, adapter or provider call; no backlog issue is opened, because no capability has a recorded business value (G1) or provider approval (G2).
