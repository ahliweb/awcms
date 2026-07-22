/**
 * Automatic internal tag linking (Issue #641, epic `news_portal` — the
 * feature lives in `blog_content` since it must be generic for every
 * `blog_content` consumer, not just full-online news portals; see
 * `.claude/skills/awcms-news-portal/SKILL.md` §641).
 *
 * ## Security — why this is HTML-tree parsing, not string regex
 *
 * The issue's own Security notes are explicit: "Never use naive string
 * replacement on raw HTML without parsing/sanitization — the render step
 * must parse the HTML tree... and skip node types that are anchors/
 * scripts/code/embeds, not just regex over the string." This module
 * follows that literally: `applyInternalTagLinksToHtml` below uses Bun's
 * built-in `HTMLRewriter` (a real streaming HTML parser, the same engine
 * Cloudflare Workers expose under the identical name — Bun implements it
 * natively, no external dependency, consistent with the Bun-only rule) to
 * walk the actual element tree. A running `skipDepth` counter, incremented
 * on entering any element in `DEFAULT_SKIP_TAGS` (+ headings when
 * `excludeHeadings` is on) and decremented on that SAME element's own end
 * tag (`el.onEndTag`), means text encountered while `skipDepth > 0` is
 * left completely untouched — never even inspected — regardless of how
 * deeply nested inside other skip tags it is. A regular expression is
 * still used, but ONLY on plain text content the parser has already
 * isolated as belonging to a safe, non-excluded text node — never on the
 * raw HTML string, and never anywhere that could match across tag
 * boundaries or reinterpret markup. This is the same "regex is fine
 * *after* structural parsing has drawn the safe boundary, not as a
 * substitute for it" principle `content-block-rendering.ts`'s whitelist
 * renderer already applies to `content_json` blocks.
 *
 * `content_json` itself is already rendered through the existing
 * whitelist renderer (`renderContentJsonToHtml`) before this module ever
 * sees it — this module never opens a new raw-HTML escape hatch, it only
 * post-processes renderer OUTPUT that is, by construction, already fully
 * escaped text plus a small whitelist of safe tags (see that file's own
 * header).
 *
 * ## Text handling — matching against already-escaped text, never decoding
 *
 * `HTMLRewriter`'s `text()` callback hands back the SOURCE-level text of a
 * text node — i.e. already HTML-entity-encoded (`&` stays `&amp;`, etc.),
 * not decoded. Rather than decoding it (which would require re-encoding
 * correctly before re-emitting, a classic source of double-escaping/
 * mis-escaping bugs — see the `mdEscape` lesson repeated across this
 * repo's history), every candidate tag NAME is instead run through the
 * exact same `escapeHtml` the renderer used, so matching happens entirely
 * within the escaped-text domain. A tag literally named `Q&A` is matched
 * against the source text's `Q&amp;A` — verified in this module's test
 * suite. The un-decoded matched substring is reused verbatim as the
 * anchor's inner text, so the emitted markup is always well-formed.
 */
import { escapeHtml } from "../../../lib/html/escape";

export type InternalTagLinkCandidate = {
  tagId: string;
  /** Tag name/term to match — matched literally (optionally case-insensitively per policy), never a regex/glob from caller input. */
  name: string;
  /** Canonical tag archive URL, precomputed by the caller (tenant + basePath aware) — this module never constructs a URL itself. Always same-origin/internal by construction of every caller. */
  url: string;
};

export type InternalTagLinkingPolicy = {
  /** Final resolved enabled flag (env kill switch AND tenant override AND per-post override already applied by the caller) — `applyInternalTagLinksToHtml` trusts this as-is and does no further gating. */
  enabled: boolean;
  maxPerPost: number;
  maxPerTag: number;
  minTermLength: number;
  linkFirstOccurrenceOnly: boolean;
  excludeHeadings: boolean;
  caseInsensitive: boolean;
};

export type InternalTagLinkMatch = {
  tagId: string;
  tagName: string;
  url: string;
  /** The exact (still HTML-escaped) substring that was linked — may differ in case from `tagName` when `caseInsensitive` is on. */
  matchedText: string;
};

