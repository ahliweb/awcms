import sanitizeHtml from "sanitize-html";
import { SANITIZE_BASE_OPTIONS } from "@awcms/shared/sanitize";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  ...SANITIZE_BASE_OPTIONS,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "nofollow noopener noreferrer",
      target: "_blank",
    }),
  },
};

export const sanitizeHTML = (html: string | null | undefined): string => {
  if (!html) return "";
  return sanitizeHtml(html, SANITIZE_OPTIONS);
};
