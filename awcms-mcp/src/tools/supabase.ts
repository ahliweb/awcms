import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execa } from "execa";
import { PROJECT_ROOT, env } from "../lib/config.js";

export function registerSupabaseTools(server: McpServer) {
  async function runSupabaseCommand(args: string[]) {
    try {
      const { stdout, stderr } = await execa("npx", ["supabase", ...args], {
        cwd: PROJECT_ROOT,
        env: env,
        all: true,
        reject: false,
      });

      return {
        output: stdout || stderr,
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

  server.tool("supabase_status", {}, async () => {
    const result = await runSupabaseCommand(["status"]);
    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("supabase_db_pull", {}, async () => {
    const result = await runSupabaseCommand(["db", "pull"]);
    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("supabase_db_push", {}, async () => {
    const result = await runSupabaseCommand(["db", "push"]);
    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool(
    "supabase_migration_new",
    {
      name: z.string().describe("Name of the migration (e.g., 'create_users_table')"),
    },
    async ({ name }) => {
      const result = await runSupabaseCommand(["migration", "new", name]);
      return {
        content: [{ type: "text", text: result.output }],
        isError: result.isError,
      };
    },
  );

  server.tool("supabase_gen_types", {}, async () => {
    const result = await runSupabaseCommand(["gen", "types", "typescript", "--local"]);
    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });
}
