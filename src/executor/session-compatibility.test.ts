import { describe, expect, it } from "vitest";
import { retainedSessionMatches } from "./session-compatibility";
import type { AcpSessionState, AcpStartPayload, AgentHostSink } from "./types";

const sink = { connectionId: "connection-1" } as AgentHostSink;

function session(approvalPolicy: "ask" | "allow-all"): AcpSessionState {
  return {
    sessionId: "session-1",
    restricted: false,
    approvalPolicy,
    connectionId: sink.connectionId,
  } as AcpSessionState;
}

function payload(approvalPolicy: "ask" | "allow-all"): AcpStartPayload {
  return { sessionId: "session-1", approvalPolicy };
}

describe("retained ACP session compatibility", () => {
  it("reuses a session only while its approval policy matches", () => {
    expect(retainedSessionMatches(session("ask"), payload("ask"), sink)).toBe(true);
    expect(
      retainedSessionMatches(session("ask"), payload("allow-all"), sink),
    ).toBe(false);
    expect(
      retainedSessionMatches(session("allow-all"), payload("ask"), sink),
    ).toBe(false);
  });
});
