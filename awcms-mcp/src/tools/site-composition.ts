import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execa } from "execa";
import { env } from "../lib/config.js";

const dbUrl = env.SUPABASE_DB_URL;
const edgeBaseUrl = env.VITE_LOCAL_EDGE_URL || env.VITE_EDGE_URL || env.PUBLIC_EDGE_URL;
const operatorBearerToken = env.AWCMS_OPERATOR_BEARER_TOKEN;

async function runSql(query: string) {
  if (!dbUrl) {
    return {
      output: "SUPABASE_DB_URL is required to query local AWCMS composition data.",
      isError: true,
    };
  }

  try {
    const { stdout, stderr, all } = await execa("psql", [dbUrl, "-P", "pager=off", "-c", query], {
      env,
      all: true,
      reject: false,
    });

    return {
      output: all ?? stdout ?? stderr,
      isError: false,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      output: errorMessage,
      isError: true,
    };
  }
}

async function callEdgeRoute(path: string, body: Record<string, unknown>) {
  if (!edgeBaseUrl) {
    return {
      output: "VITE_LOCAL_EDGE_URL, VITE_EDGE_URL, or PUBLIC_EDGE_URL is required to call AWCMS Worker routes.",
      isError: true,
    };
  }

  if (!operatorBearerToken) {
    return {
      output: "AWCMS_OPERATOR_BEARER_TOKEN is required for write-capable site composition tools.",
      isError: true,
    };
  }

  try {
    const response = await fetch(`${edgeBaseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${operatorBearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    return {
      output: text,
      isError: !response.ok,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      output: errorMessage,
      isError: true,
    };
  }
}

export function registerSiteCompositionTools(server: McpServer) {
  server.tool("awcms_list_site_blueprints", {
    tenant_scope: z.enum(["all", "platform", "tenant"]).default("all").describe("Filter by blueprint ownership scope."),
  }, async ({ tenant_scope }) => {
    const whereClause = tenant_scope === "platform"
      ? "owner_tenant_id IS NULL"
      : tenant_scope === "tenant"
        ? "owner_tenant_id IS NOT NULL"
        : "TRUE";

    const result = await runSql(`
      SELECT slug, name, status, owner_tenant_id, updated_at
      FROM public.site_blueprints
      WHERE deleted_at IS NULL AND ${whereClause}
      ORDER BY updated_at DESC;
    `);

    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("awcms_get_tenant_blueprint_state", {
    tenant_id: z.string().describe("Tenant UUID to inspect."),
  }, async ({ tenant_id }) => {
    const result = await runSql(`
      SELECT state.tenant_id, state.applied_at, blueprint.slug, blueprint.name
      FROM public.tenant_site_blueprint_state state
      JOIN public.site_blueprints blueprint ON blueprint.id = state.blueprint_id
      WHERE state.deleted_at IS NULL
        AND state.tenant_id = '${tenant_id.replace(/'/g, "''")}';
    `);

    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("awcms_list_reusable_sections", {
    tenant_scope: z.enum(["all", "platform", "tenant"]).default("all").describe("Filter by section ownership scope."),
  }, async ({ tenant_scope }) => {
    const whereClause = tenant_scope === "platform"
      ? "owner_tenant_id IS NULL"
      : tenant_scope === "tenant"
        ? "owner_tenant_id IS NOT NULL"
        : "TRUE";

    const result = await runSql(`
      SELECT slug, name, section_mode, status, owner_tenant_id, updated_at
      FROM public.reusable_sections
      WHERE deleted_at IS NULL AND ${whereClause}
      ORDER BY updated_at DESC;
    `);

    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("awcms_apply_site_blueprint", {
    blueprint_id: z.string().trim().min(1).describe("Blueprint UUID to apply."),
    tenant_id: z.string().trim().min(1).describe("Tenant UUID to apply the blueprint to."),
  }, async ({ blueprint_id, tenant_id }) => {
    const result = await callEdgeRoute("/functions/v1/site-blueprints", {
      action: "apply",
      blueprintId: blueprint_id,
      tenantId: tenant_id,
    });

    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("awcms_materialize_reusable_section", {
    section_id: z.string().trim().min(1).describe("Reusable section UUID to materialize."),
    tenant_id: z.string().trim().min(1).describe("Tenant UUID to receive the materialized template part."),
    part_type: z.enum(["header", "footer", "sidebar", "widget_area"]).default("widget_area").describe("Template part type to create."),
  }, async ({ section_id, tenant_id, part_type }) => {
    const result = await callEdgeRoute("/functions/v1/reusable-sections", {
      action: "materialize",
      sectionId: section_id,
      tenantId: tenant_id,
      partType: part_type,
    });

    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });
}
