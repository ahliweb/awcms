🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0117-latest-moves-only-after-the-approval-that-signs-it.id.md)

# ADR-0117 — `:latest` moves only after the approval that signs it

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decision maker:** ahliweb
- **Amends:** [ADR-0024](0024-semver-numbering-continues-legacy-major-line.md) is untouched; what is amended is the rationale recorded in `docs/awcms/release-process.md` §Environment approval — the `build` job stays ungated, but it no longer publishes `:latest`. See §What is amended, and what is not.
- **Related:** `.github/workflows/release.yml`; `docs/awcms/release-process.md` §2, §`build` job, §Environment approval; release runs 33059543662 (`v10.0.2`), 31805359202 (`v9.1.1`), 31803264915 (`v9.1.0`), 31725195596 (`v9.0.0`), 31479624884 (`v8.0.0`)

## Context

### The gate was documented as protecting credentials, and was read as protecting publication

`release.yml` splits `sign-attest-publish` out of `build` and gates it behind a
GitHub Environment named `release` with a required reviewer. `release-process.md`
§Environment approval explains why `build` itself is **not** gated:

> `sign-attest-publish` declares `environment: release` (`build` does not — since
> it holds no signing/attestation credentials, gating it behind approval would
> only add friction with no security benefit).

That sentence reasons entirely about **credentials**, and about credentials it is
correct: `id-token`/`attestations` are job-scoped, so keeping the third-party
`anchore/sbom-action` out of the job that holds them is a real containment
property and is worth preserving.

What the sentence does not account for is that `build` also **publishes**. Its
`Build and push image` step ran with `push: true` and a tag list that, for a real
release, included `${REPO}:latest` and `${JOBS_REPO}:latest`. So the claim "no
security benefit" was measuring the wrong thing: the benefit of gating that step
was never about what it could sign, it was about what it could make the default
answer to `docker pull ghcr.io/ahliweb/awcms`.

### An approval that can be withheld indefinitely was gating nothing that mattered

The gate holds the job, and it holds it for as long as nobody clicks. That is the
design working. But because `:latest` had already moved by then, "unapproved"
never meant "unpublished" — it only meant "unsigned".

This is not hypothetical, and it is not a near miss. As of 2026-08-28 the
following release runs are **still** sitting at `status: waiting` on the `release`
environment, between 13 and 17 days after their tags were pushed:

| Run         | Tag      | Waiting since | Image pushed | `:latest` moved | Signed |
| ----------- | -------- | ------------- | ------------ | --------------- | ------ |
| 31479624884 | `v8.0.0` | 2026-08-11    | yes          | yes             | **no** |
| 31725195596 | `v9.0.0` | 2026-08-13    | yes          | yes             | **no** |
| 31803264915 | `v9.1.0` | 2026-08-14    | yes          | yes             | **no** |
| 31805359202 | `v9.1.1` | 2026-08-14    | yes          | yes             | **no** |

Measured, not inferred — `gh attestation verify` against the published images:

```
9.1.0  -> exit 1  HTTP 404 (no attestation)
9.1.1  -> exit 1  HTTP 404 (no attestation)
9.1.2  -> exit 0  ok
10.0.2 -> exit 0  ok
```

For the windows in which each of those four was the newest build, the image that
`ghcr.io/ahliweb/awcms:latest` resolved to was one the project had never approved
and has never signed. A consumer following this repo's own documented
verification recipe — `release-process.md` §Verification, `gh attestation verify
oci://ghcr.io/ahliweb/awcms:… --owner ahliweb` — against `:latest` during those
windows would have gotten exactly the 404 above, from an artefact the pipeline
had nonetheless put in front of them.

`v10.0.2` shows the same shape at close range: tag pushed 2026-08-27 09:39 UTC,
`build` finished and `:latest` moved at 09:45, approval arrived 11h53m later at
21:33. For most of a day the default pull of this project was an unsigned image
awaiting a decision that had not been made.

### Why nothing reported it

Every gate in this repo runs against the source tree. This defect lives in the
_ordering of two jobs_, and both jobs are individually correct — `build` builds
and pushes what it was told to, `sign-attest-publish` signs what `build` produced.
There is no artefact whose content is wrong, so there is nothing for a source
gate to read. The one place the ordering was written down in prose is the
sentence quoted above, and that sentence is where the reasoning error is.

The pipeline's own summary comment reinforced it rather than flagging it, listing
the two as one atomic outcome:

```
#   - push tag `v*.*.*`   -> REAL release (image :latest moved, GitHub Release published)
```

`:latest` moved and the Release published are not one event, and the four runs
above are four occasions on which the first happened without the second.

## Decision

**`:latest` is produced only after the `release` environment approval, and only
after the digest it points at has been signed and attested.**

Concretely:

1. `build` no longer emits `:latest` for either repository. It continues to push
   the immutable `:${VERSION}` and `:sha-<12>` tags, ungated. Those are the
   inputs the rest of the pipeline addresses, they are never reused, and an
   unapproved release leaving them behind is inert — nothing resolves to them
   unless someone asks for that exact version.
2. A new `promote-latest` job, `needs: [build, sign-attest-publish]`, retags
   `:latest` for both `ghcr.io/ahliweb/awcms` and `ghcr.io/ahliweb/awcms-jobs`.
   `needs` on the gated job is what gates it; it declares no `environment:` of
   its own, because a second approval prompt for the same decision is friction
   without a second decision behind it.
3. It holds `packages: write` and nothing else. It is a **separate job** rather
   than extra steps inside `sign-attest-publish` for precisely the reason that
   job exists at all: `id-token`/`attestations` are job-scoped, and the fewer
   steps that sit in the job holding them, the smaller the surface that can mint
   an OIDC token. Adding `docker/setup-buildx-action` to the privileged job would
   have spent the containment property this ADR is trying to preserve.
