import type { MetaData } from "~/types";

export interface PublicContentRef {
  collection: string;
  id: string;
  slug?: string | null;
}

export interface PublicPageContext {
  kind: "custom" | "content";
  pageType: string;
  title?: string;
  description?: string;
  canonical?: string;
  image?: string | null;
  locale?: string | null;
  tenantId?: string | null;
  content?: PublicContentRef;
}

interface CreatePublicPageContextOptions {
  metadata?: MetaData;
  pageType?: string;
  locale?: string | null;
  tenantId?: string | null;
  content?: PublicContentRef;
}

const getPrimaryImage = (metadata?: MetaData): string | null => {
  const candidate = metadata?.openGraph?.images?.[0]?.url;
  return typeof candidate === "string" ? candidate : null;
};

export const createPublicPageContext = ({
  metadata,
  pageType = "website",
  locale = null,
  tenantId = null,
  content,
}: CreatePublicPageContextOptions): PublicPageContext => ({
  kind: content ? "content" : "custom",
  pageType,
  title: metadata?.title,
  description: metadata?.description,
  canonical: metadata?.canonical,
  image: getPrimaryImage(metadata),
  locale,
  tenantId,
  content,
});
