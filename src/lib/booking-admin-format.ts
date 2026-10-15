/**
 * The pure form <-> API mapping of the booking admin screens (Issue #942).
 *
 * ## The rule this file exists to hold
 *
 * The API stores and accepts WHOLE SECONDS; the forms show MINUTES. A screen
 * that shows `Math.round(seconds / 60)` and sends `minutes * 60` back on every
 * save silently rewrites what the operator did not touch: 90 s becomes 120 s, a
 * 330 s slot step becomes 360 s (which changes availability), a 20 s duration
 * shows "0" and can no longer be saved, and an unrelated policy edit rewrites the
 * hold, notice and grace values under a `critical` audit row.
 *
 * So a field carries two attributes from the server: `data-initial` (what the
 * form displayed) and `data-original` (the API value, JSON). {@link buildBody}
 * sends the ORIGINAL back for any field whose displayed text was not edited, and
 * converts only what the operator actually typed. A `PATCH` sends only the
 * changed fields; a `PUT` (which replaces the whole policy) sends every field,
 * unedited ones byte-identical to what was read.
 *
 * A value that is not a whole minute is displayed as decimal minutes (90 s is
 * "1.5") and the screen prints the exact seconds beside it; the display is never
 * the stored value.
 */

/** Seconds as the minutes text a form shows: whole minutes plainly, otherwise up to two decimals. */
export function minutesDisplay(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";

  if (seconds % 60 === 0) return String(seconds / 60);

  return String(Math.round((seconds / 60) * 100) / 100);
}

/** True when the stored seconds cannot be shown exactly as minutes text, so the exact value must be printed. */
export function isInexactMinutes(seconds: number | null | undefined): boolean {
  return (
    seconds !== null &&
    seconds !== undefined &&
    minutesDisplay(seconds) !== String(seconds / 60)
  );
}

/** Minutes text typed by the operator -> whole seconds; blank is `null`; not a number is `NaN` (the server refuses it). */
export function minutesToSeconds(raw: string): number | null {
  const trimmed = raw.trim();

  if (trimmed === "") return null;

  const minutes = Number(trimmed);

  return Number.isFinite(minutes) ? Math.round(minutes * 60) : Number.NaN;
}

/** A whole number from text; blank is `null`; not a whole number is `NaN`. */
export function countOrNull(raw: string): number | null {
  const trimmed = raw.trim();

  if (trimmed === "") return null;

  const value = Number(trimmed);

  return Number.isInteger(value) ? value : Number.NaN;
}

export function textOrNull(raw: string): string | null {
  const trimmed = raw.trim();

  return trimmed === "" ? null : trimmed;
}

/** `HH:MM` or `HH:MM:SS` -> `HH:MM:SS`; blank is `null`. */
export function localTimeOrNull(raw: string): string | null {
  const trimmed = raw.trim();

  if (trimmed === "") return null;

  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

export type FieldSpec = {
  /** The API body key. */
  key: string;
  /** What the control holds now. */
  raw: string;
  /** What the control displayed when the page was rendered. */
  initial: string;
  /** The API value that was read (what `initial` was rendered from). */
  original: unknown;
  /** Text -> API value, used only for a field the operator edited. */
  convert: (raw: string) => unknown;
};

/**
 * The request body: an edited field is converted from its text, an unedited one
 * keeps the ORIGINAL API value. With `onlyChanged`, unedited fields are left out
 * (a `PATCH`); without it every field is present (a `PUT`).
 */
export function buildBody(
  fields: readonly FieldSpec[],
  options: { onlyChanged: boolean }
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  for (const field of fields) {
    const edited = field.raw !== field.initial;

    if (!edited) {
      if (!options.onlyChanged) body[field.key] = field.original;
      continue;
    }

    body[field.key] = field.convert(field.raw);
  }

  return body;
}
