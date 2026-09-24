import { stripCursorModelId } from "../acp/acp-session-options";
import type {
  AcpPermissionDecision,
  AcpSessionStatus,
  PendingAcpApproval,
} from "./types";

export function normalizePermissionDecision(
  decision: string | AcpPermissionDecision,
  offeredOutcomes?: readonly string[],
): AcpPermissionDecision {
  const outcome = typeof decision === "string" ? decision : decision.outcome;
  if (!PERMISSION_OUTCOMES.has(outcome)) {
    throw new Error(`Invalid ACP permission decision: ${outcome}`);
  }
  if (
    outcome !== "cancel" &&
    offeredOutcomes &&
    !offeredOutcomes.includes(outcome)
  ) {
    throw new Error(`ACP permission decision was not offered: ${outcome}`);
  }
  return { outcome } as AcpPermissionDecision;
}

export const PERMISSION_OUTCOMES = new Set([
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
  "cancel",
]);

export function permissionOptionOutcomes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const kind = (option as Record<string, unknown>).kind;
    return typeof kind === "string" && PERMISSION_OUTCOMES.has(kind)
      ? [kind]
      : [];
  });
}

export function clearPendingApprovalTimers(approval: PendingAcpApproval): void {
  clearTimeout(approval.timeout);
  clearTimeout(approval.disconnectTimer);
}

export function settlePendingPermissions(
  approvals: Map<string, PendingAcpApproval>,
  sessionId: string | undefined,
  decision: AcpPermissionDecision,
): void {
  const prefix = sessionId === undefined ? undefined : `${sessionId}:`;
  for (const [key, approval] of approvals) {
    if (prefix !== undefined && !key.startsWith(prefix)) continue;
    approvals.delete(key);
    clearPendingApprovalTimers(approval);
    approval(decision, "cancelled");
  }
}

export function pendingPermissionsForSession(
  approvals: Map<string, PendingAcpApproval>,
  sessionId: string,
): AcpSessionStatus["pendingPermissions"] {
  const prefix = `${sessionId}:`;
  return [...approvals.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, approval]) => ({
      requestId: key.slice(prefix.length),
      ...(approval.expiresAt === undefined
        ? {}
        : { expiresAt: approval.expiresAt }),
      options: [...(approval.options ?? [])],
    }));
}

export function normalizePositiveDuration(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

export function isCursorAutoModel(agentId: string, model: string): boolean {
  return agentId === "cursor" && stripCursorModelId(model).toLowerCase() === "auto";
}
