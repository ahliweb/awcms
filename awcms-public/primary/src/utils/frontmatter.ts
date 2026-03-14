import getReadingTime from "reading-time";
import type { Root as HastRoot, Element } from "hast";
import type { Root as MdastRoot } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { VFile } from "vfile";

type AstroVFile = VFile & {
  data: VFile["data"] & {
    astro?: {
      frontmatter?: Record<string, unknown> & { readingTime?: number };
    };
  };
};

type RemarkPlugin = Plugin<[], MdastRoot>;
type RehypePlugin = Plugin<[], HastRoot>;

export const readingTimeRemarkPlugin: RemarkPlugin = () => {
  return function (tree: MdastRoot, file?: AstroVFile) {
    const textOnPage = toString(tree);
    const readingTime = Math.ceil(getReadingTime(textOnPage).minutes);

    if (typeof file?.data?.astro?.frontmatter !== "undefined") {
      file.data.astro.frontmatter.readingTime = readingTime;
    }
  };
};

export const responsiveTablesRehypePlugin: RehypePlugin = () => {
  return function (tree: HastRoot) {
    if (!tree.children) return;

    for (let i = 0; i < tree.children.length; i++) {
      const child = tree.children[i];

      if (child.type === "element" && child.tagName === "table") {
        tree.children[i] = {
          type: "element",
          tagName: "div",
          properties: {
            style: "overflow:auto",
          },
          children: [child],
        };

        i++;
      }
    }
  };
};

export const lazyImagesRehypePlugin: RehypePlugin = () => {
  return function (tree: HastRoot) {
    if (!tree.children) return;

    visit(tree, "element", function (node: Element) {
      if (node.tagName === "img") {
        node.properties ||= {};
        node.properties.loading = "lazy";
      }
    });
  };
};
