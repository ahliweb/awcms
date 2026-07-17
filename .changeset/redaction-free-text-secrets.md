---
"awcms": patch
---

Close three gaps in `redactSecretsInText` where secret-shaped substrings
passed through free text (error messages, stack traces) unredacted. Each shape
was already covered by the anchored `SECRET_VALUE_PATTERNS` list in the same
file, but was missing from the free-text `TEXT_SECRET_PATTERNS` list — so
object values were masked while the identical secret in an error string was
not.

- Connection-string credentials (`scheme://user:password@host`). This is the
  highest-impact of the three: `DATABASE_URL`/`WORKER_DATABASE_URL` are DSNs,
  so the app's own database password reached `sanitizeErrorForLog` unredacted
  and was persisted to `awcms_domain_event_deliveries.last_error_message` /
  `dead_letter_reason`, then served verbatim by
  `GET /api/v1/domain-events/deliveries` — whose read path documented (and
  relied on) the invariant that write-time redaction had already run.
- PEM private-key blocks truncated before their `-----END-----` marker (a log
  line cut off by a buffer limit). The existing paired pattern cannot match an
  unterminated block, so the raw base64 key body was emitted in full. The new
  fallback is ordered after the paired pattern, which has already consumed
  every well-formed block.
- AWS access key ids (`AKIA…`) embedded in prose.

Adds `tests/redaction.test.ts` pinning all three shapes plus the pattern
ordering; the module previously had no test coverage, which is why the gaps
went unnoticed.
