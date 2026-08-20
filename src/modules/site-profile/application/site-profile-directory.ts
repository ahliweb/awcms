/**
 * Reads and writes `awcms_site_profile` (Issue #596, ADR-0102).
 *
 * One row per tenant, upserted — there is no "create profile" step, because a
 * tenant always conceptually HAS an identity and the only question is how much
 * of it has been filled in. A screen that made an operator press "create"
 * before they could type an address would be asking about a distinction the
 * domain does not have.
 */
import type {
  SiteProfileInput,
  SocialLink
} from "../domain/site-profile-validation";

export type SiteProfileView = {
  tagline: string | null;
  copyrightNotice: string | null;
  logoMediaId: string | null;
  faviconMediaId: string | null;
  editorialAddress: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  socialLinks: SocialLink[];
  updatedAt: Date | null;
};

type SiteProfileRow = {
  tagline: string | null;
  copyright_notice: string | null;
  logo_media_id: string | null;
  favicon_media_id: string | null;
  editorial_address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  whatsapp_number: string | null;
  social_links: unknown;
  updated_at: Date;
};

/**
 * The empty profile a tenant has before anything is saved.
 *
 * Returned instead of `null` so every consumer has the same shape to render
 * and none has to branch on "no row yet" — which is not a state a reader cares
 * about, only a storage detail.
 */
export const EMPTY_SITE_PROFILE: SiteProfileView = {
  tagline: null,
  copyrightNotice: null,
  logoMediaId: null,
  faviconMediaId: null,
  editorialAddress: null,
  contactEmail: null,
  contactPhone: null,
  whatsappNumber: null,
  socialLinks: [],
  updatedAt: null
};

/**
 * `social_links` comes back from `jsonb` as `unknown`.
 *
 * Re-checked here rather than trusted: the column's CHECK guarantees it is an
 * ARRAY, not that every element has the shape this code expects, and a row
 * written before a future validator change must not throw inside a public page
 * render. Anything unrecognised is dropped.
 */
function toSocialLinks(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;

    return typeof record.platform === "string" &&
      typeof record.url === "string" &&
      record.platform !== "" &&
      record.url !== ""
      ? [{ platform: record.platform, url: record.url }]
      : [];
  });
}

function toView(row: SiteProfileRow): SiteProfileView {
  return {
    tagline: row.tagline,
    copyrightNotice: row.copyright_notice,
    logoMediaId: row.logo_media_id,
    faviconMediaId: row.favicon_media_id,
    editorialAddress: row.editorial_address,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    whatsappNumber: row.whatsapp_number,
    socialLinks: toSocialLinks(row.social_links),
    updatedAt: row.updated_at
  };
}

export async function fetchSiteProfile(
  tx: Bun.SQL,
  tenantId: string
): Promise<SiteProfileView> {
  const rows = (await tx`
    SELECT tagline, copyright_notice, logo_media_id, favicon_media_id,
           editorial_address, contact_email, contact_phone, whatsapp_number,
           social_links, updated_at
    FROM awcms_site_profile
    WHERE tenant_id = ${tenantId}
  `) as SiteProfileRow[];

  const row = rows[0];

  return row ? toView(row) : EMPTY_SITE_PROFILE;
}

export async function upsertSiteProfile(
  tx: Bun.SQL,
  tenantId: string,
  input: SiteProfileInput,
  actorId: string
): Promise<SiteProfileView> {
  // `${object}` rather than `${JSON.stringify(object)}::jsonb` — Bun.SQL binds
  // an object to jsonb directly, and the stringified form has bitten this repo
  // before.
  const rows = (await tx`
    INSERT INTO awcms_site_profile (
      tenant_id, tagline, copyright_notice, logo_media_id, favicon_media_id,
      editorial_address, contact_email, contact_phone, whatsapp_number,
      social_links, created_by, updated_by
    )
    VALUES (
      ${tenantId}, ${input.tagline}, ${input.copyrightNotice},
      ${input.logoMediaId}, ${input.faviconMediaId}, ${input.editorialAddress},
      ${input.contactEmail}, ${input.contactPhone}, ${input.whatsappNumber},
      ${input.socialLinks}, ${actorId}, ${actorId}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      tagline = EXCLUDED.tagline,
      copyright_notice = EXCLUDED.copyright_notice,
      logo_media_id = EXCLUDED.logo_media_id,
      favicon_media_id = EXCLUDED.favicon_media_id,
      editorial_address = EXCLUDED.editorial_address,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone,
      whatsapp_number = EXCLUDED.whatsapp_number,
      social_links = EXCLUDED.social_links,
      updated_at = now(),
      updated_by = EXCLUDED.updated_by
    RETURNING tagline, copyright_notice, logo_media_id, favicon_media_id,
              editorial_address, contact_email, contact_phone, whatsapp_number,
              social_links, updated_at
  `) as SiteProfileRow[];

  const row = rows[0];

  if (!row) {
    // An upsert that returns nothing means the row was filtered by RLS, which
    // for a tenant-scoped write means the transaction's tenant context is not
    // the one being written. Failing loudly beats returning an empty profile
    // that reads as "saved, and it cleared everything".
    throw new Error(
      "upsertSiteProfile wrote no row — tenant context does not match."
    );
  }

  return toView(row);
}