export type InternalTagLinkingResult = {
  html: string;
  matches: InternalTagLinkMatch[];
};

const EMPTY_RESULT_MATCHES: InternalTagLinkMatch[] = [];

/**
 * Element types whose text content must never receive an automatic link,
 * regardless of `excludeHeadings` — existing links (never link inside a
 * link), script/style/code/pre-formatted/embedded content, and figure
 * captions (Issue #639/#542's `<figcaption>` — auto-linking a photo/video
 * caption reads as noise, not an editorial choice). `iframe`/`object`/
 * `embed`/`video`/`audio` have no meaningful inspectable text content
 * anyway (this repo's own renderers never put text inside them) but are
 * listed for defense-in-depth against a future block type that might.
 */
const DEFAULT_SKIP_TAGS: readonly string[] = [
  "a",
  "script",
  "style",
  "code",
  "pre",
  "kbd",
  "samp",
  "textarea",
  "noscript",
  "figcaption",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "template",
  "math",
  "svg"
];

const HEADING_TAGS: readonly string[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The term as it would appear inside already-`escapeHtml`-processed text —
 * matching happens in that domain (see file header), never against the
 * raw/decoded term.
 */
function buildTermPattern(name: string): string {
  return escapeRegExp(escapeHtml(name));
}

type PreparedCandidate = InternalTagLinkCandidate & { escapedName: string };

/**
 * Filters candidates below `minTermLength` (using the RAW name length —
 * a short tag name is noisy/ambiguous regardless of how it happens to
 * escape), sorts longest-escaped-pattern-first (so a combined alternation
 * regex prefers "Jakarta Selatan" over "Jakarta" at the same text
 * position — JS regex alternation picks the FIRST alternative that
 * matches, not the longest overall, so ordering is what makes "longest
 * match wins" true here), and de-duplicates by matching key (case rules
 * per `policy.caseInsensitive`), keeping the first (i.e. longest, then
 * alphabetically first) survivor on a collision.
 */
function prepareCandidates(
  candidates: readonly InternalTagLinkCandidate[],
  policy: InternalTagLinkingPolicy
): PreparedCandidate[] {
  const filtered = candidates.filter(
    (candidate) => candidate.name.trim().length >= policy.minTermLength
  );

  const sorted = [...filtered].sort((a, b) => {
    const lengthDiff = escapeHtml(b.name).length - escapeHtml(a.name).length;
    return lengthDiff !== 0 ? lengthDiff : a.name.localeCompare(b.name);
  });

  const seenKeys = new Set<string>();
  const prepared: PreparedCandidate[] = [];

  for (const candidate of sorted) {
    const escapedName = escapeHtml(candidate.name);
    const key = policy.caseInsensitive
      ? escapedName.toLowerCase()
      : escapedName;

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    prepared.push({ ...candidate, escapedName });
  }

  return prepared;
}

export type InternalTagLinkEngine = {
  /** Applies linking to one text-node buffer (already HTML-escaped source text), respecting running per-tag/per-post caps across the whole document. Returns the (possibly unchanged) HTML to emit in place of that text node. */
  linkifyChunk(rawEscapedText: string): string;
  getMatches(): InternalTagLinkMatch[];
};

/**
 * Builds a stateful engine (per-tag + total link counters persist across
 * calls, so callers processing a document's text nodes in order get
 * correct "first N occurrences across the whole post" behavior) or `null`
 * when there is nothing to match (no eligible candidates after filtering,
 * or `policy.enabled` is `false`).
 */
export function createInternalTagLinkEngine(
  candidates: readonly InternalTagLinkCandidate[],
  policy: InternalTagLinkingPolicy
): InternalTagLinkEngine | null {
  if (!policy.enabled) {
    return null;
  }

  const prepared = prepareCandidates(candidates, policy);

  if (prepared.length === 0) {
    return null;
  }

  const alternation = prepared
    .map((candidate) => buildTermPattern(candidate.name))
    .join("|");
  const flags = `gu${policy.caseInsensitive ? "i" : ""}`;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`,
    flags
  );

  const byKey = new Map<string, PreparedCandidate>();
  for (const candidate of prepared) {
    const key = policy.caseInsensitive
      ? candidate.escapedName.toLowerCase()
      : candidate.escapedName;
    byKey.set(key, candidate);
  }

  const perTagCount = new Map<string, number>();
  let totalCount = 0;
  const matches: InternalTagLinkMatch[] = [];
  const effectiveMaxPerTag = policy.linkFirstOccurrenceOnly
    ? 1
    : Math.max(1, policy.maxPerTag);

  function linkifyChunk(rawEscapedText: string): string {
    if (totalCount >= policy.maxPerPost) {
      return rawEscapedText;
    }

    return rawEscapedText.replace(pattern, (matched) => {
      if (totalCount >= policy.maxPerPost) {
        return matched;
      }

      const key = policy.caseInsensitive ? matched.toLowerCase() : matched;
      const candidate = byKey.get(key);

      if (!candidate) {
        return matched;
      }

      const currentTagCount = perTagCount.get(candidate.tagId) ?? 0;

      if (currentTagCount >= effectiveMaxPerTag) {
        return matched;
      }

      perTagCount.set(candidate.tagId, currentTagCount + 1);
      totalCount += 1;
      matches.push({
        tagId: candidate.tagId,
        tagName: candidate.name,
        url: candidate.url,
        matchedText: matched
      });

      // `matched` is already HTML-escaped source text (a substring of the
      // already-escaped buffer) — safe to embed verbatim as the anchor's
      // inner text. `candidate.url`/`candidate.tagId` are always
      // caller-constructed (never client input) but are still escaped
      // here as defense-in-depth.
      return `<a href="${escapeHtml(candidate.url)}" class="auto-internal-link" data-tag-id="${escapeHtml(candidate.tagId)}" rel="tag">${matched}</a>`;
    });
  }

  return {
    linkifyChunk,
    getMatches: () => matches
  };
}

/**
 * Renders `html` (already-safe output from `renderContentJsonToHtml` or
 * equivalent) with automatic internal tag links applied, using Bun's
 * `HTMLRewriter` to walk the real element tree — see file header for the
 * full security reasoning. Never mutates the caller's original stored
 * content; this is a pure render-time transform of a derived HTML string
 * (Issue #641's own "Rendering policy": "Prefer non-destructive render-time
 * linking... Do not mutate the original author-authored content body").
 *
 * Returns `{ html, matches: [] }` unchanged (no `HTMLRewriter` pass at all)
 * when disabled or there are no eligible candidates — cheap no-op for the
 * overwhelming majority of tenants/posts that never touch this feature.
 */
export async function applyInternalTagLinksToHtml(
  html: string,
  candidates: readonly InternalTagLinkCandidate[],
  policy: InternalTagLinkingPolicy
): Promise<InternalTagLinkingResult> {
  const engine = createInternalTagLinkEngine(candidates, policy);

  if (engine === null) {
    return { html, matches: EMPTY_RESULT_MATCHES };
  }

  const skipTags = policy.excludeHeadings
    ? [...DEFAULT_SKIP_TAGS, ...HEADING_TAGS]
    : DEFAULT_SKIP_TAGS;

  let skipDepth = 0;
  const rewriter = new HTMLRewriter();

  for (const tag of skipTags) {
    rewriter.on(tag, {
      element(element) {
        skipDepth += 1;
        element.onEndTag(() => {
          skipDepth = Math.max(0, skipDepth - 1);
        });
      }
    });
  }

  let buffer = "";

  rewriter.on("*", {
    text(chunk) {
      if (skipDepth > 0) {
        // Inside an excluded ancestor — leave the chunk exactly as
        // streamed through, never inspected/matched.
        return;
      }

      buffer += chunk.text;

      if (chunk.lastInTextNode) {
        const linked = engine.linkifyChunk(buffer);
        buffer = "";
        chunk.replace(linked, { html: true });
      } else {
        // Accumulate — the real text node may span multiple chunks;
        // matching runs once on the full buffer at `lastInTextNode` so a
        // term can never be missed/mismatched at a chunk boundary.
        chunk.remove();
      }
    }
  });

  const response = rewriter.transform(
    new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  );

  const outputHtml = await response.text();

  return { html: outputHtml, matches: engine.getMatches() };
}
