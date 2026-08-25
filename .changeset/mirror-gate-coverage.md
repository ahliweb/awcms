---
"awcms": patch
---

fix(docs): three gates read only the English half, and one gate had no caller at all

Closes #729. The follow-up to #728, which fixed the two generated blocks; this
is the rest of the class the audit found, and the class was never "generated
blocks" — it was **every gate that reads the English file and stops**.

## 76 mirror files that make claims about code

`skills:check` exists because a wrong skill is worse than a stale doc: an agent
**follows** a skill. It globbed `SKILL.md` and `src/modules/*/README.md`, so all
55 `SKILL.id.md` and 21 module `README.id.md` could name a `bun run` target that
does not exist, or a path that was renamed, with every gate green.

Both corpora are widened. Mutation-proven with three real corruptions, each
naming the exact mirror:

```
awcms-testing (SKILL.id.md) tells the reader to run `bun run this:target:does:not:exist`, which is not in package.json…
awcms-testing (SKILL.id.md) cites 1 path(s) that do not exist (e.g. `src/modules/this-module-does-not-exist/README.md`)…
src/modules/blog-content/README.id.md names admin screens that do not exist: /admin/this-screen-does-not-exist
```

**The first draft of this broke the English files**, and the reason is worth
keeping. `checkCitedPaths` used its first argument as both the report label
**and** the key for `ASPIRATIONAL_SKILLS` / `subjectModuleKey`. Passing a
decorated label defeated both exemptions and turned a green gate into 19 false
failures on files that were fine. Identity and label are now separate
parameters, and a test asserts the exemption still holds when a label is
supplied.

## The ADR index mirror was missing an ADR

`checkAdrIndexCoverage` read `docs/adr/README.md` only. `check-docs.mjs` even
explained why — *"Its Indonesian mirror is held to it by `i18n-source-hash`, not
by a second copy of this gate"* — but that hash answers *"has the English
changed since translation?"*, not *"does the mirror list every ADR?"*.

`docs/adr/README.id.md` was missing **ADR-0100** entirely: 113 rows in English,
112 in the mirror. Added, and the gate now reads both.

**Coverage is asserted; linking is not.** The mirror links the English file for
98 of its rows and the `.id.md` copy for the rest, even though a mirror exists
for all of them. Demanding one form would turn a real coverage gate into a
98-row reformatting demand, and that noise is how a gate gets switched off. So
the mirror may link either copy and may not omit an ADR — while the English
index must still link English, or a row could quietly point at the translation
and pass.

## A gate with no caller

`memory:docs:check` is not a gate with a blind spot. It had **no caller at
all**: the target existed, and it was in neither `scripts.check` nor any
workflow, so it had never run once. It was failing —
`docs/awcms/agent-memory.md` had drifted from the 116 active memory files.

Its own header documents that `--check` exits 0 when the memory directory is
absent, *"so this gate catches drift on a device that has memory rather than
forcing CI to have one"* — a design note that only makes sense for something
meant to be wired in. Now it is, and both halves are verified: corrupting the
snapshot exits 1, and running with an empty `HOME` prints
*"Tidak ada direktori memory — check dilewati"* and exits 0.

The chain is 58 gates → **59**.

## Deliberately not done

`docs/awcms/knowledge-graph.id.md` is still uncovered
(`graph:artifacts:check` hardcodes the English path). It is hand-written prose
about a generated artefact — the least dangerous of the set, and covering it
needs its own design rather than a fourth path added here.
