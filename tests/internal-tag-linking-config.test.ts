import { describe, expect, test } from "bun:test";

import {
  BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS,
  findBlogAutoInternalTagLinksConfigIssues,
  resolveBlogAutoInternalTagLinksConfig
} from "../src/modules/blog-content/domain/internal-tag-linking-config";

describe("resolveBlogAutoInternalTagLinksConfig", () => {
  test("returns defaults when nothing is set", () => {
    const config = resolveBlogAutoInternalTagLinksConfig({});
    expect(config).toEqual(BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS);
  });

  test("parses every var when set", () => {
    const config = resolveBlogAutoInternalTagLinksConfig({
      BLOG_AUTO_INTERNAL_TAG_LINKS_ENABLED: "false",
      BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_POST: "20",
      BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_TAG: "3",
      BLOG_AUTO_INTERNAL_TAG_LINKS_MIN_TERM_LENGTH: "5",
      BLOG_AUTO_INTERNAL_TAG_LINKS_LINK_FIRST_OCCURRENCE_ONLY: "false",
      BLOG_AUTO_INTERNAL_TAG_LINKS_EXCLUDE_HEADINGS: "false"
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      enabled: false,
      maxPerPost: 20,
      maxPerTag: 3,
      minTermLength: 5,
      linkFirstOccurrenceOnly: false,
      excludeHeadings: false
    });
  });

  test("falls back to default for a malformed integer", () => {
    const config = resolveBlogAutoInternalTagLinksConfig({
      BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_POST: "not-a-number"
    } as NodeJS.ProcessEnv);

    expect(config.maxPerPost).toBe(
      BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS.maxPerPost
    );
  });
});

describe("findBlogAutoInternalTagLinksConfigIssues", () => {
  test("empty for defaults", () => {
    expect(findBlogAutoInternalTagLinksConfigIssues({})).toEqual([]);
  });

  test("flags an out-of-range maxPerPost", () => {
    const issues = findBlogAutoInternalTagLinksConfigIssues({
      BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_POST: "500"
    } as NodeJS.ProcessEnv);
    expect(issues).toContain("max_per_post_out_of_range");
  });

  test("flags an out-of-range maxPerTag", () => {
    const issues = findBlogAutoInternalTagLinksConfigIssues({
      BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_TAG: "50"
    } as NodeJS.ProcessEnv);
    expect(issues).toContain("max_per_tag_out_of_range");
  });

  test("flags an out-of-range minTermLength", () => {
    const issues = findBlogAutoInternalTagLinksConfigIssues({
      BLOG_AUTO_INTERNAL_TAG_LINKS_MIN_TERM_LENGTH: "500"
    } as NodeJS.ProcessEnv);
    expect(issues).toContain("min_term_length_out_of_range");
  });
});
