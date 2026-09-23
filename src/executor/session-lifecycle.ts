import { resolveAcpAgent, type AcpAgentDefinition } from "../acp/acp-agent";
import { toAcpxSessionOptions } from "../acp/acp-session-options";
import { applyStartupConfiguration } from "./session-startup-config";
import { mergeCursorAvailableModels } from "../inventory/acp-model-inventory";
import { rememberLastGoodCatalog } from "./catalog";
import { restrictedAcpPayload, withAppToolMcpServer } from "./mcp-servers";
import { settlePendingPermissions } from "./permissions";
import {
  createAcpSessionState,
  emitRuntimeEvent,
  resolveSequenceBase,
} from "./session";
import type { ExecutorState } from "./state";
import type {
  AcpModelCatalog,
  AcpSessionState,
  AcpStartPayload,
  AgentHostSink,
  AgentRuntimeInputSink,
  PendingAcpPrompt,
} from "./types";

export function finishCursorCatalog(
  state: ExecutorState,
  agent: AcpAgentDefinition,
  catalog: AcpModelCatalog,
  workspace?: string,
): AcpModelCatalog {
  if (
    agent.id === "cursor" &&
    catalog.models.length > 0 &&
    !catalog.entries.some((entry) => (entry.thinkingValues?.length ?? 0) > 0) &&
    !state.cursorEnrichment.has(agent.id)
  ) {
    const work = Promise.resolve()
      .then(() => state.listCursorAvailableModels({ agent, workspace }))
      .then((available) => {
        if (available.length === 0) return;
        const base = state.lastGoodCatalogs.get(agent.id) ?? catalog;
        rememberLastGoodCatalog(
          state.lastGoodCatalogs,
          mergeCursorAvailableModels(base, available),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        state.cursorEnrichment.delete(agent.id);
      });
    state.cursorEnrichment.set(agent.id, work);
  }
  return catalog;
}

export async function initializeAcpSession(
  state: ExecutorState,
  sink: AgentHostSink,
  payload: AcpStartPayload,
  sessionId: string,
  initialState?: AcpSessionState,
): Promise<AcpSessionState> {
  const sequenceBase = resolveSequenceBase(payload);
  const existing = state.acpSessions.get(sessionId);
  if (existing) {
    if (
      existing.appToolBridgeId !== payload.appToolBridgeId ||
      existing.restricted !== (payload.restricted === true) ||
      (existing.appToolBridgeId !== undefined &&
        existing.connectionId !== sink.connectionId)
    ) {
      settlePendingPermissions(state.pendingApprovals, sessionId, {
        outcome: "reject_once",
      });
      await existing.runtime.close({
        handle: existing.handle,
        reason: "app tool bridge changed",
      });
      state.acpSessions.delete(sessionId);
      if (existing.connectionId && existing.appToolBridgeId) {
        state.toolBridges.closeBridge(
          existing.connectionId,
          existing.appToolBridgeId,
        );
      }
    } else {
      existing.sink = sink;
      existing.nextSequence = Math.max(existing.nextSequence, sequenceBase);
      return existing;
    }
  }
  const effectivePayload = payload.restricted
    ? restrictedAcpPayload(payload)
    : withAppToolMcpServer(
        payload,
        sink,
        state.toolBridges,
        state.agentRegistry,
      );
  const agent = resolveAcpAgent(effectivePayload, state.agentRegistry);
  const session =
    initialState ?? createAcpSessionState(sessionId, sink, sequenceBase);
  session.nextSequence = Math.max(session.nextSequence, sequenceBase);
  session.sink = sink;
  const runtimeSink: AgentRuntimeInputSink = {
    sendRuntimeEvent(event) {
      emitRuntimeEvent(session, session.currentRunId, event);
    },
    sendProcessMessage(event) {
      session.sink.sendProcessMessage(event);
    },
  };
  const runtime = await state.createAcpx(
    runtimeSink,
    sessionId,
    effectivePayload,
    state.pendingApprovals,
    {
      agent,
      connectionId: sink.connectionId,
      permissionTimeoutMs: state.permissionTimeoutMs,
    },
  );
  const handle = await runtime.ensureSession({
    sessionKey: sessionId,
    agent: agent.id,
    mode: effectivePayload.restricted ? "oneshot" : "persistent",
    cwd: effectivePayload.workspace,
    sessionOptions: toAcpxSessionOptions({
      ...effectivePayload,
      agent: agent.id,
    }),
  });
  await applyStartupConfiguration({
    runtime,
    handle,
    payload: effectivePayload,
    agentId: agent.id,
    resumeSessionId: payload.resumeSessionId,
  });
  session.runtime = runtime;
  session.handle = handle;
  session.agentId = agent.id;
  session.connectionId = sink.connectionId;
  session.appToolBridgeId = effectivePayload.appToolBridgeId;
  session.restricted = effectivePayload.restricted === true;
  state.acpSessions.set(sessionId, session);
  return session;
}

export function beginAcpTurn(
  state: ExecutorState,
  session: AcpSessionState,
  sink: AgentHostSink,
  text: string,
  runId: string,
): void {
  if (session.running) {
    throw new Error(
      `ACP session already has an active turn: ${session.sessionId}`,
    );
  }
  session.sink = sink;
  session.currentRunId = runId;
  session.running = true;
  let turn: ReturnType<AcpSessionState["runtime"]["startTurn"]>;
  try {
    turn = session.runtime.startTurn({
      handle: session.handle,
      text,
      mode: "prompt",
      requestId: runId,
    });
  } catch (error) {
    session.running = false;
    throw error;
  }
  void (async () => {
    try {
      emitRuntimeEvent(session, runId, {
        sessionId: session.sessionId,
        type: "event",
        event: {
          type: "capture_coverage",
          version: 1,
          source: "acpx",
          observations: "normalized",
          sessionStorage: "volatile",
          excluded: [
            "native-agent-storage",
            "native-provider-traffic",
            "unexposed-acp-updates",
          ],
        },
      });
      for await (const event of turn.events) {
        emitRuntimeEvent(session, runId, {
          sessionId: session.sessionId,
          type: "event",
          event,
        });
      }
      const result = await turn.result;
      if (result.status === "failed") {
        emitRuntimeEvent(session, runId, {
          sessionId: session.sessionId,
          type: "event",
          event: {
            type: "error",
            message: result.error?.message ?? "ACP turn failed",
          },
        });
        session.running = false;
        return;
      }
      emitRuntimeEvent(session, runId, {
        sessionId: session.sessionId,
        type: "event",
        event: {
          type: "done",
          stopReason: result.stopReason ?? result.status,
        },
      });
      session.running = false;
    } catch (error) {
      settlePendingPermissions(state.pendingApprovals, session.sessionId, {
        outcome: "reject_once",
      });
      emitRuntimeEvent(session, runId, {
        sessionId: session.sessionId,
        type: "event",
        event: {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      session.running = false;
    }
  })();
}

export function promptAcpSessionNow(
  state: ExecutorState,
  sink: AgentHostSink,
  sessionId: string,
  text: string,
  runId: string,
): void {
  const session = state.acpSessions.get(sessionId);
  if (session) {
    beginAcpTurn(state, session, sink, text, runId);
    return;
  }
  const pending = state.pendingAcpSessions.get(sessionId);
  if (!pending) throw new Error(`Unknown ACP session: ${sessionId}`);
  pending.session.sink = sink;
  pending.session.currentRunId = runId;
  const prompt: PendingAcpPrompt = { runId, cancelled: false };
  pending.prompts.add(prompt);
  void pending.ready.then(
    (readySession) => {
      pending.prompts.delete(prompt);
      if (!prompt.cancelled && !pending.closed) {
        beginAcpTurn(state, readySession, sink, text, runId);
      }
    },
    () => {
      pending.prompts.delete(prompt);
    },
  );
}
