import { createAcpAgentRegistry, type AcpAgentRegistry } from "../acp/acp-agent";
import { listAcpAgentInventory } from "../inventory/acp-model-inventory";
import { listCursorAvailableModelsViaAcp } from "../inventory/cursor-model-inventory";
import {
  ToolBridgeBroker,
  type ToolBridgeBrokerOptions,
} from "../mcp/tool-bridge";
import { defaultCreateAcpxRuntime } from "./acpx-runtime";
import { createCatalogCommands } from "./catalog-commands";
import { createProcessCommands } from "./process-commands";
import { normalizePositiveDuration } from "./permissions";
import { createSessionConfigureCommands } from "./session-configure";
import { createSessionControlCommands } from "./session-control";
import { createSessionPromptCommands } from "./session-prompt";
import { createSessionStartCommands } from "./session-start";
import type { ExecutorState } from "./state";
import { createToolCommands } from "./tool-commands";
import { WorkerProcessRegistry } from "./worker-resources";
import type {
  AgentRuntimeExecutor,
  CreateAcpxRuntime,
  ListAgentInventory,
  ListCursorAvailableModels,
} from "./types";

export {
  ACP_MODEL_CATALOG_UNAVAILABLE,
  type AcpAgentCatalogEntry,
  type AcpConfigOption,
  type AcpConfigurationFieldResult,
  type AcpConfigurePayload,
  type AcpConfigureResult,
  type AcpMcpServer,
  type AcpModelCatalog,
  type AcpModelEntry,
  type AcpPermissionDecision,
  type AcpSessionStatus,
  type AcpStartPayload,
  type AcpxRuntimeLike,
  type AgentHostSink,
  type AgentRuntimeExecutor,
  type AgentRuntimeInputSink,
  type CreateAcpxRuntime,
  type CreateAcpxRuntimeContext,
  type ListAgentInventory,
  type ListCursorAvailableModels,
  type SpawnPayload,
} from "./types";
export { parseAcpConfigOptions } from "./catalog";
export { defaultCreateAcpxRuntime } from "./acpx-runtime";
export { toAcpxMcpServers } from "./mcp-servers";
export { normalizePermissionDecision } from "./permissions";

export function createAgentRuntimeExecutor(options?: {
  createAcpxRuntime?: CreateAcpxRuntime;
  listAgentInventory?: ListAgentInventory;
  listCursorAvailableModels?: ListCursorAvailableModels;
  agentRegistry?: AcpAgentRegistry;
  permissionTimeoutMs?: number;
  disconnectGraceMs?: number;
  toolBridgeBroker?: ToolBridgeBroker;
  toolBridgeOptions?: ToolBridgeBrokerOptions;
}): AgentRuntimeExecutor {
  const state: ExecutorState = {
    processes: new Map(),
    processBridges: new Map(),
    acpSessions: new Map(),
    pendingAcpSessions: new Map(),
    pendingApprovals: new Map(),
    workerProcesses: new WorkerProcessRegistry(),
    lastGoodCatalogs: new Map(),
    catalogRefresh: new Map(),
    cursorEnrichment: new Map(),
    createAcpx: options?.createAcpxRuntime ?? defaultCreateAcpxRuntime,
    listAgentInventory:
      options?.listAgentInventory ??
      ((agent, payload) =>
        listAcpAgentInventory(agent, { workspace: payload.workspace })),
    listCursorAvailableModels:
      options?.listCursorAvailableModels ??
      (options?.createAcpxRuntime
        ? async () => []
        : listCursorAvailableModelsViaAcp),
    agentRegistry: options?.agentRegistry ?? createAcpAgentRegistry(),
    permissionTimeoutMs: normalizePositiveDuration(
      options?.permissionTimeoutMs,
      15 * 60_000,
    ),
    disconnectGraceMs: normalizePositiveDuration(
      options?.disconnectGraceMs,
      60_000,
    ),
    toolBridges:
      options?.toolBridgeBroker ??
      new ToolBridgeBroker(options?.toolBridgeOptions),
  };
  return {
    ...createProcessCommands(state),
    ...createSessionStartCommands(state),
    ...createCatalogCommands(state),
    ...createSessionPromptCommands(state),
    ...createSessionConfigureCommands(state),
    ...createSessionControlCommands(state),
    ...createToolCommands(state),
    snapshotAcpResources: async () => state.workerProcesses.snapshot(
      [...state.acpSessions.values(), ...state.pendingAcpSessions.values()]
        .map((entry) => "session" in entry ? entry.session : entry)
        .map((session) => ({
          sessionId: session.sessionId,
          state: state.pendingAcpSessions.has(session.sessionId)
            ? "initializing" as const
            : session.running ? "running" as const : "idle" as const,
        })),
    ),
  };
}
