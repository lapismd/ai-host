import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AcpAgentRegistry } from "../acp/acp-agent";
import type { ToolBridgeBroker } from "../mcp/tool-bridge";
import type {
  AcpModelCatalog,
  AcpSessionState,
  CreateAcpxRuntime,
  ListAgentInventory,
  ListCursorAvailableModels,
  PendingAcpApproval,
  PendingAcpSessionState,
} from "./types";

export type ExecutorState = {
  processes: Map<string, ChildProcessWithoutNullStreams>;
  processBridges: Map<string, { connectionId: string; bridgeId: string }>;
  acpSessions: Map<string, AcpSessionState>;
  pendingAcpSessions: Map<string, PendingAcpSessionState>;
  pendingApprovals: Map<string, PendingAcpApproval>;
  lastGoodCatalogs: Map<string, AcpModelCatalog>;
  catalogRefresh: Map<string, Promise<void>>;
  cursorEnrichment: Map<string, Promise<void>>;
  createAcpx: CreateAcpxRuntime;
  listAgentInventory: ListAgentInventory;
  listCursorAvailableModels: ListCursorAvailableModels;
  agentRegistry: AcpAgentRegistry;
  permissionTimeoutMs: number;
  disconnectGraceMs: number;
  toolBridges: ToolBridgeBroker;
};
