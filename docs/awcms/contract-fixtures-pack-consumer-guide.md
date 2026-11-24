🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](contract-fixtures-pack-consumer-guide.id.md)

# Contract fixtures pack: pinning and verifying (consumer guide)

Issue #1394 (sub-issue of #1396), [ADR-0167](../adr/0167-contract-derived-fixtures-and-two-sided-conformance-checks-with-an-in-repo-generator-and-ajv.md). Pack: [`fixtures/api-contract/contract-fixtures.json`](../../fixtures/api-contract/contract-fixtures.json). Generator and gate: `scripts/api-contract-fixtures.ts` (`bun run api:fixtures:generate|:check`). Hygiene rules: `scripts/lib/contract-fixture-pack-hygiene.ts`.

## What the pack is

Data, not a service. For every operation of the bundled OpenAPI contract it holds a request-body example and one example per declared JSON response, each valid against the schema beside it. A consumer (a Storybook, an SSG build, a test) replaces its hand-written stand-ins with the pack, or validates them against it. A consumer **never imports this repository's code** and never reads its database.

## Publishing channel (decision K19.15, 24 Nov 2026)

The consumer request is counted: the public-site repository `ahliweb/awcms-astro` (issue `awcms-astro#194`). The channel is: **the consumer pins the file at an immutable commit SHA of `ahliweb/awcms` and verifies two SHA-256 hashes.** No release asset, no registry, no CI artefact publishing, no new infrastructure.

Options assessed with the repository's criteria (security, maintenance, compatibility):

| Option                                           | Security                                                                     | Maintenance                                                           | Compatibility                                                    | Verdict                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| A. Commit SHA pin of the file in this repository | Immutable by construction (a SHA cannot be moved); no new credential or host | None: the file already exists and `api:fixtures:check` keeps it fresh | Any consumer that can fetch a raw file or `git archive` at a SHA | **Decided**                  |
| B. GitHub release asset                          | Mutable unless releases are locked; needs a publishing job with write scope  | A release step to run and to keep in step with the contract           | Fetch by tag                                                     | Rejected: new infrastructure |
| C. CI artefact                                   | Expires; needs a token to download; scope of the token is wide               | A publishing job and a retention policy                               | Weak: consumers cannot pin a download that expires               | Rejected                     |
| D. Package registry                              | A publishing credential and a supply-chain target                            | Versioning, publishing, deprecation                                   | Good, but turns data into a dependency                           | Rejected: new infrastructure |

## Pack format (manifest)

The first keys of the file are the manifest, in this order:

| Key               | Meaning                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packVersion`     | Pack **format** version (today `2`). A change of format bumps it, so a format change is never mistaken for content.                          |
| `contractVersion` | `info.version` of the OpenAPI bundle the pack was derived from.                                                                              |
| `contractSha256`  | SHA-256 (hex) of the bundle file `openapi/awcms-public-api.openapi.yaml`, at the same commit.                                                |
| `contentSha256`   | SHA-256 (hex) of the pack itself: of `JSON.stringify(rest, null, 2) + "\n"`, `rest` being the parsed pack without this key (key order kept). |

The rest (`summary`, `sharedResponses`, `operations`, `skipped`) is described in [`05_openapi_asyncapi_detail.md`](05_openapi_asyncapi_detail.md) (section "Fixtures pack and freshness gate").

## How to pin

1. Choose a commit SHA of `ahliweb/awcms` (40 hex characters, never a branch or a tag name) and record it in the consumer repository, for example in a `contract-pin.json` next to the vendored files: `{ "repo": "ahliweb/awcms", "sha": "<40 hex>", "contentSha256": "<64 hex>", "contractSha256": "<64 hex>" }`.
2. Fetch the two files at that SHA:

```sh
SHA=<40-hex-commit-sha>
BASE=https://raw.githubusercontent.com/ahliweb/awcms/$SHA
curl -fsSL "$BASE/fixtures/api-contract/contract-fixtures.json" -o contract-fixtures.json
curl -fsSL "$BASE/openapi/awcms-public-api.openapi.yaml" -o awcms-public-api.openapi.yaml
```

3. Verify both hashes against the file you fetched and against the values you recorded (Bun):

```ts
import { createHash } from "node:crypto";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const text = await Bun.file("contract-fixtures.json").text();
const pack = JSON.parse(text);
const { contentSha256, ...rest } = pack;

const contentOk = sha(JSON.stringify(rest, null, 2) + "\n") === contentSha256;
const bundleOk =
  sha(await Bun.file("awcms-public-api.openapi.yaml").text()) ===
  pack.contractSha256;
if (!contentOk || !bundleOk || pack.packVersion !== 2) {
  throw new Error("fixtures pack failed verification, do not use it");
}
// also compare contentSha256 and contractSha256 with the values in your pin file
```

A shell check of the bundle hash alone: `sha256sum awcms-public-api.openapi.yaml` must print `contractSha256`.

The first hash proves the file was not altered in transit or on disk. The second proves the pack was derived from the contract you validate against. Neither proves the pack is the one you meant to pin: the SHA in your pin file does.

## Freshness rule (when to re-pin)

- Every change of the OpenAPI bundle makes the committed pack stale, and `api:fixtures:check` (in `bun run check`) is red until the pack is regenerated and committed **in the same pull request**. So on `main` the pack and the bundle always match, and `contractSha256` changes with every contract change.
- A consumer **must re-pin** when it needs an operation or a field that the pinned contract lacks, when it adopts a new `contractVersion`, or when `packVersion` changes. It **may** stay on an older SHA indefinitely: nothing expires.
- A consumer must not follow a branch. A pin is a SHA, moved by a reviewed change in the consumer repository, with the three values above updated together.
- The pack proves a body fits a schema, not that the schema is complete (known limit TV-2: a property renamed in a schema without `required` still validates). Do not read a green validation as a statement about behaviour.

## What the pack never contains

`bun run api:fixtures:check` fails the build when the committed pack, besides being stale, does not carry a verifiable manifest or contains: a secret-shaped value (JWT, PEM private key, AWS key id, `Bearer`/`Basic` value, DSN with credentials, GitHub or live payment key); personal data (an e-mail outside reserved domains, a 16-digit identifier of the NIK shape, an NPWP shape, an Indonesian mobile number); or a repository name outside the family (`ahliweb/awcms`, `ahliweb/awcms-astro`). Findings print a rule and a JSON path, never the value. These are heuristics against accidental paste, not a data-loss-prevention system; generated values are fixed placeholders by construction.
