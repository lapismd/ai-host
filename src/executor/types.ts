import type { AcpAgentDefinition } from "../acp/acp-agent";
import type { AcpModelEntry } from "../acp/acp-model-catalog";
import type { AcpThinkingValue, AcpxSessionOptions } from "../acp/acp-session-options";
import type { CursorListedModel } from "../inventory/cursor-model-inventory";
import type {
  NativeAgentProcessMessage,
  NativeAgentRuntimeEvent,
  UnsequencedAgentRuntimeEvent,
} from "../protocol/protocol";
import type {
  ToolBridgeCall,
  ToolBridgeCancel,
  ToolBridgeOpenPayload,
  ToolBridgeResponse,
} from "../mcp/tool-bridge";

export type AgentHostSink = {
  connectionId?: string;
  sendRuntimeEvent(event: NativeAgentRuntimeEvent): void;
  sendProcessMessage(event: NativeAgentProcessMessage): void;
  sendToolCall?(call: ToolBridgeCall): void;
  sendToolCancel?(cancel: ToolBridgeCancel): void;
};

export type AgentRuntimeInputSink = {
  sendRuntimeEvent(event: UnsequencedAgentRuntimeEvent): void;
  sendProcessMessage(event: NativeAgentProcessMessage): void;
};

export type SpawnPayload = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  appToolBridgeId?: string;
};

export type AcpStartPayload = {
  sessionId?: string;
  sequenceBase?: number;
  workspace?: string;
  agent?: string;
  model?: { provider?: string; model?: string };
  thinking?: AcpThinkingValue; permissionMode?: string;
  metadata?: Record<string, unknown>;
  mcpServers?: AcpMcpServer[];
  resumeSessionId?: string;
  appToolBridgeId?: string;
  restricted?: boolean;
};

export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      type?: "stdio";
    }
  | {
      name: string;
      type: "http" | "sse";
      url: string;
      headers?: Array<{ name: string; value: string }>;
    };

export type AcpPermissionDecision = {
  outcome:
    "allow_once" | "allow_always" | "reject_once" | "reject_always" | "cancel";
};

export const ACP_MODEL_CATALOG_UNAVAILABLE = "catalog unavailable";

export type AcpModelCatalog = {
  agent: string;
  currentModel?: string;
  models: string[];
  entries: AcpModelEntry[];
  configOptions: AcpConfigOption[];
  error?: string;
};

export type AcpConfigOption = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options?: Array<{ value: string; name: string; description?: string }>;
};

export type AcpAgentCatalogEntry = {
  id: string;
  label: string;
  mcpTransport: "stdio" | "http";
};

export type AcpSessionStatus = {
  sessionId: string;
  state: "initializing" | "idle" | "running" | "missing";
  runId?: string;
  latestSequence: number;
  pendingPermissions: Array<{
    requestId: string;
    expiresAt?: number;
    options: string[];
  }>;
};

export type AcpConfigurationFieldResult = {
  status: "applied" | "unchanged" | "unsupported";
  reason?: string;
};

export type AcpConfigurePayload = {
  sessionId: string;
  model?: { provider?: string; model?: string };
  thinking?: AcpThinkingValue;
};

export type AcpConfigureResult = {
  model?: AcpConfigurationFieldResult;
  thinking?: AcpConfigurationFieldResult;
};

export type { AcpModelEntry } from "../acp/acp-model-catalog";
export type AcpRuntimeHandle = {
  sessionKey: string;
  backend?: string;
  runtimeSessionName?: string;
};

export type AcpxRuntimeLike = {
  ensureSession(input: {
    sessionKey: string;
    agent: string;
    mode: "persistent" | "oneshot";
    cwd?: string;
    resumeSessionId?: string;
    sessionOptions?: AcpxSessionOptions;
  }): Promise<AcpRuntimeHandle>;
  startTurn(input: {
    handle: AcpRuntimeHandle;
    text: string;
    mode: "prompt" | "steer";
    requestId: string;
  }): {
    events: AsyncIterable<{ type: string; [key: string]: unknown }>;
    result: Promise<{
      status: string;
      stopReason?: string;
      error?: { message?: string };
    }>;
  };
  getStatus?(input: { handle: AcpRuntimeHandle }): Promise<{
    models?: {
      currentModelId?: string;
      availableModelIds?: string[];
    };
    details?: {
      configOptions?: unknown;
      [key: string]: unknown;
    };
  }>;
  getCapabilities?(input: {
    handle: AcpRuntimeHandle;
  }):
    Promise<{ configOptionKeys?: string[] }> | { configOptionKeys?: string[] };
  setConfigOption?(input: {
    handle: AcpRuntimeHandle;
    key: string;
    value: string;
  }): Promise<void>;
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;
  close(input: {
    handle: AcpRuntimeHandle;
    reason: string;
    discardPersistentState?: boolean;
  }): Promise<void>;
};

