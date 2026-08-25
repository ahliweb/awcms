---
"awcms": patch
---

fix(docs): the two generated inventory blocks are now generated in BOTH languages, and the mirror that said "do not hand-edit" had nothing generating it

Closes #727.

`scripts/README.md` and `docs/PROJECT_STATE.md` §2 each carry a generated block
with a gate. Their Indonesian mirrors carried **the same block, banner
included** — telling the reader not to hand-edit a block that nothing generated
— and both had drifted:

| Mirror | Claimed | Real |
| --- | --- | --- |
| `scripts/README.id.md` | 107 targets, 48 gated | 121, 54 |
| `docs/PROJECT_STATE.id.md` | ADR range ends `0111` | `0113` |
| | 48 admin screens, 61 `.astro`, 57 gates | 49, 62, 58 |
| | `MODULE_CONTRACT_VERSION` **4.0.0** | **4.1.0** |

That last row is the one worth pausing on: a *contract version*, stated wrong,
in a document whose whole job is to be the accurate continuation point.

## Why no gate could see it

Not oversight — a category error. `check:docs:translation` compares a **sha256
of the English source** against a marker stored in the mirror, which answers
*"has the English changed since this was translated?"*. That is exactly the
right question for prose: prose only goes stale when its source changes.

Derived content goes stale when the **repo** changes, with both files untouched.
No hash of either file can see that. And re-stamping after any unrelated English
edit silently re-blesses it — which is how this survived, and how I nearly
shipped it again: syncing the mirror by hand in #726 and re-stamping marked it
current while `PROJECT_STATE.id.md` was still wrong.

## The fix

Both generators now render **every locale from one collection pass**, so the two
documents can differ in wording and cannot differ in fact. A label table rather
than a second renderer, deliberately: two renderers can disagree, and the whole
defect being fixed is two copies disagreeing.

The translated surface is small — for `PROJECT_STATE` it is ten row labels,
three column headers, two prose strings and the one source-of-truth cell that is
prose rather than a bare command; everything else, including every value, is
shared.

`project-state:inventory:check` and `scripts:inventory:check` now verify every
locale and name the failing file:

```
docs/PROJECT_STATE.id.md: row "ADR" is stale — document: "**0000**–**0099** …", repo: "**0000**–**0113** …"
scripts/README.id.md: the rows match but the generated block does NOT — what is stale sits outside the table
```

Mutation-proven in both directions: corrupting a value in either mirror reddens
the corresponding gate, and making a renderer ignore its locale — emitting
English into the Indonesian file, the *new* way to be wrong that this design
introduces — reddens the test written for exactly that.

## What the audit found, which is bigger than this issue

#727's Definition of Done asked whether other mirrors have the same gap. They
do, and it is not limited to generated blocks. Verified by reading each gate:

- `checkAdrIndexCoverage` reads `docs/adr/README.md` only — the Indonesian ADR
  index can omit an ADR silently.
- `skills:check` globs `SKILL.md` and `src/modules/*/README.md` — **55
  `SKILL.id.md` and 21 module `README.id.md`** are checked by nothing, so a
  mirror can name a `bun run` target that does not exist.
- `graph:artifacts:check` hardcodes `docs/awcms/knowledge-graph.md`.
- `memory:docs:check` exists, is CI-safe by construction (exit 0 with no memory
  directory), and is **in neither `scripts.check` nor any workflow** — a gate
  that has never run. It fails today.

Filed separately rather than swept in here; this change closes the generated-block
half it was reported for.
