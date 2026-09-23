import type { WebSocket } from "ws";

export const MAX_PENDING_CALLS = 128;
export const MAX_CALL_BYTES = 128 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024;

export type ToolBridgeDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  effect: "read" | "write" | "external";
};

export type ToolBridgeOpenPayload = {
  bindingId: string;
  conversationId: string;
  descriptors: ToolBridgeDescriptor[];
};

export type ToolBridgeCall = {
  bridgeId: string;
  bindingId: string;
  callId: string;
  name: string;
  input: unknown;
};

export type ToolBridgeCancel = Pick<
  ToolBridgeCall,
  "bridgeId" | "bindingId" | "callId"
>;

export type ToolBridgeResponse = {
  bridgeId: string;
  callId: string;
  result?: unknown;
  error?: { code: string; message: string };
};

export type ToolBridgeSink = {
  connectionId: string;
  sendToolCall(call: ToolBridgeCall): void;
  sendToolCancel(cancel: ToolBridgeCancel): void;
};

export type ToolBridgeServerContribution = {
  name: "lapis-tools";
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type ToolBridgeHttpContribution = {
  type: "http";
  name: "lapis-tools";
  url: string;
  headers: Array<{ name: string; value: string }>;
};

export type PendingCall =
  | { kind: "socket"; socket: WebSocket }
  | {
      kind: "local";
      resolve(value: {
        result?: unknown;
        error?: { code: string; message: string };
      }): void;
    };

export type BridgeRecord = {
  id: string;
  token: string;
  bindingId: string;
  conversationId: string;
  connectionId: string;
  descriptors: ToolBridgeDescriptor[];
  sink: ToolBridgeSink;
  sockets: Set<WebSocket>;
  pending: Map<string, PendingCall>;
};

export type ToolBridgeBrokerOptions = {
  shimPath?: string;
  nodeCommand?: string;
  shimArgsPrefix?: string[];
  shimCommand?: { command: string; args: string[] };
  extraEnv?: Record<string, string>;
  listenPort?: number;
  externalHttpBaseUrl?: string;
};