export type PendingAcpApproval = ((decision: AcpPermissionDecision) => void) & {
  connectionId?: string;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  expiresAt?: number;
  options?: string[];
  timeout?: ReturnType<typeof setTimeout>;
};

export type CreateAcpxRuntimeContext = {
  agent: AcpAgentDefinition;
  connectionId?: string;
  permissionTimeoutMs: number;
};

export type CreateAcpxRuntime = (
  sink: AgentRuntimeInputSink,
  sessionId: string,
  payload: AcpStartPayload,
  pendingApprovals: Map<string, PendingAcpApproval>,
  context: CreateAcpxRuntimeContext,
) => Promise<AcpxRuntimeLike>;

export type AgentRuntimeExecutor = {
  spawnProcess(
    sink: AgentHostSink,
    payload: SpawnPayload,
  ): { processId: string };
  writeProcess(processId: string, data: string): void;
  killProcess(processId: string): void;
  startAcpSession(
    sink: AgentHostSink,
    payload: AcpStartPayload,
  ): Promise<{ sessionId: string }>;
  startAcpSessionDeferred(
    sink: AgentHostSink,
    payload: AcpStartPayload,
  ): { sessionId: string };
  listAcpModels(
    sink: AgentHostSink,
    payload: Pick<AcpStartPayload, "workspace" | "agent" | "sessionId">,
  ): Promise<AcpModelCatalog>;
  listAcpAgents(): { agents: AcpAgentCatalogEntry[] };
  getAcpSessionStatus(sessionId: string): AcpSessionStatus;
  /** Read-only operational state; excludes conversation and tool content. */
  listAcpSessions?(): AcpSessionStatus[];
  promptAcpSession(
    sink: AgentHostSink,
    sessionId: string,
    text: string,
  ): Promise<{ runId: string }>;
  promptAcpSessionDeferred(
    sink: AgentHostSink,
    sessionId: string,
    text: string,
  ): { runId: string };
  configureAcpSession(
    payload: AcpConfigurePayload,
  ): Promise<AcpConfigureResult>;
  cancelAcpSession(sessionId: string): Promise<void>;
  closeAcpSession(sessionId: string): Promise<void>;
  respondAcpSession(
    sessionId: string,
    requestId: string,
    decision: string | AcpPermissionDecision,
  ): void;
  openToolBridge(
    sink: AgentHostSink,
    payload: ToolBridgeOpenPayload,
  ): Promise<{ bridgeId: string }>;
  respondToolBridge(sink: AgentHostSink, payload: ToolBridgeResponse): void;
  closeToolBridge(sink: AgentHostSink, bridgeId: string): void;
  disconnectConnection(connectionId: string): void;
  close(): Promise<void>;
};

export type ListAgentInventory = (
  agent: AcpAgentDefinition,
  payload: Pick<AcpStartPayload, "workspace">,
) => Promise<AcpModelCatalog>;

export type ListCursorAvailableModels = (input: {
  agent: AcpAgentDefinition;
  workspace?: string;
}) => Promise<CursorListedModel[]>;
export type AcpSessionState = {
  sessionId: string;
  runtime: AcpxRuntimeLike;
  handle: AcpRuntimeHandle;
  sink: AgentHostSink;
  currentRunId: string;
  nextSequence: number;
  agentId?: string;
  connectionId?: string;
  appToolBridgeId?: string;
  restricted: boolean;
  running: boolean;
};

export type PendingAcpPrompt = {
  runId: string;
  cancelled: boolean;
};

export type PendingAcpSessionState = {
  session: AcpSessionState;
  ready: Promise<AcpSessionState>;
  prompts: Set<PendingAcpPrompt>;
  closed: boolean;
};
