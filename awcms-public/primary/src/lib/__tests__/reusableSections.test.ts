import { describe, expect, it, vi } from "vitest";
import { getReusableSectionContentBySlug } from "../reusableSections";

describe("getReusableSectionContentBySlug", () => {
  it("returns direct visual content for visual sections", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        section_mode: "visual",
        content: { content: [{ type: "Heading", props: { text: "Hello" } }], root: { props: {} } },
        template_part_id: null,
      },
      error: null,
    });

    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      or: vi.fn(() => query),
      maybeSingle,
    };

    const supabase = {
      from: vi.fn(() => query),
    } as any;

    const result = await getReusableSectionContentBySlug(supabase, "hero-section", "tenant-1");

    expect(result).toEqual({ content: [{ type: "Heading", props: { text: "Hello" } }], root: { props: {} } });
  });

  it("resolves template part content for template_part_reference sections", async () => {
    const partMaybeSingle = vi.fn().mockResolvedValue({
      data: { content: { content: [{ type: "Text", props: { text: "From part" } }], root: { props: {} } } },
      error: null,
    });

    const partQuery = {
      select: vi.fn(() => partQuery),
      eq: vi.fn(() => partQuery),
      maybeSingle: partMaybeSingle,
    };

    const sectionMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        section_mode: "template_part_reference",
        content: null,
        template_part_id: "part-1",
      },
      error: null,
    });

    const sectionQuery = {
      select: vi.fn(() => sectionQuery),
      eq: vi.fn(() => sectionQuery),
      is: vi.fn(() => sectionQuery),
      or: vi.fn(() => sectionQuery),
      maybeSingle: sectionMaybeSingle,
    };

    const supabase = {
      from: vi.fn((table: string) => (table === "reusable_sections" ? sectionQuery : partQuery)),
    } as any;

    const result = await getReusableSectionContentBySlug(supabase, "hero-section", "tenant-1");

    expect(result).toEqual({ content: [{ type: "Text", props: { text: "From part" } }], root: { props: {} } });
  });
});
