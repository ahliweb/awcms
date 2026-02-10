import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Context7 } from "@upstash/context7-sdk";
import { env } from "../lib/config.js";

export function registerContext7Tools(server: McpServer) {
  // Lazily initialize client to avoid crashes if API key is missing
  const getClient = () => {
    if (!env.CONTEXT7_API_KEY) {
      throw new Error("CONTEXT7_API_KEY is not set in environment variables.");
    }
    return new Context7({
      apiKey: env.CONTEXT7_API_KEY,
    });
  };

  server.tool(
    "context7_search",
    {
      query: z
        .string()
        .describe("The specific question or topic to search for (e.g. 'how to use auth with RLS')"),
      library: z
        .string()
        .describe(
          "The library ID to search within (e.g. 'supabase/supabase-js', 'flutter/flutter', 'react/react')",
        ),
    },
    async ({ query, library }) => {
      try {
        const client = getClient();
        // Use getContext to fetch documentation snippets
        const results = await client.getContext(query, library, { type: "json" });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Context7 Error: ${errorMessage}` }],
          isError: true,
        };
      }
    },
  );
}
