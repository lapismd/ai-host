import type { AcpSessionState, AcpStartPayload, AgentHostSink } from "./types";

export function retainedSessionMatches(
  session: AcpSessionState,
  payload: AcpStartPayload,
  sink: AgentHostSink,
): boolean {
  return (
    session.appToolBridgeId === payload.appToolBridgeId &&
    session.restricted === (payload.restricted === true) &&
    session.approvalPolicy === payload.approvalPolicy &&
    (session.appToolBridgeId === undefined || session.connectionId === sink.connectionId)
  );
}
