---
"awcms": patch
---

fix(i18n): the screens ledger reaches ZERO — and the two gates measuring it were each blind to a class

`SCREENS_AWAITING_TRANSLATION` goes **18 → 0**: all 43 admin screens render their
template text through `t()`. That closes PROJECT_STATE §4's next step 2.

The 23 ledgered literals were the split-sentence class the bulk migration could
not mechanise — a sentence broken in the middle by an interpolated value or a
`<code>`/`<strong>`. They are merged into whole msgids with placeholders. Two
costs are recorded because the next merge pays them again:

- `t()` returns a STRING, so the `<code>` around a placeholder is lost. A real
  `<a>` keeps its own label instead — a link is a control, not a phrase.
- Where the value is OPTIONAL, one `{code}` msgid renders "platform tenant ()".
  That shape needs TWO whole msgids, one per branch.

## The screens gate could not see a third of the work

Its scanner reads template text only where it follows a TAG. Text after an
EXPRESSION is invisible:

    <caption>{roles.length} role(s)</caption>

Nineteen such strings were found BY HAND, across 15 screens the gate already
called finished — table captions, `{n} per page`, `{label} media id`,
`No {status} comments.` Every one was rendering English to an Indonesian reader
while the ledger said the screen was done.

They are fixed. The `{n} thing(s)` captions became real `tn()` plurals rather
than a placeholder patch, which is the first time the plural path has been
exercised through the `.po` round-trip: verified end to end, `1 role` / `5 roles`
in English and `1 peran` / `5 peran` in Indonesian, where `nplurals=1` means one
form serves both.

The SCANNER still cannot see the class, and that is deliberate for now: making
`afterTag` survive a closing `}` would start capturing template literals and
chained ternaries as prose — the false-positive failure `CODE_SHAPED` exists to
hold back. That widening deserves its own change and its own mutation test
rather than riding along with a ledger being emptied. The limitation is written
into the gate's header, so an empty ledger is not read as more than it means.

`CODE_SHAPED` did gain `===`/`!==`, for a narrower reason: a chained ternary
between two elements (`) : token.kind === "number" ? (`) was the single thing
standing between `theming.astro` and a finished ledger. The under-count argument
that makes the heuristic conservative only holds while a screen is ON the
ledger; a screen that cannot be finished is where it stops being conservative.

## The catalogue gate was blind to 86 msgids

Its literal harvester excluded any string containing a backslash — stated as
conservative, and it was not. **Prettier rewrites an em dash inside a `t()`
literal as `—`**, and this admin's prose is full of em dashes, so the
longest and most prose-like msgids were never REQUIRED to exist in `locales/`.

The consequence is silent and one-directional: an unharvested msgid is never
demanded, never added, and `createTranslator` falls back to it — correct
English, forever, in every locale, with both ledgers reading 0.

It had already happened. `users.astro` calls `t()` on a sentence declared in
NEITHER catalogue; it has been rendering English to Indonesian readers, and
nothing could report it. The harvester now decodes escapes (`\uXXXX`, `\n`,
`\t`, `\r`, quotes, backslash) and still skips a literal carrying an unknown
escape, for the same reason the `.po` parser rejects one.

Proven by mutation, not by observation: deleting one escaped msgid from `en.po`
is reported by the fixed harvester and passes **silently** under the old
pattern. The decoder is NOT the same as `decodeEscapes` in `po.ts` and must not
be — the two formats escape differently (a `.po` stores a real em dash and
rejects `\u` outright); what has to agree is the decoded text, not the syntax.

23 msgids orphaned by the merges are removed from both catalogues.
