/**
 * The one shape every dependency-governance gate reports problems in
 * (Issue #1173), and the fingerprint that makes "one open issue per finding"
 * possible.
 *
 * A finding is a STABLE identity (`key`) plus prose. The key never contains a
 * number that changes between runs (a day count, a drift distance, a registry
 * digest): two runs that describe the same problem must produce the same key,
 * otherwise the scheduled workflow opens a new issue every Monday for the same
 * gap. The prose (`detail`) may change freely; it is not part of the identity.
 */
import { createHash } from "node:crypto";

export type Finding = {
  /** Stable identity, e.g. `license:@img/sharp-libvips-linux-x64`. */
  key: string;
  /** One line, used as the issue title (after a fixed prefix). */
  title: string;
  /** Markdown body: what was found and what to do. */
  detail: string;
};

export type FindingFile = {
  /** Which gate wrote it, for the issue body. */
  source: string;
  findings: Finding[];
};

const MARKER_PREFIX = "deps-finding:";

export function findingFingerprint(key: string): string {
  return createHash("sha256")
    .update(key.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/** The hidden marker an issue body carries so the next run can find it. */
export function findingMarker(key: string): string {
  return `<!-- ${MARKER_PREFIX}${findingFingerprint(key)} -->`;
}

/**
 * The marker is the FIRST LINE of the body and nothing else on it. Issue
 * bodies are partly third-party text (a dependency's `license` field, an
 * advisory title): matching a marker anywhere would let that text carry
 * another finding's marker and keep it from ever being filed again.
 */
const MARKER_LINE = new RegExp(`^<!-- ${MARKER_PREFIX}([0-9a-f]{16}) -->\\s*$`);

export function markersIn(body: string): Set<string> {
  const match = MARKER_LINE.exec(body.split("\n", 1)[0] ?? "");

  return new Set(match ? [match[1] as string] : []);
}

/**
 * Makes text that came from outside the repository safe to put in a public
 * issue: it cannot open or close an HTML comment (the marker's own syntax) and
 * it cannot @mention an account. Text inside a backtick code span keeps its
 * `@`, which GitHub does not turn into a mention there.
 */
export function neutralizeUntrusted(text: string): string {
  return text
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .split(/(`[^`\n]*`)/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/@/g, "@\u200b")
    )
    .join("");
}
