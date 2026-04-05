import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSupabaseTools } from "./tools/supabase.js";
import { registerContext7Tools } from "./tools/context7.js";
import { registerFlutterTools } from "./tools/flutter.js";
import { registerSiteCompositionTools } from "./tools/site-composition.js";

// Initialize Unified Server
const server = new McpServer({
  name: "awcms-unified-mcp",
  version: "2.0.0",
});

// Register Tool Modules
registerSupabaseTools(server);
registerContext7Tools(server);
registerFlutterTools(server);
registerSiteCompositionTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AWCMS Unified MCP Server running (Supabase + Context7 + Flutter)...");
}

main().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
