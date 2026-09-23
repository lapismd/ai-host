import {
  requiredConnectionId,
  requiredToolSink,
} from "./mcp-servers";
import {
  clearPendingApprovalTimers,
  settlePendingPermissions,
} from "./permissions";
import { closeAcpSessionState } from "./session";
import type { ExecutorState } from "./state";
import type { AgentRuntimeExecutor } from "./types";

export function createToolCommands(
  state: ExecutorState,
): Pick<
  AgentRuntimeExecutor,
  | "openToolBridge"
  | "respondToolBridge"
  | "closeToolBridge"
  | "disconnectConnection"
  | "close"
> {
  return {
    openToolBridge(sink, payload) {
      return state.toolBridges.open(requiredToolSink(sink), payload);
    },

    respondToolBridge(sink, payload) {
      state.toolBridges.respond(requiredConnectionId(sink), payload);
    },

    closeToolBridge(sink, bridgeId) {
      state.toolBridges.closeBridge(requiredConnectionId(sink), bridgeId);
    },

    disconnectConnection(connectionId) {
      state.toolBridges.closeConnection(connectionId);
      for (const [key, approval] of state.pendingApprovals) {
        if (approval.connectionId !== connectionId) continue;
        clearTimeout(approval.disconnectTimer);
        approval.disconnectTimer = setTimeout(() => {
          if (!state.pendingApprovals.delete(key)) return;
          clearPendingApprovalTimers(approval);
          approval({ outcome: "reject_once" });
        }, state.disconnectGraceMs);
      }
    },

    async close() {
      settlePendingPermissions(state.pendingApprovals, undefined, {
        outcome: "reject_once",
      });
      for (const child of state.processes.values()) child.kill();
      state.processes.clear();
      state.processBridges.clear();
      for (const pending of state.pendingAcpSessions.values()) {
        pending.closed = true;
        for (const prompt of pending.prompts) prompt.cancelled = true;
        void pending.ready.then(
          (session) =>
            closeAcpSessionState(
              session,
              state.acpSessions,
              state.toolBridges,
            ),
          () => undefined,
        );
      }
      for (const session of [...state.acpSessions.values()]) {
        await closeAcpSessionState(
          session,
          state.acpSessions,
          state.toolBridges,
        );
      }
      await state.toolBridges.close();
    },
  };
}
