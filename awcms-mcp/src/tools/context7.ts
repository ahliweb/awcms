import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Context7 } from "@upstash/context7-sdk";
import { env } from "../lib/config.js";

export function registerContext7Tools(server: McpServer) {
  const MAX_RESPONSE_LENGTH = 50000;
  let context7Client: Context7 | undefined;

  // Lazily initialize and reuse client to avoid repeated setup cost.
  const getClient = () => {
    if (!env.CONTEXT7_API_KEY) {
      throw new Error("CONTEXT7_API_KEY is not set in environment variables.");
    }

    if (!context7Client) {
      context7Client = new Context7({
        apiKey: env.CONTEXT7_API_KEY,
      });
    }

    return context7Client;
  };

  server.tool(
    "context7_search",
    {
      query: z
        .string()
        .trim()
        .min(2)
        .max(500)
        .describe("The specific question or topic to search for (e.g. 'how to use auth with RLS')"),
      library: z
        .string()
        .trim()
        .min(3)
        .max(120)
        .describe(
          "The library ID to search within (e.g. 'supabase/supabase-js', 'flutter/flutter', 'react/react')",
        ),
    },
    async ({ query, library }) => {
      try {
        const client = getClient();
        // Use getContext to fetch documentation snippets
        const results = await client.getContext(query, library, { type: "json" });
        const payload = JSON.stringify(results, null, 2);
        const text =
          payload.length > MAX_RESPONSE_LENGTH
            ? `${payload.slice(0, MAX_RESPONSE_LENGTH)}\n... [truncated]`
            : payload;

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[context7_search] ${errorMessage}`);

        return {
          content: [
            {
              type: "text",
              text: "Context7 request failed. Verify CONTEXT7_API_KEY and network connectivity.",
            },
          ],
          isError: true,
        };
      }
    },
  );
}
