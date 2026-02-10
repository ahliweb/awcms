import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { execa } from "execa";
import path from "path";
import { PROJECT_ROOT, env } from "../lib/config.js";

export function registerFlutterTools(server: McpServer) {
  const MOBILE_ROOT = path.resolve(PROJECT_ROOT, "awcms-mobile/primary");

  async function runFlutterCommand(args: string[]) {
    try {
      const { stdout, stderr } = await execa("flutter", args, {
        cwd: MOBILE_ROOT,
        env: env,
        all: true,
        reject: false,
      });

      return {
        output: stdout || stderr,
        isError: false,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        output: `Failed to execute flutter command. Ensure Flutter is in PATH.\n${errorMessage}`,
        isError: true,
      };
    }
  }

  server.tool("flutter_doctor", {}, async () => {
    const result = await runFlutterCommand(["doctor"]);
    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("flutter_pub_get", {}, async () => {
    const result = await runFlutterCommand(["pub", "get"]);
    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });

  server.tool("flutter_analyze", {}, async () => {
    const result = await runFlutterCommand(["analyze"]);
    return {
      content: [{ type: "text", text: result.output }],
      isError: result.isError,
    };
  });
}
