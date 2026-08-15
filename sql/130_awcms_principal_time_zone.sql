-- ADR-0095 — the interface speaks the reader's language, and now shows the
-- reader's clock.
--
-- `awcms_principal_preferences.time_zone` — the third per-human display
-- preference, alongside `locale` and `theme` (sql/128). It belongs here for the
-- same reason those two do: a person reads Jakarta time in every tenant they
-- belong to, and ADR-0088's tenant-selection screen renders before a tenant
-- exists.
--
-- ## What this replaces
--
-- `/admin/account` hard-coded `DISPLAY_TIME_ZONE = "UTC"` and said so in prose:
-- "this base has no per-user time zone, and guessing the server's would make a
-- session's 'last seen' wrong in a way nobody could detect". That was the right
-- call while the column did not exist — a wrong clock is worse than a foreign
-- one, because the reader believes it. The column is what lets the screen stop
-- apologising.
--
-- ## Why the CHECK is a SHAPE check and not a value list
--
-- `locale` and `theme` enumerate their values, and the sql/128 comment argues
-- that the CHECK is what makes "this column can only hold something the build
-- can render" true for writers that never pass through TypeScript.
--
-- That argument does not transfer, and pretending it does would be worse than
-- not trying. There are 445 IANA zones in this runtime; the list is tzdata's,
-- it changes several times a year, and a CHECK enumerating it would be wrong
-- within months — wrong in the direction that REFUSES a legitimate value, which
-- is the failure an operator cannot work around. Postgres knows the real list
-- (`pg_timezone_names`), but a CHECK constraint may not read a table.
--
-- So the constraint asserts only what is stable: a non-empty, plausibly-shaped
-- identifier. The authority on whether a zone can actually be RENDERED stays in
-- TypeScript, where `Intl.DateTimeFormat` answers it exactly, and the read path
-- coerces an unrenderable value back to UTC rather than throwing during SSR —
-- the same shape `coerceLocale` already uses for a locale list that shrank
-- under a stored value.
--
-- The honest summary: this CHECK stops nonsense, not every wrong value. Saying
-- that here is better than a constraint whose name implies a guarantee it
-- cannot make.

BEGIN;

ALTER TABLE awcms_principal_preferences
  -- NULL = "not chosen", consistent with `locale` and `theme`. It falls through
  -- to UTC, which is what the screen rendered before this column existed, so an
  -- account that never opens the control sees exactly what it saw yesterday.
  ADD COLUMN IF NOT EXISTS time_zone text;

-- `Area/Location`, `Area/Region/Location`, `UTC`, and the `Etc/GMT+7` family —
-- letters, digits, `/`, `_`, `+`, `-`. 64 characters is comfortably above the
-- longest real zone (`America/Argentina/ComodRivadavia`, 32).
ALTER TABLE awcms_principal_preferences
  DROP CONSTRAINT IF EXISTS awcms_principal_preferences_time_zone_check;

ALTER TABLE awcms_principal_preferences
  ADD CONSTRAINT awcms_principal_preferences_time_zone_check
    CHECK (
      time_zone IS NULL
      OR (
        length(time_zone) BETWEEN 1 AND 64
        AND time_zone ~ '^[A-Za-z0-9+_/-]+$'
      )
    );

COMMENT ON COLUMN awcms_principal_preferences.time_zone IS
  'ADR-0095 — IANA time zone this human reads timestamps in. NULL = not chosen, which renders UTC. The CHECK is a SHAPE check only: the renderable-zone authority is Intl in TypeScript, because the IANA list is tzdata''s and changes several times a year.';

-- No privilege change. sql/128 already granted SELECT/INSERT/UPDATE on this
-- table to `awcms_app` and withheld DELETE permanently; a new column inherits
-- both, and re-granting here would quietly widen the surface the moment the two
-- statements disagreed.

COMMIT;
