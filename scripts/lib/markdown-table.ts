/**
 * The generated-block plumbing that `repo-inventory.ts` and
 * `project-state-inventory.ts` share (finding D14).
 *
 * ## Why this exists
 *
 * Both scripts render a markdown table between two HTML comment markers, and
 * both `--check` variants parse that block back to compare it against a fresh
 * render. `extractBlock` and `replaceBlock` were byte-identical copies apart
 * from the marker strings and the path named in the error message.
 * `parseInventoryRows` was NOT identical, and that is the interesting half:
 *
 *   - `project-state-inventory.ts` splits on `(?<!\\)\|` and strips `\|`
 *     escapes, because one of its cells contains a real shell pipeline;
 *   - `repo-inventory.ts` split on a bare `|`, so the same cell would have been
 *     torn in two.
 *
 * Only one copy learned about escapes, which is the ordinary way a fix lands in
 * one of three places. The escape-aware version is the one kept here: it is a
 * strict superset — a block with no escaped pipes parses identically either
 * way — so the stricter parser costs the other caller nothing and removes the
 * chance that its next cell containing a `|` silently splits.
 */

/** One entry per row, cell contents only; padding and alignment discarded. */
export function parseInventoryRows(block: string): string[][] {
  return (
    block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"))
      // Alignment rows (`|---|:--|`) are structure, not data. `:` is included so
      // an alignment marker never arrives as a one-cell row.
      .filter((line) => !/^\|[\s\-:|]+\|$/.test(line))
      .map((line) =>
        line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          // A `\|` inside a cell is a literal pipe the author escaped, not a
          // column boundary — `project-state-inventory`'s changeset command cell
          // is a real shell pipeline and would otherwise split.
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim())
      )
  );
}

export type GeneratedBlockMarkers = {
  begin: string;
  end: string;
  /** Named in the error when the markers are missing, so it can be found. */
  docPath: string;
};

/** The text between the markers, or `null` when they are absent or crossed. */
export function extractBlock(
  markdown: string,
  markers: GeneratedBlockMarkers
): string | null {
  const start = markdown.indexOf(markers.begin);
  const end = markdown.indexOf(markers.end);

  if (start === -1 || end === -1 || end < start) return null;

  return markdown.slice(start + markers.begin.length, end).trim();
}

/**
 * Replace the text between the markers with `block`.
 *
 * Throws rather than appending when the markers are missing: a generated block
 * with no home is a document that silently stops being generated, and the
 * `--check` variant would then compare a fresh render against nothing.
 */
export function replaceBlock(
  markdown: string,
  block: string,
  markers: GeneratedBlockMarkers
): string {
  const start = markdown.indexOf(markers.begin);
  const end = markdown.indexOf(markers.end);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `${markers.docPath} is missing the "${markers.begin}" / "${markers.end}" markers — the generated block has no home.`
    );
  }

  return (
    markdown.slice(0, start + markers.begin.length) +
    "\n\n" +
    block +
    "\n\n" +
    markdown.slice(end)
  );
}
