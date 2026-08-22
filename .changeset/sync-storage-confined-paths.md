---
"awcms": minor
---

fix(sync-storage): a node's `localPath` was a server path and its `objectKey` had no tenant

Finding **A7** of the 17 August 2026 audit round.

`POST /api/v1/sync/objects` accepts `localPath` and `objectKey` from an
HMAC-authenticated node. The cron dispatcher then runs `Bun.file(localPath)` on
the **server** and `Bun.S3Client.write(objectKey, …)` as the destination. Neither
string had a shape.

**The path.** No root confinement, and the distinguishing error text travelled
back to the node through `last_error` on `GET /api/v1/sync/objects/status` —
`Local file not found: /etc/shadow` versus a read error is an existence oracle
for any path on the host, answerable one string at a time by a client entitled to
poll. `localPath` is now confined to `OBJECT_SYNC_LOCAL_ROOT_PATH` (default
`./var/object-sync`, the same convention `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`
uses), checked at the enqueue boundary **and** again next to the syscall — the
first so a refusal never becomes a durable queue row, the second because rows
queued before this change are still in the table and the check that matters is
the one beside `Bun.file`.

Every refusal reports one sentence. Which rule was broken goes to the server log:
naming the rule is most of what an oracle needs, and the operator debugging a
genuinely misconfigured node reads the log, not the node's console. The
missing-file message no longer contains the path at all.

**The key.** No tenant prefix, so one node could name another tenant's key — and
an S3/R2 PUT to an existing key is an overwrite. The destination is now
`<tenantId>/<objectKey>`, applied at PUT time rather than stored: no migration,
no re-keying of queued rows, and the key a node reads back from
`/sync/objects/status` is still the one it sent. `objectKey` is also validated as
a plain relative key. S3 has no server-side path semantics, so `../` is not
traversal *at the provider* — but `/` is a delimiter for listing, lifecycle rules
and every console that presents a bucket as a tree, and a key that reads as an
escape in the one place a human looks at it will eventually be treated as one.

**On the confinement rule itself.** `resolveConfinedPath` refuses a `..` segment
*textually*, before resolving, and then also checks the resolved path against the
root. The second check alone accepts a path that escapes and comes back
(`../object-sync/x`): it collapses to somewhere inside the root, having named
directories outside it on the way. Nothing reads those, so it is not itself an
exploit — but a rule that accepts it is one refactor from a rule that follows it,
and "a relative path of ordinary segments, under the root" is a rule that fits in
a sentence. It deliberately does **not** resolve symlinks: `realpath` needs the
file to exist, and treating symlinks here would imply this is a sandbox. It is a
confinement check for a supplied string.

The finding needs a compromised legitimate node (`AWCMS_SYNC_ENABLED` +
`R2_ENABLED` + the deployment HMAC secret) to reach, which is why it was rated
below the others in its group.
