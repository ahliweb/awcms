import { describe, expect, it } from "vitest";
import { getReusableSectionContentBySlug } from "../reusableSections";

const createMock = <TArgs extends unknown[] = [], TResult = unknown>(
  implementation?: (...args: TArgs) => TResult,
) => {
  const mockFn = (...args: TArgs) => implementation?.(...args);
  mockFn.mockResolvedValue = (value: TResult) =>
    createMock<TArgs, Promise<TResult>>(() => Promise.resolve(value));
  return mockFn;
};

type QueryMock = {
  select: () => QueryMock;
  eq: () => QueryMock;
  maybeSingle: () => Promise<unknown>;
  is?: () => QueryMock;
  or?: () => QueryMock;
};

type SupabaseMock = {
  from: (table: string) => QueryMock;
};

describe("getReusableSectionContentBySlug", () => {
  it("returns direct visual content for visual sections", async () => {
    const maybeSingle = createMock().mockResolvedValue({
      data: {
        section_mode: "visual",
        content: {
          content: [{ type: "Heading", props: { text: "Hello" } }],
          root: { props: {} },
        },
        template_part_id: null,
      },
      error: null,
    });

    const query = {} as QueryMock;
    query.select = createMock(() => query);
    query.eq = createMock(() => query);
    query.is = createMock(() => query);
    query.or = createMock(() => query);
    query.maybeSingle = maybeSingle;

    const supabase: SupabaseMock = {
      from: createMock(() => query),
    };

    const result = await getReusableSectionContentBySlug(
      supabase,
      "hero-section",
      "tenant-1",
    );

    expect(result).toEqual({
      content: [{ type: "Heading", props: { text: "Hello" } }],
      root: { props: {} },
    });
  });

  it("resolves template part content for template_part_reference sections", async () => {
    const partMaybeSingle = createMock().mockResolvedValue({
      data: {
        content: {
          content: [{ type: "Text", props: { text: "From part" } }],
          root: { props: {} },
        },
      },
      error: null,
    });

    const partQuery = {} as QueryMock;
    partQuery.select = createMock(() => partQuery);
    partQuery.eq = createMock(() => partQuery);
    partQuery.maybeSingle = partMaybeSingle;

    const sectionMaybeSingle = createMock().mockResolvedValue({
      data: {
        section_mode: "template_part_reference",
        content: null,
        template_part_id: "part-1",
      },
      error: null,
    });

    const sectionQuery = {} as QueryMock;
    sectionQuery.select = createMock(() => sectionQuery);
    sectionQuery.eq = createMock(() => sectionQuery);
    sectionQuery.is = createMock(() => sectionQuery);
    sectionQuery.or = createMock(() => sectionQuery);
    sectionQuery.maybeSingle = sectionMaybeSingle;

    const supabase: SupabaseMock = {
      from: createMock((table: string) =>
        table === "reusable_sections" ? sectionQuery : partQuery,
      ),
    };

    const result = await getReusableSectionContentBySlug(
      supabase,
      "hero-section",
      "tenant-1",
    );

    expect(result).toEqual({
      content: [{ type: "Text", props: { text: "From part" } }],
      root: { props: {} },
    });
  });
});
