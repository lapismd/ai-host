import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerToken, tokensEqual } from "./tool-bridge-framing";
import { createLapisMcpServer } from "./tool-bridge-mcp";
import type { BridgeRecord } from "./tool-bridge-types";

export async function handleExternalWebRequest(
  request: Request,
  externalHttpBaseUrl: URL,
  bridges: Map<string, BridgeRecord>,
  invokeLocal: (
    bridge: BridgeRecord,
    name: string,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>,
): Promise<Response | undefined> {
  const requestUrl = new URL(request.url);
  const routePrefix = `${externalHttpBaseUrl.pathname}mcp/`;
  if (!requestUrl.pathname.startsWith(routePrefix)) return undefined;
  const bridgeId = requestUrl.pathname.slice(routePrefix.length);
  if (!bridgeId || bridgeId.includes("/"))
    return new Response(null, { status: 404 });
  const token = bearerToken(
    request.headers.get("authorization") ?? undefined,
  );
  const bridge = bridges.get(bridgeId);
  if (!bridge || !token || !tokensEqual(bridge.token, token)) {
    return new Response(null, { status: 401 });
  }
  const server = createLapisMcpServer(bridge.descriptors, (name, input, signal) =>
    invokeLocal(bridge, name, input, signal),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export async function handleLoopbackMcpHttp(
  req: IncomingMessage,
  res: ServerResponse,
  bridges: Map<string, BridgeRecord>,
  invokeLocal: (
    bridge: BridgeRecord,
    name: string,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>,
): Promise<void> {
  const pathname = new URL(req.url ?? "", "http://127.0.0.1").pathname;
  const match = /^\/mcp\/([^/]+)$/u.exec(pathname);
  if (!match) {
    res.writeHead(404).end();
    return;
  }
  const token = bearerToken(req.headers.authorization);
  const bridge = bridges.get(match[1] ?? "");
  if (!bridge || !token || !tokensEqual(bridge.token, token)) {
    res.writeHead(401).end();
    return;
  }
  const server = createLapisMcpServer(bridge.descriptors, (name, input, signal) =>
    invokeLocal(bridge, name, input, signal),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