4. The retag is a **registry** operation: GET the manifest, PUT the same bytes
   under the name `latest`. Byte-identical content hashes identically, so
   `:latest` cannot land anywhere but the signed digest. The application image is
   bound by `@${APP_DIGEST}` — the exact digest handed to `cosign sign` and both
   attest steps — so it cannot drift even if something else moved the version
   tag. (This point originally specified `docker buildx imagetools create`; that
   was wrong and the first live run proved it. See §Amendment.)
5. A verification step re-reads `:latest` from the registry and fails the job
   unless it resolves to that signed digest. The invariant this ADR introduces is
   cheap enough to assert directly, and an ADR whose property is only asserted in
   prose is the shape that produced this defect.

### Ordering: promote _after_ the GitHub Release, not before

Both orderings keep `:latest` signed, so the choice is decided by failure modes,
which are not symmetric.

The release-notes step is the one that has actually failed in this pipeline
before: `v7.0.0` died there on a 186,449-character body, **after** signing,
attestation and the image push had all succeeded — the incident that put the
118,000-byte truncation guard in the workflow. Promoting `:latest` last means a
repeat of that leaves `:latest` on the previous release. Promoting it first would
mean `:latest` pointing at a version with no GitHub Release describing it, which
is the worse of the two states to be in, because deployments that track `:latest`
would move to code whose notes were never published.

## What is amended, and what is not

**Not amended.** The `build`/`sign-attest-publish` split, and its stated reason.
`build` remains ungated and remains the only job that runs `anchore/sbom-action`.
The rehearsal path is unchanged: `workflow_dispatch` still cannot touch
`:latest`, now enforced by `if: github.event_name == 'push'` on a whole job
rather than by a branch inside a tag-computation script.

**Amended.** The §Environment approval sentence "gating it behind approval would
only add friction with no security benefit" was true of credentials and false of
publication. It is rewritten to say what the gate does and does not cover, and
§`build` job's step 1 ("`:latest` is added only for a real release") now points at
`promote-latest`.

**Explicitly not done.** The four stalled runs are not repaired by this change.
A tag-push run executes the workflow file _as of that tag_, so `v8.0.0`–`v9.1.1`
would still push `:latest` from `build` if they were re-run. They are an
operational item — approve them to get their signatures and Releases, or let
their artefacts expire at 30 days — and either way `:latest` today points at
`10.0.2`, which is signed.

## Amendment 2026-08-28 — `imagetools create` cannot do this, and `v10.0.3` proved it

The first release to run `promote-latest` was `v10.0.3`, and it **failed at the
verification step** — which is the only reason this is an amendment and not a
defect discovered by a consumer weeks later.

`docker buildx imagetools create` does not point a tag at existing bytes. It
always **builds and pushes a new manifest list** wrapping its sources, so
`:latest` landed on a freshly-serialised index `sha256:5dde705e…` while the
signed manifest was `sha256:d5423378…` (a plain
`application/vnd.oci.image.manifest.v1+json`, not an index — `imagetools` wrapped
it). Same layers, same config, different digest.

That distinction is the whole point, because **an attestation is bound to a
digest**. Measured immediately afterwards:

```
gh attestation verify oci://ghcr.io/ahliweb/awcms:10.0.3 --owner ahliweb  -> exit 0
gh attestation verify oci://ghcr.io/ahliweb/awcms:latest --owner ahliweb  -> exit 1
```

So the mechanism chosen to guarantee "`:latest` is always verifiable" produced,
on its first run, a `:latest` that was not verifiable — the exact condition this
ADR exists to prevent, reintroduced by its own implementation. The decision in
§Decision was right; point 4's mechanism was wrong.

**Corrected mechanism.** A tag is only a name the registry maps to manifest
bytes, so the digest-preserving retag is the literal one: `GET
/v2/<name>/manifests/<digest>`, then `PUT /v2/<name>/manifests/latest` with the
same body and the same `Content-Type`. Byte-identical content hashes identically.
Verified against the live registry before shipping: the fetched manifest for
`sha256:d5423378…` is 2,189 bytes and `sha256sum` of those bytes reproduces
`d5423378…` exactly. Uses only `curl` and `jq`, both already on the runner, which
also removes `docker/setup-buildx-action` and `docker/login-action` from a job
holding `packages: write` — a small extra dividend for the containment argument
in point 3.

The verification step is unchanged in purpose but now reads the registry's own
`Docker-Content-Digest` header for the tag rather than a digest re-computed by a
local tool. Point 5's reasoning is what caught this, and it is worth restating
because it nearly did not survive review as "an obvious assertion": **the check
that looks redundant is the one that catches the mechanism you chose wrongly.**

`v10.0.3` shipped signed and attested under its version tag, with its GitHub
Release and assets intact; only `:latest` was wrong, and it stays wrong until the
next release runs the corrected job — there is no way to repair it in place,
because a tag-push run executes the workflow file as of its own tag.

## Consequences

- The default pull of this project is now always an approved, signed image. The
  verification recipe in `release-process.md` §Verification now holds against
  `:latest`, which it did not for four releases.
- A release that is never approved leaves `:version`/`:sha-*` in the registry and
  moves nothing. That is the intended resting state, and it is discoverable —
  the tag exists, the Release does not.
- One additional job per real release, a few seconds of manifest work. No extra
  approval, no change to what is built or signed.
- `:latest` and the newest `:version` tag can now differ, while an unapproved
  release sits at the gate. That is the point, and it is the first time the
  registry has been able to express it.
