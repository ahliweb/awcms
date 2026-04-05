import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execa } from "execa";
import { env } from "../lib/config.js";

const dbUrl = env.SUPABASE_DB_URL;

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
}
