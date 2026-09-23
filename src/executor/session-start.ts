import { initializeAcpSession } from "./session-lifecycle";
import {
  createAcpSessionState,
  emitRuntimeEvent,
  resolveAcpSessionId,
  resolveSequenceBase,
} from "./session";
import type { ExecutorState } from "./state";
import type {
  AcpSessionState,
  AcpStartPayload,
  AgentHostSink,
  AgentRuntimeExecutor,
  PendingAcpSessionState,
} from "./types";

export function createSessionStartCommands(
  state: ExecutorState,
): Pick<
  AgentRuntimeExecutor,
  "startAcpSession" | "startAcpSessionDeferred"
> {
  return {
    async startAcpSession(sink: AgentHostSink, payload: AcpStartPayload) {
      const sessionId = resolveAcpSessionId(payload);
      const sequenceBase = resolveSequenceBase(payload);
      const pending = state.pendingAcpSessions.get(sessionId);
      if (pending) {
        pending.session.sink = sink;
        pending.session.nextSequence = Math.max(
          pending.session.nextSequence,
          sequenceBase,
        );
        await pending.ready;
        return { sessionId };
      }
      await initializeAcpSession(state, sink, payload, sessionId);
      return { sessionId };
    },

    startAcpSessionDeferred(sink: AgentHostSink, payload: AcpStartPayload) {
      const sessionId = resolveAcpSessionId(payload);
      const existingPending = state.pendingAcpSessions.get(sessionId);
      if (existingPending) {
        existingPending.session.sink = sink;
        return { sessionId };
      }
      const session = createAcpSessionState(
        sessionId,
        sink,
        resolveSequenceBase(payload),
      );
      const pending: PendingAcpSessionState = {
        session,
        prompts: new Set(),
        closed: false,
        ready: new Promise<AcpSessionState>((resolve, reject) => {
          setTimeout(() => {
            void initializeAcpSession(
              state,
              sink,
              payload,
              sessionId,
              session,
            ).then(resolve, reject);
          }, 0);
        }),
      };
      state.pendingAcpSessions.set(sessionId, pending);
      void pending.ready.then(
        () => {
          state.pendingAcpSessions.delete(sessionId);
        },
        (error) => {
          state.pendingAcpSessions.delete(sessionId);
          if (pending.closed) return;
          const runId =
            pending.prompts.values().next().value?.runId ?? "session";
          emitRuntimeEvent(session, runId, {
            sessionId,
            type: "event",
            event: {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        },
      );
      return { sessionId };
    },
  };
}
