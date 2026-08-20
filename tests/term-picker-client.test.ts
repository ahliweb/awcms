/**
 * The term picker's data half (Issue #595).
 *
 * `fetch` is injected, so these are plain unit tests. What they pin is the
 * distinction `sql/131` was written to create — four vocabularies, not one
 * string — and the two ways a picker lies: an empty list that is really a
 * permission refusal, and a group that vanishes instead of reading as empty.
 */
import { describe, expect, test } from "bun:test";

import {
  fetchPickableInstitutions,
  fetchPickableTerms,
  groupTerms,
  INSTITUTION_LIST_URL,
  TERM_LIST_URL,
  type PickableTerm
} from "../src/lib/ui/term-picker-client";
import { TAXONOMY_TYPES } from "../src/modules/blog-content/domain/taxonomy-policy";

function termsResponse(terms: unknown[]): Response {
  return new Response(JSON.stringify({ success: true, data: { terms } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

const CHANNEL: PickableTerm = {
  id: "c1",
  name: "Olahraga",
  slug: "olahraga",
  taxonomyType: "channel"
};

const TOPIC: PickableTerm = {
  id: "t1",
  name: "APBD",
  slug: "apbd",
  taxonomyType: "topic"
};

describe("fetchPickableTerms", () => {
  test("reads the guarded terms endpoint", async () => {
    let requested = "";
    await fetchPickableTerms((async (url: string) => {
      requested = String(url);
      return termsResponse([]);
    }) as unknown as typeof fetch);

    expect(requested).toBe(TERM_LIST_URL);
  });

  test("a 403 is FORBIDDEN, not an empty vocabulary", async () => {
    // Rendering "no channels" to someone who simply lacks
    // `blog_content.taxonomies.read` sends them to go define channels that
    // already exist.
    const result = await fetchPickableTerms(
      (async () =>
        new Response("{}", { status: 403 })) as unknown as typeof fetch
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  test("a network failure is unavailable", async () => {
    const result = await fetchPickableTerms((async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  test("a body that is not the documented shape is unavailable", async () => {
    for (const body of [
      { success: false },
      { success: true },
      { success: true, data: {} },
      { success: true, data: { terms: "nope" } }
    ]) {
      const result = await fetchPickableTerms(
        (async () =>
          new Response(JSON.stringify(body), {
            status: 200
          })) as unknown as typeof fetch
      );

      expect(result.ok).toBe(false);
    }
  });

  test("splits terms into their vocabularies", async () => {
    const result = await fetchPickableTerms((async () =>
      termsResponse([CHANNEL, TOPIC])) as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const channel = result.groups.find((g) => g.taxonomyType === "channel");
    const topic = result.groups.find((g) => g.taxonomyType === "topic");

    expect(channel?.terms).toEqual([CHANNEL]);
    expect(topic?.terms).toEqual([TOPIC]);
  });

  test("drops a term whose vocabulary this build does not know", async () => {
    // A fifth type added server-side must not render under an unlabelled
    // heading — the same failure `CONTENT_BLOCK_TYPES` exists to prevent.
    const result = await fetchPickableTerms((async () =>
      termsResponse([
        CHANNEL,
        { ...CHANNEL, id: "x", taxonomyType: "sponsorship" }
      ])) as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groups.flatMap((g) => g.terms)).toEqual([CHANNEL]);
    }
  });

  test("drops a malformed term rather than rendering a blank choice", async () => {
    const result = await fetchPickableTerms((async () =>
      termsResponse([
        CHANNEL,
        { ...CHANNEL, id: "" },
        { taxonomyType: "channel" },
        {}
      ])) as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groups.flatMap((g) => g.terms)).toEqual([CHANNEL]);
    }
  });
});

describe("groupTerms", () => {
  test("returns EVERY vocabulary, including the empty ones", () => {
    // An absent group reads as "this build has no channel picker", which is a
    // different and wrong conclusion from "no channels defined yet".
    const groups = groupTerms([TOPIC]);

    expect(groups.map((g) => g.taxonomyType)).toEqual([...TAXONOMY_TYPES]);
    expect(groups.find((g) => g.taxonomyType === "channel")?.terms).toEqual([]);
  });

  test("keeps the vocabularies in TAXONOMY_TYPES order, not arrival order", () => {
    const groups = groupTerms([TOPIC, CHANNEL]);

    expect(groups.map((g) => g.taxonomyType)).toEqual([...TAXONOMY_TYPES]);
  });

  test("sorts terms by name so a long vocabulary stays findable", () => {
    const groups = groupTerms([
      { ...CHANNEL, id: "b", name: "Politik" },
      { ...CHANNEL, id: "a", name: "Ekonomi" }
    ]);

    expect(
      groups.find((g) => g.taxonomyType === "channel")?.terms.map((t) => t.name)
    ).toEqual(["Ekonomi", "Politik"]);
  });

  test("nulls are filtered, not counted", () => {
    expect(groupTerms([null, CHANNEL, null]).flatMap((g) => g.terms)).toEqual([
      CHANNEL
    ]);
  });
});

/**
 * Institutions (Issue #595) — the fourth classification dimension.
 *
 * A separate surface from terms on purpose: `sql/131` made institution a TABLE
 * rather than a taxonomy type, and it is guarded by
 * `blog_content.institutions.read` rather than `taxonomies.read`. An editor can
 * hold one permission and not the other, which is why the two fetches — and
 * the two failure states — stay independent.
 */
describe("fetchPickableInstitutions", () => {
  const INSTITUTION = {
    id: "i1",
    name: "DPRD Kotawaringin Barat",
    slug: "dprd-kobar"
  };

  function institutionsResponse(institutions: unknown[]): Response {
    return new Response(
      JSON.stringify({ success: true, data: { institutions } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  test("reads its OWN endpoint, not the terms one", async () => {
    // Folding these into one request would make a single refusal blank both
    // halves of the form, when the two permissions are genuinely separate.
    expect(INSTITUTION_LIST_URL).not.toBe(TERM_LIST_URL);

    let requested = "";
    await fetchPickableInstitutions((async (url: string) => {
      requested = String(url);
      return institutionsResponse([]);
    }) as unknown as typeof fetch);

    expect(requested).toBe(INSTITUTION_LIST_URL);
  });

  test("a 403 is FORBIDDEN, not an empty roster", async () => {
    const result = await fetchPickableInstitutions(
      (async () =>
        new Response("{}", { status: 403 })) as unknown as typeof fetch
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  test("a network failure is unavailable", async () => {
    const result = await fetchPickableInstitutions((async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  test("an undocumented body shape is unavailable", async () => {
    for (const body of [
      { success: false },
      { success: true, data: {} },
      { success: true, data: { institutions: 3 } }
    ]) {
      const result = await fetchPickableInstitutions(
        (async () =>
          new Response(JSON.stringify(body), {
            status: 200
          })) as unknown as typeof fetch
      );

      expect(result.ok).toBe(false);
    }
  });

  test("drops a malformed row rather than rendering a blank choice", async () => {
    const result = await fetchPickableInstitutions((async () =>
      institutionsResponse([
        INSTITUTION,
        { ...INSTITUTION, id: "" },
        { name: "no id" },
        {}
      ])) as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.institutions).toEqual([INSTITUTION]);
  });

  test("sorts by name so a long roster stays findable", async () => {
    const result = await fetchPickableInstitutions((async () =>
      institutionsResponse([
        { id: "b", name: "Pemkab Seruyan", slug: "seruyan" },
        { id: "a", name: "DPRD Kapuas", slug: "kapuas" }
      ])) as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.institutions.map((i) => i.name)).toEqual([
        "DPRD Kapuas",
        "Pemkab Seruyan"
      ]);
    }
  });
});
