import { randomUUID } from "node:crypto";
import { ACP_THINKING_KEYS } from "../acp/acp-session-options";
import type { ToolBridgeBroker } from "../mcp/tool-bridge";
import type { UnsequencedAgentRuntimeEvent } from "../protocol/protocol";
import type {
  AcpRuntimeHandle,
  AcpSessionState,
  AcpStartPayload,
  AgentHostSink,
  AcpxRuntimeLike,
} from "./types";

export function createAcpSessionState(
  sessionId: string,
  sink: AgentHostSink,
  sequenceBase = 0,
): AcpSessionState {
  return {
    sessionId,
    sink,
    currentRunId: "session",
    nextSequence: sequenceBase,
    runtime: undefined as unknown as AcpxRuntimeLike,
    handle: undefined as unknown as AcpRuntimeHandle,
    restricted: false,
    running: false,
  };
}

export function resolveSequenceBase(payload: AcpStartPayload): number {
  const value = payload.sequenceBase ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("ACP sequence base must be a non-negative safe integer");
  }
  return value;
}

export function resolveAcpSessionId(payload: AcpStartPayload): string {
  const sessionId = payload.sessionId?.trim();
  const resumeSessionId = payload.resumeSessionId?.trim();
  if (payload.restricted && resumeSessionId) {
    throw new Error("Restricted ACP sessions cannot resume persistent state.");
  }
  if (sessionId && resumeSessionId && sessionId !== resumeSessionId) {
    throw new Error(
      "ACP sessionId must match resumeSessionId when both are provided.",
    );
  }
  return sessionId || resumeSessionId || randomUUID();
}

export async function closeAcpSessionState(
  session: AcpSessionState,
  sessions: Map<string, AcpSessionState>,
  toolBridges: ToolBridgeBroker,
): Promise<void> {
  await session.runtime.close({
    handle: session.handle,
    reason: "close",
    discardPersistentState: session.restricted,
  });
  sessions.delete(session.sessionId);
  if (session.connectionId && session.appToolBridgeId) {
    toolBridges.closeBridge(session.connectionId, session.appToolBridgeId);
  }
}

export function emitRuntimeEvent(
  session: AcpSessionState,
  runId: string,
  input: UnsequencedAgentRuntimeEvent,
): void {
  session.nextSequence += 1;
  session.sink.sendRuntimeEvent({
    sessionId: session.sessionId,
    runId,
    sequence: session.nextSequence,
    event: {
      type: input.type,
      event: input.event,
      request: input.request,
    },
  });
}

export async function thinkingConfigurationKey(
  runtime: AcpxRuntimeLike,
  handle: AcpRuntimeHandle,
): Promise<string | undefined> {
  if (!runtime.getCapabilities) return "thinking";
  const capabilities = await runtime.getCapabilities({ handle });
  const keys = capabilities.configOptionKeys ?? [];
  return ACP_THINKING_KEYS.find((key) => keys.includes(key));
}
