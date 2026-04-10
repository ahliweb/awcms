import { describe, expect, it } from "vitest";

import {
  localizePublicUrl,
  mapMenuItemsToFooterLinks,
  mapMenuItemsToHeaderLinks,
  type MenuItem,
} from "../menu";

describe("menu helpers", () => {
  it("localizes internal URLs but leaves external URLs untouched", () => {
    expect(localizePublicUrl("/about", "en")).toBe("/en/about");
    expect(localizePublicUrl("/en/about", "en")).toBe("/en/about");
    expect(localizePublicUrl("https://example.com", "en")).toBe(
      "https://example.com",
    );
  });

  it("maps standalone footer links instead of dropping them", () => {
    const items: MenuItem[] = [
      {
        id: "privacy",
        title: "Privacy Policy",
        url: "/p/privacy",
        is_active: true,
        is_public: true,
        sort_order: 0,
        children: [],
      },
      {
        id: "company",
        title: "Company",
        url: null,
        is_active: true,
        is_public: true,
        sort_order: 1,
        children: [
          {
            id: "about",
            title: "About",
            url: "/about",
            is_active: true,
            is_public: true,
            sort_order: 0,
            children: [],
          },
        ],
      },
    ];

    const result = mapMenuItemsToFooterLinks(items, "en");

    expect(result).toEqual([
      {
        title: "",
        links: [
          {
            text: "Privacy Policy",
            href: "/en/p/privacy",
            target: "_blank",
            popup: true,
          },
        ],
      },
      {
        title: "Company",
        links: [
          {
            text: "About",
            href: "/en/about",
            target: undefined,
            popup: false,
          },
        ],
      },
    ]);
  });

  it("maps nested header links with locale-aware internal URLs", () => {
    const items: MenuItem[] = [
      {
        id: "services",
        title: "Services",
        url: "/services",
        is_active: true,
        is_public: true,
        sort_order: 0,
        children: [
          {
            id: "consulting",
            title: "Consulting",
            url: "/services/consulting",
            is_active: true,
            is_public: true,
            sort_order: 0,
            children: [],
          },
        ],
      },
    ];

    expect(mapMenuItemsToHeaderLinks(items, "id")).toEqual([
      {
        text: "Services",
        href: "/id/services",
        links: [
          {
            text: "Consulting",
            href: "/id/services/consulting",
            links: [],
          },
        ],
      },
    ]);
  });
});
