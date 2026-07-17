---
"awcms": minor
---

Sync HMAC: versioned signatures + inactive-by-default node registration (security advisory GHSA-c972-3q5p-g3h4, cross-tenant sync forgery).

- **Signature v2 binds tenant + node.** New `computeSyncSignatureV2` /
  `verifySyncSignatureV2` sign `"v2:<tenantId>:<nodeCode>:<timestamp>:<body>"`,
  so a signature minted for one tenant no longer verifies when
  `X-AWCMS-Tenant-ID` is swapped to another tenant. Nodes send
  `X-AWCMS-Signature-Version: 2`. Timing-safe compare is preserved for both
  versions.
- **Backward-compatible with an off-switch.** `verifySyncHeaders` verifies v2
  when the version header is `2`; requests without the header fall back to the
  legacy v1 scheme (`"<timestamp>.<body>"`) — which remains **cross-tenant
  forgeable** — only while the new env `SYNC_HMAC_ALLOW_LEGACY` is not `false`
  (default allow). Setting `SYNC_HMAC_ALLOW_LEGACY=false` rejects v1 entirely.
- **Nodes auto-register `inactive`.** First-contact sync nodes are quarantined
  `inactive` (code-only change, no migration) and require admin approval via
  `PATCH /api/v1/sync/nodes/{id}` before they can push/pull. Nodes already
  `active` are unaffected. This closes the "new node id" path independently of
  the signature.

Not a complete close on its own: the advisory is fully closed only when
`SYNC_HMAC_ALLOW_LEGACY=false` **and** every node has migrated to v2. This is a
cross-repo change — the v2 material is canonical here, but **awcms-mini** and
the node spec/skill must be updated to emit v2 before legacy is disabled in any
deployment. v1 is deprecated-transitional. New env var `SYNC_HMAC_ALLOW_LEGACY`
(default `true`) must be wired into shared env docs/validation.
