import { randomUUID } from "node:crypto";
import { promptAcpSessionNow } from "./session-lifecycle";
import { createAcpSessionState, emitRuntimeEvent } from "./session";
import type { ExecutorState } from "./state";
import type { AgentHostSink, AgentRuntimeExecutor } from "./types";

export function createSessionPromptCommands(
  state: ExecutorState,
): Pick<
  AgentRuntimeExecutor,
  "promptAcpSession" | "promptAcpSessionDeferred"
> {
  return {
    async promptAcpSession(
      sink: AgentHostSink,
      sessionId: string,
      text: string,
    ) {
      const runId = randomUUID();
      promptAcpSessionNow(state, sink, sessionId, text, runId);
      return { runId };
    },

    promptAcpSessionDeferred(
      sink: AgentHostSink,
      sessionId: string,
      text: string,
    ) {
      const runId = randomUUID();
      setTimeout(() => {
        try {
          promptAcpSessionNow(state, sink, sessionId, text, runId);
        } catch (error) {
          const session =
            state.acpSessions.get(sessionId) ??
            state.pendingAcpSessions.get(sessionId)?.session ??
            createAcpSessionState(sessionId, sink);
          emitRuntimeEvent(session, runId, {
            sessionId,
            type: "event",
            event: {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }, 0);
      return { runId };
    },
  };
}
