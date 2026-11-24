/**
 * Issue #1498 — the bundled contract must DECLARE every property a `videoNews`
 * node actually carries. `PortableTextNode` allows additional properties, so
 * validity alone cannot catch an undeclared field; the test therefore also
 * asserts each emitted key is declared, with a type the value satisfies.
 */
import { beforeAll, describe, expect, test } from "bun:test";

import {
  createContractValidator,
  loadBundledContract
} from "../scripts/api-contract-lint";
import { contentBlocksToPortableText } from "../src/modules/blog-content/domain/portable-text-conversion";
import type { ContentBlock } from "../src/modules/blog-content/domain/content-block-rendering";

type Doc = Record<string, any>;

const POINTER = "/components/schemas/PortableTextNode";

let doc: Doc;
let validate: (v: unknown) => { valid: boolean; errors: string };

beforeAll(async () => {
  doc = (await loadBundledContract()) as Doc;
  validate = createContractValidator(doc, POINTER);
});

function fullNode() {
  const block: ContentBlock = {
    type: "video_news",
    provider: "youtube",
    videoId: "dQw4w9WgXcQ",
    title: "Judul",
    caption: "Keterangan",
    thumbnailMediaObjectId: "11111111-1111-4111-8111-111111111111",
    durationSeconds: 125,
    sourceLabel: "Sumber"
  };
  const [node] = contentBlocksToPortableText([block]);
  return node as Record<string, unknown>;
}

describe("PortableTextNode videoNews (#1498)", () => {
  test("a real videoNews node validates against the bundle", () => {
    const node = fullNode();
    expect(node._type).toBe("videoNews");
    const result = validate(node);
    expect(result.errors).toBe("");
    expect(result.valid).toBe(true);
  });

  test("every key the node carries is declared with a matching type", () => {
    const node = fullNode();
    const props = doc.components.schemas.PortableTextNode.properties as Doc;

    for (const [key, value] of Object.entries(node)) {
      expect(Object.keys(props)).toContain(key);
      const declared = props[key].type as string;
      const actual: string = typeof value;
      expect(actual).toBe(declared === "integer" ? "number" : declared);
    }
  });
});
