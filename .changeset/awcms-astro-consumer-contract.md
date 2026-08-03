---
"awcms": minor
---

Freeze and gate the API slice `ahliweb/awcms-astro` consumes (ADR-0065).

The existing frozen snapshot is the pre-#182-migration monolith, and every
surface that repo actually calls landed after it — `/auth/session` and
`/access/machine-credentials` (ADR-0049), `/media/objects` (#318),
`/media/public-origin` (#370), the `/blog/posts` cursor traversal (#317).
Searching the snapshot for them returns zero. So a response-shape change to any
of them was green here and broke the other repo's build: a failure surfacing
where whoever caused it is not looking.

`bun run api:consumer-contract:check` freezes 6 paths plus the 16 components
their `$ref`s reach. The closure is the point — freezing path objects alone
would be near-useless, since a path is a few lines of `$ref` and the interesting
breakages happen in the schema.

The rule is additive-superset: a new optional field passes, a rename or retype
fails. Regenerating is deliberate and means the consumer must change too, which
the fixture header and the failure message both say — whoever reads that message
is in the wrong repo to realise it unaided. A missing consumer path throws
rather than silently shrinking the contract.

This is a schema contract, not a behavioural one: a change of meaning with an
unchanged shape is not caught.

No migrations, no permissions, no runtime change.
