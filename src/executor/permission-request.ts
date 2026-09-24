import { randomUUID } from "node:crypto";
import { clearPendingApprovalTimers, permissionOptionOutcomes } from "./permissions";
import type { AcpPermissionDecision, AcpStartPayload, AgentRuntimeInputSink, CreateAcpxRuntimeContext, PendingAcpApproval } from "./types";

export interface AcpxPermissionRequest {
  sessionId?: string;
  inferredKind?: string;
  raw?: Record<string, unknown>;
}

export function requestAcpPermission(
  sink: AgentRuntimeInputSink, sessionId: string, payload: AcpStartPayload,
  approvals: Map<string, PendingAcpApproval>, context: CreateAcpxRuntimeContext,
  request: AcpxPermissionRequest, signal?: AbortSignal,
): Promise<AcpPermissionDecision> {
  if (payload.restricted || signal?.aborted) return Promise.resolve({ outcome: "reject_once" });
  const raw = request.raw ?? {};
  const tool = raw.toolCall && typeof raw.toolCall === "object" ? raw.toolCall as Record<string, unknown> : {};
  const requestId = String(tool.toolCallId ?? raw.toolCallId ?? request.sessionId ?? randomUUID());
  const key = `${sessionId}:${requestId}`;
  const options = permissionOptionOutcomes(raw.options);
  if (approvals.has(key) || !options.length || new Set(options).size !== options.length)
    return Promise.resolve({ outcome: "reject_once" });
  const expiresAt = Date.now() + context.permissionTimeoutMs;
  const envelope = {
    requestId, id: requestId, sessionId: request.sessionId, inferredKind: request.inferredKind,
    raw, kind: request.inferredKind ?? tool.kind, title: tool.title,
    toolName: tool.title ?? tool.kind, input: tool.rawInput, options: raw.options, expiresAt,
  };
  return new Promise(resolve => {
    let settled = false;
    const abort = () => pending({ outcome: "reject_once" }, "cancelled");
    const pending: PendingAcpApproval = (decision, state = decision.outcome === "cancel" ? "cancelled" : "resolved") => {
      if (settled) return;
      settled = true;
      if (approvals.get(key) === pending) approvals.delete(key);
      clearPendingApprovalTimers(pending);
      signal?.removeEventListener("abort", abort);
      sink.sendRuntimeEvent({ sessionId, type: "permission", request: { ...envelope, state, decision: decision.outcome } });
      resolve(decision);
    };
    pending.connectionId = context.connectionId;
    pending.expiresAt = expiresAt;
    pending.options = options;
    pending.timeout = setTimeout(() => pending({ outcome: "reject_once" }, "expired"), context.permissionTimeoutMs);
    approvals.set(key, pending);
    signal?.addEventListener("abort", abort, { once: true });
    sink.sendRuntimeEvent({ sessionId, type: "permission", request: { ...envelope, state: "pending" } });
  });
}
