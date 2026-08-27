---
"awcms": patch
---

`:latest` now moves only after the release approval that signs it (ADR-0117).

`release.yml`'s `build` job runs BEFORE the `release` environment gate, and its
push step's tag list included `${REPO}:latest` — so "unapproved" never meant
"unpublished", only "unsigned". The documented rationale for leaving `build`
ungated reasoned only about credentials ("holds no signing/attestation
credentials"), which is correct about credentials and silent about the fact that
the same job also publishes.

Four release runs are still waiting at that gate 13–17 days on (`v8.0.0`,
`v9.0.0`, `v9.1.0`, `v9.1.1`), each having already pushed its image and moved
`:latest`. Measured with `gh attestation verify`: `9.1.0` and `9.1.1` return
HTTP 404 with no attestation, while `9.1.2` and `10.0.2` verify — so during the
windows each was newest, this repo's own documented verification recipe would
have failed against the image the pipeline had put in front of consumers.

- `build` now emits only the immutable `:<version>` and `:sha-<12>` tags.
- A new `promote-latest` job (`needs: [build, sign-attest-publish]`,
  `packages: write` only, real releases only) retags `:latest` for both the app
  and jobs images, binding the app image by the exact digest handed to
  `cosign sign`, and then re-reads `:latest` from the registry and fails unless
  it resolves there.
- It runs after `gh release create`, not before: the release-notes step is the
  one that has actually failed here (`v7.0.0`), and promoting last leaves
  `:latest` on the previous release rather than on a version with no Release.
- `actions/attest-sbom` is deprecated and emitted a warning on the `v10.0.2`
  run; swapped for `actions/attest`, which takes the same `sbom-path` input.

The rehearsal path is unchanged — `workflow_dispatch` still cannot touch
`:latest`, now enforced by an `if:` on a whole job rather than a branch inside a
tag-computation script.
