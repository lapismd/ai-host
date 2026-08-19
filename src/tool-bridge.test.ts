import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolBridgeBroker, type ToolBridgeCall } from "./tool-bridge";

describe("app tool stdio bridge", () => {
  let broker: ToolBridgeBroker | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await broker?.close();
    client = undefined;
    broker = undefined;
  });

  it("lists and calls a snapshotted app tool through a real MCP shim", async () => {
    broker = new ToolBridgeBroker({
      shimPath: new URL("./mcp-shim.ts", import.meta.url).pathname,
      shimArgsPrefix: ["--import", "tsx"],
    });
    const onCall = vi.fn((call: ToolBridgeCall) => {
      broker!.respond("renderer-1", {
        bridgeId: call.bridgeId,
        callId: call.callId,
        result: {
          content: [{ type: "text", text: `read:${String(call.input)}` }],
          structuredContent: { ok: true },
        },
      });
    });
    const opened = await broker.open(
      {
        connectionId: "renderer-1",
        sendToolCall: onCall,
        sendToolCancel: vi.fn(),
      },
      {
        bindingId: "binding-1",
        conversationId: "conversation-1",
        descriptors: [
          {
            name: "notes_read",
            description: "Read a note",
            inputSchema: { type: "object" },
            effect: "read",
          },
        ],
      },
    );
    const contribution = broker.serverContribution(
      "renderer-1",
      opened.bridgeId,
    );
    const transport = new StdioClientTransport({
      command: contribution.command,
      args: contribution.args,
      env: { ...getDefaultEnvironment(), ...contribution.env },
      stderr: "pipe",
    });
    client = new Client({ name: "bridge-test", version: "1.0.0" });
    await client.connect(transport);

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: "notes_read", description: "Read a note" }],
    });
    await expect(
      client.callTool({ name: "notes_read", arguments: { path: "note.md" } }),
    ).resolves.toMatchObject({
      content: [{ type: "text" }],
      structuredContent: { ok: true },
    });
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "binding-1",
        name: "notes_read",
        input: { path: "note.md" },
      }),
    );
  });

  it("lists and calls a snapshotted app tool through Streamable HTTP", async () => {
    broker = new ToolBridgeBroker();
    const onCall = vi.fn((call: ToolBridgeCall) => {
      broker!.respond("renderer-1", {
        bridgeId: call.bridgeId,
        callId: call.callId,
        result: {
          content: [{ type: "text", text: `search:${String(call.input)}` }],
          structuredContent: { ok: true },
        },
      });
    });
    const opened = await broker.open(
      {
        connectionId: "renderer-1",
        sendToolCall: onCall,
        sendToolCancel: vi.fn(),
      },
      {
        bindingId: "binding-1",
        conversationId: "conversation-1",
        descriptors: [
          {
            name: "notes_search",
            description: "Search notes",
            inputSchema: { type: "object" },
            effect: "read",
          },
        ],
      },
    );
    const contribution = broker.httpServerContribution(
      "renderer-1",
      opened.bridgeId,
    );
    const transport = new StreamableHTTPClientTransport(new URL(contribution.url), {
      requestInit: {
        headers: Object.fromEntries(
          contribution.headers.map((header) => [header.name, header.value]),
        ),
      },
    });
    client = new Client({ name: "bridge-http-test", version: "1.0.0" });
    await client.connect(transport);

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: "notes_search", description: "Search notes" }],
    });
    await expect(
      client.callTool({
        name: "notes_search",
        arguments: { query: "automation" },
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text" }],
      structuredContent: { ok: true },
    });
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "binding-1",
        name: "notes_search",
        input: { query: "automation" },
      }),
    );
  });

  it("rejects cross-connection access and reserved duplicates", async () => {
    broker = new ToolBridgeBroker();
    const opened = await broker.open(
      {
        connectionId: "renderer-1",
        sendToolCall: vi.fn(),
        sendToolCancel: vi.fn(),
      },
      {
        bindingId: "binding-1",
        conversationId: "conversation-1",
        descriptors: [],
      },
    );

    expect(() =>
      broker!.serverContribution("renderer-2", opened.bridgeId),
    ).toThrow("Unknown app tool bridge");
  });
});
