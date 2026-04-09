import { getRssString } from "@astrojs/rss";

import { SITE, METADATA } from "astrowind:config";

export const GET = async () => {
  const rss = await getRssString({
    title: `${SITE.name}`,
    description: METADATA?.description || "",
    site: import.meta.env.SITE,
    items: [],

    trailingSlash: SITE.trailingSlash,
  });

  return new Response(rss, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
};
