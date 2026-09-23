import { resolveAcpAgent, type AcpAgentRegistry } from "../acp/acp-agent";
import type { ToolBridgeBroker, ToolBridgeSink } from "../mcp/tool-bridge";
import type { AcpMcpServer, AcpStartPayload, AgentHostSink } from "./types";

export function requiredConnectionId(sink: AgentHostSink): string {
  if (!sink.connectionId)
    throw new Error("Agent host connection identity missing");
  return sink.connectionId;
}

export function requiredToolSink(sink: AgentHostSink): ToolBridgeSink {
  if (!sink.sendToolCall || !sink.sendToolCancel) {
    throw new Error("Agent host does not support app tool events");
  }
  return {
    connectionId: requiredConnectionId(sink),
    sendToolCall: sink.sendToolCall,
    sendToolCancel: sink.sendToolCancel,
  };
}

export function withAppToolMcpServer(
  payload: AcpStartPayload,
  sink: AgentHostSink,
  broker: ToolBridgeBroker,
  registry: AcpAgentRegistry,
): AcpStartPayload {
  if (
    (payload.mcpServers ?? []).some((server) => server.name === "lapis-tools")
  ) {
    throw new Error("MCP server name is reserved: lapis-tools");
  }
  if (!payload.appToolBridgeId) return payload;
  const connectionId = requiredConnectionId(sink);
  const appServer =
    resolveAcpAgent(payload, registry).mcpTransport === "http"
      ? broker.httpServerContribution(connectionId, payload.appToolBridgeId)
      : broker.serverContribution(connectionId, payload.appToolBridgeId);
  return {
    ...payload,
    mcpServers: [...(payload.mcpServers ?? []), appServer],
  };
}

export function restrictedAcpPayload(payload: AcpStartPayload): AcpStartPayload {
  return {
    ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    ...(payload.agent ? { agent: payload.agent } : {}),
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.thinking ? { thinking: payload.thinking } : {}),
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
    restricted: true,
    mcpServers: [],
  };
}

export function toAcpxMcpServers(servers: AcpStartPayload["mcpServers"]): Array<
  | {
      type: "stdio";
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      type: "http" | "sse";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    }
> {
  return (servers ?? []).map((server) =>
    isHttpMcpServer(server)
      ? {
          type: server.type,
          name: server.name,
          url: server.url,
          headers: [...(server.headers ?? [])],
        }
      : {
          type: "stdio" as const,
          name: server.name,
          command: server.command,
          args: server.args ?? [],
          env: Object.entries(server.env ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
        },
  );
}

export function isHttpMcpServer(
  server: AcpMcpServer,
): server is Extract<AcpMcpServer, { type: "http" | "sse" }> {
  return server.type === "http" || server.type === "sse";
}

export function nativeProcessArgs(
  args: string[],
  bridge: ReturnType<ToolBridgeBroker["serverContribution"]> | undefined,
): string[] {
  if (!bridge) return args;
  return [
    ...args,
    "-c",
    `mcp_servers.${bridge.name}.command=${JSON.stringify(bridge.command)}`,
    "-c",
    `mcp_servers.${bridge.name}.args=${JSON.stringify(bridge.args)}`,
    "-c",
    `mcp_servers.${bridge.name}.env_vars=${JSON.stringify(Object.keys(bridge.env))}`,
    "-c",
    `mcp_servers.${bridge.name}.required=true`,
  ];
}

export function closeProcessBridge(
  processId: string,
  processBridges: Map<string, { connectionId: string; bridgeId: string }>,
  broker: ToolBridgeBroker,
): void {
  const bridge = processBridges.get(processId);
  processBridges.delete(processId);
  if (bridge) broker.closeBridge(bridge.connectionId, bridge.bridgeId);
}
