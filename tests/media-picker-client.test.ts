/**
 * The reusable media picker's data half (Issue #595).
 *
 * `fetch` is injected, so these are plain unit tests. What they pin is what a
 * picker gets wrong in ways nobody notices: an empty list that is really a
 * permission refusal, and a choice the author cannot actually use.
 */
import { describe, expect, test } from "bun:test";

import {
  describePickableMedia,
  fetchPickableMedia,
  PICKER_LIST_URL,
  type PickableMediaObject
} from "../src/lib/ui/media-picker-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function itemsResponse(items: unknown[]): Response {
  return jsonResponse({ success: true, data: { items } });
}

const FULL = {
  id: "11111111-1111-4111-8111-111111111111",
  publicUrl: "https://media.example.com/news/a.jpg",
  originalFilename: "DSC_0431.jpg",
  mimeType: "image/jpeg",
  altText: "Banjir di Palangka Raya",
  caption: null,
  width: 1200,
  height: 800
};

describe("fetchPickableMedia", () => {
  test("asks only for verified, live objects", async () => {
    // Both halves matter. `verified` is the set that passed the finalize
    // pipeline; `deletion=live` because a soft-deleted object can still BE
    // verified while every reference to it has stopped resolving.
    expect(PICKER_LIST_URL).toContain("status=verified");
    expect(PICKER_LIST_URL).toContain("deletion=live");

    let requested = "";
    await fetchPickableMedia((async (url: string) => {
      requested = String(url);
      return itemsResponse([]);
    }) as unknown as typeof fetch);

    expect(requested).toBe(PICKER_LIST_URL);
  });

  test("maps a full row through unchanged", async () => {
    const result = await fetchPickableMedia((async () =>
      itemsResponse([FULL])) as unknown as typeof fetch);

    expect(result).toEqual({ ok: true, items: [FULL] });
  });

  test("a 403 is reported as FORBIDDEN, not as an empty library", async () => {
    // The defect this exists for: rendering "no images yet" to someone who
    // simply lacks `media_library.media.read` sends them looking for an upload
    // problem that does not exist.
    const result = await fetchPickableMedia((async () =>
      jsonResponse({ success: false }, 403)) as unknown as typeof fetch);

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  test("a network failure is unavailable, not an empty list", async () => {
    const result = await fetchPickableMedia((async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  test("a 500 is unavailable", async () => {
    const result = await fetchPickableMedia((async () =>
      jsonResponse({ success: false }, 500)) as unknown as typeof fetch);

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  test("a 200 whose body is not the documented shape is unavailable", async () => {
    for (const body of [
      { success: false },
      { success: true },
      { success: true, data: {} },
      { success: true, data: { items: "not an array" } },
      "not json at all"
    ]) {
      const result = await fetchPickableMedia((async () =>
        body === "not json at all"
          ? new Response("<html/>", { status: 200 })
          : jsonResponse(body)) as unknown as typeof fetch);

      expect(result.ok).toBe(false);
    }
  });

  test("drops a row with no id or no publicUrl rather than offering it", async () => {
    // Either would produce a choice that fails after the author clicks it —
    // one cannot be submitted, the other renders as a broken thumbnail.
    const result = await fetchPickableMedia((async () =>
      itemsResponse([
        FULL,
        { ...FULL, id: "" },
        { ...FULL, publicUrl: "" },
        {}
      ])) as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items).toEqual([FULL]);
  });

  test("tolerates missing optional fields without dropping the row", async () => {
    const result = await fetchPickableMedia((async () =>
      itemsResponse([
        {
          id: FULL.id,
          publicUrl: FULL.publicUrl,
          mimeType: "image/webp"
        }
      ])) as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items[0]).toEqual({
        id: FULL.id,
        publicUrl: FULL.publicUrl,
        originalFilename: null,
        mimeType: "image/webp",
        altText: null,
        caption: null,
        width: null,
        height: null
      });
    }
  });
});

describe("describePickableMedia", () => {
  const base: PickableMediaObject = {
    id: "x",
    publicUrl: "https://media.example.com/a.jpg",
    originalFilename: "DSC_0431.jpg",
    mimeType: "image/jpeg",
    altText: null,
    caption: null,
    width: null,
    height: null
  };

  test("prefers alt text — what a person wrote ABOUT the picture", () => {
    expect(
      describePickableMedia({ ...base, altText: "Banjir di Palangka Raya" })
    ).toBe("Banjir di Palangka Raya");
  });

  test("falls back to the caption before the filename", () => {
    expect(describePickableMedia({ ...base, caption: "Foto: Antara" })).toBe(
      "Foto: Antara"
    );
  });

  test("falls back to the filename", () => {
    expect(describePickableMedia(base)).toBe("DSC_0431.jpg");
  });

  test("never returns blank — an unlabelled choice is unclickable in practice", () => {
    expect(
      describePickableMedia({
        ...base,
        originalFilename: null,
        altText: "   ",
        caption: ""
      })
    ).toBe("Untitled image");
  });
});
