import { getPermalink } from "./utils/permalinks";
import type { HeaderLink } from "./lib/menu";
import type { CallToAction } from "./types";

interface HeaderData {
  links: HeaderLink[];
  actions?: CallToAction[];
}

export const headerData: HeaderData = {
  links: [
    {
      text: "nav.homes",
      links: [
        {
          text: "nav.saas",
          href: getPermalink("/homes/saas"),
        },
        {
          text: "nav.startup",
          href: getPermalink("/homes/startup"),
        },
        {
          text: "nav.mobile_app",
          href: getPermalink("/homes/mobile-app"),
        },
        {
          text: "nav.personal",
          href: getPermalink("/homes/personal"),
        },
      ],
    },
    {
      text: "nav.pages",
      links: [
        {
          text: "nav.features",
          href: getPermalink("/#features"),
        },
        {
          text: "nav.services",
          href: getPermalink("/services"),
        },
        {
          text: "nav.pricing",
          href: getPermalink("/pricing"),
        },
        {
          text: "nav.about",
          href: getPermalink("/about"),
        },
        {
          text: "nav.contact",
          href: getPermalink("/contact"),
        },
        {
          text: "nav.terms",
          href: getPermalink("/terms"),
        },
        {
          text: "nav.privacy",
          href: getPermalink("/privacy"),
        },
      ],
    },
    {
      text: "nav.landing",
      links: [
        {
          text: "nav.lead_generation",
          href: getPermalink("/landing/lead-generation"),
        },
        {
          text: "nav.long_form_sales",
          href: getPermalink("/landing/sales"),
        },
        {
          text: "nav.click_through",
          href: getPermalink("/landing/click-through"),
        },
        {
          text: "nav.product_details",
          href: getPermalink("/landing/product"),
        },
        {
          text: "nav.coming_soon",
          href: getPermalink("/landing/pre-launch"),
        },
        {
          text: "nav.subscription",
          href: getPermalink("/landing/subscription"),
        },
      ],
    },
    {
      text: "nav.blog",
      links: [
        {
          text: "nav.blog_list",
          href: getPermalink("/blogs"),
        },
      ],
    },
    {
      text: "nav.widgets",
      href: "#",
    },
  ],
  actions: [
    { text: "nav.download", href: "https://ahliweb.co.id", target: "_blank" },
  ],
};

export const footerData = {
  links: [
    {
      title: "footer.product",
      links: [
        { text: "footer.features", href: "#" },
        { text: "footer.security", href: "#" },
        { text: "footer.team", href: "#" },
        { text: "footer.enterprise", href: "#" },
        { text: "footer.customer_stories", href: "#" },
        { text: "footer.pricing", href: "#" },
        { text: "footer.resources", href: "#" },
      ],
    },
    {
      title: "footer.platform",
      links: [
        { text: "footer.developer_api", href: "#" },
        { text: "footer.partners", href: "#" },
        { text: "footer.atom", href: "#" },
        { text: "footer.electron", href: "#" },
        { text: "footer.desktop", href: "#" },
      ],
    },
    {
      title: "footer.support",
      links: [
        { text: "footer.docs", href: "#" },
        { text: "footer.community", href: "#" },
        { text: "footer.prof_services", href: "#" },
        { text: "footer.skills", href: "#" },
        { text: "footer.status", href: "#" },
      ],
    },
    {
      title: "footer.company",
      links: [
        { text: "footer.about", href: "#" },
        { text: "footer.blog", href: "#" },
        { text: "footer.careers", href: "#" },
        { text: "footer.press", href: "#" },
        { text: "footer.inclusion", href: "#" },
        { text: "footer.social_impact", href: "#" },
        { text: "footer.shop", href: "#" },
      ],
    },
  ],
  secondaryLinks: [
    {
      text: "footer.terms",
      href: getPermalink("/p/terms"),
      target: "_blank",
      popup: true,
    },
    {
      text: "footer.privacy",
      href: getPermalink("/p/privacy"),
      target: "_blank",
      popup: true,
    },
    {
      text: "Cookie Policy",
      href: getPermalink("/p/cookie-policy"),
      target: "_blank",
      popup: true,
    },
    {
      text: "Licensing",
      href: getPermalink("/p/licensing"),
      target: "_blank",
      popup: true,
    },
    {
      text: "footer.contact",
      href: getPermalink("/p/contact"),
      target: "_blank",
      popup: true,
    },
  ],
  socialLinks: [
    {
      ariaLabel: "X",
      icon: "tabler:brand-x",
      href: "https://twitter.com/ahliwebcom",
    },
    {
      ariaLabel: "Instagram",
      icon: "tabler:brand-instagram",
      href: "https://www.instagram.com/ahliwebinternasional",
    },
    {
      ariaLabel: "Facebook",
      icon: "tabler:brand-facebook",
      href: "https://www.facebook.com/ahliwebcom",
    },
    {
      ariaLabel: "Youtube",
      icon: "tabler:brand-youtube",
      href: "https://www.youtube.com/@ahliwebcom",
    },
  ],
  footNote: "footer.made_by",
};
