import type {
  CommandResult,
  HelloOk,
  NativeAgentRuntimeEvent,
  ProcessMessageFrame,
  RuntimeEventFrame,
  ToolCallFrame,
  ToolCancelFrame,
} from "../protocol/protocol";
import { toolCallKey, type ClientRuntimeState } from "./runtime-client-types";

export function handleClientFrame(
  state: ClientRuntimeState,
  data: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const record = parsed as Record<string, unknown>;
  if (record.type === "agent-runtime-event") {
    const frame = parsed as RuntimeEventFrame;
    const previous = state.receivedSessions.get(frame.event.sessionId);
    if (previous != null && frame.event.sequence <= previous) return;
    if (previous != null && frame.event.sequence > previous + 1) {
      state.receivedSessions.set(frame.event.sessionId, frame.event.sequence);
      if (!state.options.manualAcknowledgement) {
        state.activeSessions.set(frame.event.sessionId, frame.event.sequence);
      }
      notifyReplayGap(
        state,
        frame.event.sessionId,
        previous,
        frame.event.sequence,
      );
      return;
    }
    state.receivedSessions.set(frame.event.sessionId, frame.event.sequence);
    if (!state.options.manualAcknowledgement) {
      state.activeSessions.set(frame.event.sessionId, frame.event.sequence);
    }
    for (const listener of state.runtimeListeners) listener(frame.event);
    return;
  }
  if (record.type === "agent-process-message") {
    const frame = parsed as ProcessMessageFrame;
    for (const listener of state.processListeners) listener(frame.event);
    return;
  }
  if (record.type === "desktop_agent_tool_call") {
    const frame = parsed as ToolCallFrame;
    state.activeToolCalls.set(toolCallKey(frame.event), frame.event);
    for (const listener of state.toolCallListeners) listener(frame.event);
    return;
  }
  if (record.type === "desktop_agent_tool_cancel") {
    const frame = parsed as ToolCancelFrame;
    state.activeToolCalls.delete(toolCallKey(frame.event));
    for (const listener of state.toolCancelListeners) listener(frame.event);
    return;
  }
  if (typeof record.id === "string") {
    const waiter = state.pending.get(record.id);
    if (!waiter) return;
    state.pending.delete(record.id);
    const result = parsed as CommandResult & Partial<HelloOk>;
    if (result.error) {
      waiter.reject(new Error(result.error.message));
      return;
    }
    waiter.resolve(result.result ?? result);
  }
}

export function notifyReplayGap(
  state: ClientRuntimeState,
  sessionId: string,
  afterSequence: number,
  receivedSequence: number,
): void {
  if ((state.replayGapSequences.get(sessionId) ?? -1) >= receivedSequence)
    return;
  state.replayGapSequences.set(sessionId, receivedSequence);
  const message =
    `Agent-runtime replay gap after sequence ${afterSequence}; ` +
    "the interrupted turn was not resent because it may have caused side effects.";
  const event: NativeAgentRuntimeEvent = {
    sessionId,
    runId: "replay-gap",
    sequence: receivedSequence,
    event: {
      type: "closed",
      event: {
        type: "error",
        code: "AGENT_RUNTIME_REPLAY_GAP",
        message,
      },
    },
  };
  for (const listener of state.runtimeListeners) listener(event);
}
