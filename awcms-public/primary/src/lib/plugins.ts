/**
 * Plugin system library for loading and managing plugins from Supabase.
 * Provides a standardized interface for plugin configuration and rendering.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PluginData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  version: string;
  type: "analytics" | "social" | "form" | "payment" | "seo" | "custom";
  config: Record<string, unknown>;
  is_active: boolean;
  priority: number;
  hook_locations: string[];
}

export interface PluginScript {
  src?: string;
  inline?: string;
  async?: boolean;
  defer?: boolean;
  position: "head" | "body_start" | "body_end";
  attributes?: Record<string, string>;
}

/**
 * Fetch all active plugins for a tenant
 */
export async function getActivePlugins(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<PluginData[]> {
  let query = supabase
    .from("plugins")
    .select("*")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("priority", { ascending: true });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    const message = error.message || "";
    if (message.includes("schema cache") || message.includes("plugins")) {
      return [];
    }
    console.error("[Plugin] Error fetching plugins:", error.message);
    return [];
  }

  return (data || []).map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    slug: plugin.slug,
    description: plugin.description,
    version: plugin.version || "1.0.0",
    type: plugin.type || "custom",
    config:
      typeof plugin.config === "string"
        ? JSON.parse(plugin.config)
        : plugin.config || {},
    is_active: plugin.is_active,
    priority: plugin.priority || 0,
    hook_locations: Array.isArray(plugin.hook_locations)
      ? plugin.hook_locations
      : [],
  }));
}

/**
 * Fetch plugins for a specific hook location
 */
export async function getPluginsByHook(
  supabase: SupabaseClient,
  hookLocation: string,
  tenantId?: string | null,
): Promise<PluginData[]> {
  const plugins = await getActivePlugins(supabase, tenantId);
  return plugins.filter((p) => p.hook_locations.includes(hookLocation));
}

/**
 * Get plugin scripts for a specific position
 */
export function getPluginScripts(
  plugins: PluginData[],
  position: "head" | "body_start" | "body_end",
): PluginScript[] {
  const scripts: PluginScript[] = [];

  for (const plugin of plugins) {
    const config = plugin.config;

    // Google Analytics
    if (plugin.slug === "google-analytics" && config.measurement_id) {
      if (position === "head") {
        scripts.push({
          src: `https://www.googletagmanager.com/gtag/js?id=${config.measurement_id}`,
          async: true,
          position: "head",
        });
        scripts.push({
          inline: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${config.measurement_id}');`,
          position: "head",
        });
      }
    }

    // Facebook Pixel
    if (plugin.slug === "facebook-pixel" && config.pixel_id) {
      if (position === "head") {
        scripts.push({
          inline: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${config.pixel_id}');
fbq('track', 'PageView');`,
          position: "head",
        });
      }
    }

    // Custom script plugins
    if (plugin.type === "custom" && config.scripts) {
      const customScripts = Array.isArray(config.scripts)
        ? config.scripts
        : [config.scripts];
      for (const script of customScripts) {
        if (script.position === position) {
          scripts.push({
            src: script.src,
            inline: script.inline,
            async: script.async,
            defer: script.defer,
            position,
            attributes: script.attributes,
          });
        }
      }
    }

    // Hotjar
    if (plugin.slug === "hotjar" && config.site_id) {
      if (position === "head") {
        scripts.push({
          inline: `(function(h,o,t,j,a,r){
h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
h._hjSettings={hjid:${config.site_id},hjsv:6};
a=o.getElementsByTagName('head')[0];
r=o.createElement('script');r.async=1;
r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
a.appendChild(r);
})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`,
          position: "head",
        });
      }
    }

    // Crisp Chat
    if (plugin.slug === "crisp-chat" && config.website_id) {
      if (position === "body_end") {
        scripts.push({
          inline: `window.$crisp=[];window.CRISP_WEBSITE_ID="${config.website_id}";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`,
          position: "body_end",
        });
      }
    }
  }

  return scripts;
}

/**
 * Generate HTML for plugin scripts
 */
export function renderPluginScripts(scripts: PluginScript[]): string {
  return scripts
    .map((script) => {
      if (script.inline) {
        return `<script>${script.inline}</script>`;
      }
      if (script.src) {
        const attrs = [
          `src="${script.src}"`,
          script.async ? "async" : "",
          script.defer ? "defer" : "",
          ...Object.entries(script.attributes || {}).map(
            ([k, v]) => `${k}="${v}"`,
          ),
        ]
          .filter(Boolean)
          .join(" ");
        return `<script ${attrs}></script>`;
      }
      return "";
    })
    .join("\n");
}
