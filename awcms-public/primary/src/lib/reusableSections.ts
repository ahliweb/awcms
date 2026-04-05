import type { SupabaseClient } from "@supabase/supabase-js";

export async function getReusableSectionContentBySlug(
  supabase: SupabaseClient,
  slug: string,
  tenantId?: string | null,
): Promise<Record<string, unknown> | null> {
  if (!supabase || !slug) return null;

  let query = supabase
    .from("reusable_sections")
    .select("id, section_mode, content, template_part_id")
    .eq("slug", slug)
    .eq("status", "active")
    .is("deleted_at", null);

  if (tenantId) {
    query = query.or(`owner_tenant_id.eq.${tenantId},owner_tenant_id.is.null`);
  } else {
    query = query.is("owner_tenant_id", null);
  }

  const { data: section, error } = await query.maybeSingle();
  if (error || !section) {
    if (error) {
      console.error("[ReusableSection] Error fetching reusable section:", error.message);
    }
    return null;
  }

  if (section.section_mode === "template_part_reference" && section.template_part_id) {
    const { data: part, error: partError } = await supabase
      .from("template_parts")
      .select("content")
      .eq("id", section.template_part_id)
      .maybeSingle();

    if (partError) {
      console.error("[ReusableSection] Error fetching referenced template part:", partError.message);
      return null;
    }

    return (part?.content as Record<string, unknown> | null) || null;
  }

  return (section.content as Record<string, unknown> | null) || null;
}
