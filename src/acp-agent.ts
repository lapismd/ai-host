export type DesktopAcpAgent = "codex" | "cursor";

export function resolveAcpAgent(payload: {
  agent?: string;
  metadata?: Record<string, unknown>;
}): DesktopAcpAgent {
  const value = payload.agent ?? payload.metadata?.acpAgent;
  return value === "cursor" ? "cursor" : "codex";
}
