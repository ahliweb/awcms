---
"awcms": patch
---

`promote-latest` now retags `:latest` without changing its digest (ADR-0117 §Amendment).

ADR-0117's decision was right and its mechanism was wrong.
`docker buildx imagetools create` does not point a tag at existing bytes — it
always builds and pushes a NEW manifest list wrapping its sources. On `v10.0.3`,
the first release to run the job, `:latest` therefore landed on a
freshly-serialised index `sha256:5dde705e…` while the signed manifest was
`sha256:d5423378…` (a plain image manifest, which `imagetools` wrapped). Same
layers, different digest.

An attestation is bound to a digest, so:

```
gh attestation verify oci://ghcr.io/ahliweb/awcms:10.0.3 --owner ahliweb  -> exit 0
gh attestation verify oci://ghcr.io/ahliweb/awcms:latest --owner ahliweb  -> exit 1
```

The mechanism chosen to guarantee "`:latest` is always verifiable" produced an
unverifiable `:latest` on its first run. The verification step added in the same
change is the only reason this was caught in the release that introduced it.

- The retag is now a registry operation: `GET /v2/<name>/manifests/<digest>`,
  then `PUT /v2/<name>/manifests/latest` with the same body and `Content-Type`.
  Byte-identical content hashes identically, so `:latest` cannot land anywhere
  but the signed digest. Verified against the live registry before shipping: the
  manifest for `sha256:d5423378…` is 2,189 bytes and `sha256sum` of those bytes
  reproduces that digest exactly.
- Verification now reads the registry's own `Docker-Content-Digest` for the tag
  rather than a digest re-computed locally.
- Uses only `curl` and `jq`, already present on the runner, which also removes
  `docker/setup-buildx-action` and `docker/login-action` from a job holding
  `packages: write`.

`v10.0.3` shipped signed and attested under its version tag with its GitHub
Release intact; only `:latest` was wrong. It cannot be repaired in place — a
tag-push run executes the workflow file as of its own tag — so it is corrected by
this release.
