import {
  clearPendingApprovalTimers,
  normalizePermissionDecision,
  pendingPermissionsForSession,
  settlePendingPermissions,
} from "./permissions";
import { closeAcpSessionState } from "./session";
import type { ExecutorState } from "./state";
import type {
  AcpPermissionDecision,
  AgentRuntimeExecutor,
} from "./types";

export function createSessionControlCommands(
  state: ExecutorState,
): Pick<
  AgentRuntimeExecutor,
  | "listAcpSessions"
  | "getAcpSessionStatus"
  | "cancelAcpSession"
  | "closeAcpSession"
  | "respondAcpSession"
> {
  return {
    listAcpSessions() {
      return [
        ...new Set([
          ...state.acpSessions.keys(),
          ...state.pendingAcpSessions.keys(),
        ]),
      ].map((id) => this.getAcpSessionStatus(id));
    },

    getAcpSessionStatus(sessionId) {
      const pending = state.pendingAcpSessions.get(sessionId);
      const session = state.acpSessions.get(sessionId) ?? pending?.session;
      if (!session) {
        return {
          sessionId,
          state: "missing",
          latestSequence: 0,
          pendingPermissions: [],
        };
      }
      return {
        sessionId,
        ...(session.permissionMode ? { permissionMode: session.permissionMode } : {}),
        state: pending ? "initializing" : session.running ? "running" : "idle",
        ...(session.currentRunId !== "session"
          ? { runId: session.currentRunId }
          : {}),
        latestSequence: session.nextSequence,
        pendingPermissions: pendingPermissionsForSession(
          state.pendingApprovals,
          sessionId,
        ),
      };
    },

    async cancelAcpSession(sessionId) {
      settlePendingPermissions(state.pendingApprovals, sessionId, {
        outcome: "cancel",
      });
      const session = state.acpSessions.get(sessionId);
      if (session) {
        await session.runtime.cancel({ handle: session.handle });
        return;
      }
      const pending = state.pendingAcpSessions.get(sessionId);
      if (!pending) return;
      for (const prompt of pending.prompts) prompt.cancelled = true;
    },

    async closeAcpSession(sessionId) {
      settlePendingPermissions(state.pendingApprovals, sessionId, {
        outcome: "reject_once",
      });
      const session = state.acpSessions.get(sessionId);
      if (session) {
        await closeAcpSessionState(
          session,
          state.acpSessions,
          state.toolBridges,
        );
        return;
      }
      const pending = state.pendingAcpSessions.get(sessionId);
      if (!pending) return;
      pending.closed = true;
      for (const prompt of pending.prompts) prompt.cancelled = true;
      void pending.ready.then(
        (readySession) =>
          closeAcpSessionState(
            readySession,
            state.acpSessions,
            state.toolBridges,
          ),
        () => undefined,
      );
    },

    respondAcpSession(
      sessionId,
      requestId,
      decision: string | AcpPermissionDecision,
    ) {
      const key = `${sessionId}:${requestId}`;
      const resolve = state.pendingApprovals.get(key);
      if (!resolve) throw new Error(`Unknown ACP approval: ${key}`);
      if (resolve.expiresAt !== undefined && resolve.expiresAt <= Date.now()) {
        state.pendingApprovals.delete(key);
        clearPendingApprovalTimers(resolve);
        resolve({ outcome: "cancel" }, "expired");
        throw new Error("ACP approval expired");
      }
      const normalized = normalizePermissionDecision(decision, resolve.options);
      state.pendingApprovals.delete(key);
      clearPendingApprovalTimers(resolve);
      resolve(normalized);
    },
  };
}
