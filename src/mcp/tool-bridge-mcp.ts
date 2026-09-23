import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolBridgeDescriptor } from "./tool-bridge-types";

export function createLapisMcpServer(
  descriptors: ToolBridgeDescriptor[],
  invoke: (
    name: string,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>,
): McpServer {
  const server = new McpServer(
    { name: "lapis-tools", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: descriptors.map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema,
      annotations: {
        readOnlyHint: descriptor.effect === "read",
        destructiveHint: descriptor.effect === "write",
        openWorldHint: descriptor.effect === "external",
      },
    })),
  }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest, extra: { signal: AbortSignal }) => {
      return toMcpToolResult(
        await invoke(
          request.params.name,
          request.params.arguments ?? {},
          extra.signal,
        ),
      ) as never;
    },
  );
  return server;
}

export function toMcpToolResult(value: unknown): unknown {
  if (!isRecord(value) || value.structuredContent === undefined) return value;
  if (isRecord(value.structuredContent)) return value;
  return {
    ...value,
    structuredContent: { value: value.structuredContent },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
