---
"awcms": minor
---

feat(identity-access): per-user time zone — `/admin/account` stops apologising for UTC

PROJECT_STATE §4's i18n next step 4. `awcms_principal_preferences` gains
`time_zone` (sql/130), joining `locale` and `theme` as the third per-human
display preference, and `/admin/account` renders every timestamp in it.

The screen previously hard-coded `DISPLAY_TIME_ZONE = "UTC"` with a comment
explaining why: *"this base has no per-user time zone, and guessing the server's
would make a session's 'last seen' wrong in a way nobody could detect — the
reader would simply believe it."* That reasoning still holds, and is exactly why
the fallback stays UTC rather than the host's zone. What changed is that there
is now a stated preference to read instead of a guess to make.

## The CHECK is a shape check, and says so

`locale` and `theme` enumerate their values, and sql/128 argues the CHECK is
what makes "this column can only hold something the build can render" true for
writers that never pass through TypeScript.

**That argument does not transfer, and pretending it did would be worse than not
trying.** There are 445 IANA zones in this runtime; the list is tzdata's, it
changes several times a year, and an enumerating CHECK would be wrong within
months — wrong in the direction that REFUSES a legitimate value, which is the
failure an operator cannot work around. Postgres knows the real list
(`pg_timezone_names`) but a CHECK may not read a table.

So sql/130 asserts only what is stable — non-empty, plausibly shaped, ≤64 chars
— and the migration states plainly that it stops nonsense, not every wrong
value. The authority on renderability is `Intl.DateTimeFormat`, which throws
`RangeError` on an unknown zone and therefore answers exactly the right
question.

## The degradation is the part worth testing

`formatDateTime` throws on an unresolvable zone. A zone stored under an older
tzdata and dropped by a newer one would take down the account screen — the page
somebody opens when they think their password leaked, which is when a stack
trace is most expensive.

`readPreferences` therefore coerces on the way OUT, the same shape `coerceLocale`
already uses for a locale list that shrank under a stored value. The tests pin
that rather than the happy path, and include the assertion that an uncoerced
zone really does throw — so if that ever stops being true, the comment
justifying the coercion is caught being wrong.

## The picker is server-rendered, from `Intl`

The `<select>` is built from `Intl.supportedValuesOf("timeZone")` on the SERVER,
so the values offered are exactly the values `coerceTimeZone` will accept back.
A list from anywhere else could offer a zone this deployment cannot resolve, and
the save would fail with the reader looking at a value the page itself
suggested. It is ~445 options of SSR HTML on one admin page — no client asset,
so the budget `bun run build` enforces is untouched.

"Use this device's time zone" SELECTS but does not save: the browser's zone is a
guess from the operating system, and a guess that silently persists is the class
of defect the hard-coded UTC existed to avoid. If the detected zone is not among
the options — a browser whose tzdata is ahead of the server's — the control says
so rather than leaving itself silently unchanged.

`POST /api/v1/auth/preferences` accepts `timeZone` (absent = leave alone, null =
reset, unrenderable = `UNSUPPORTED_TIME_ZONE`), carried forward in the same
read-then-write transaction as the other two axes so a request mentioning one
cannot wipe another.
