export type AcpStartSessionFields = {
  model?: { provider?: string; model?: string };
  thinking?: "off" | "low" | "medium" | "high";
};

export type AcpxSessionOptions = {
  model?: string;
};

export function toAcpxSessionOptions(
  payload: AcpStartSessionFields,
): AcpxSessionOptions {
  const options: AcpxSessionOptions = {};
  if (payload.model?.model) options.model = payload.model.model;
  return options;
}

export function toAcpxThinkingValue(
  payload: Pick<AcpStartSessionFields, "thinking"> & { agent?: string },
): string | undefined {
  if (!payload.thinking) return undefined;
  if (payload.agent === "codex" && payload.thinking === "off") return "none";
  return payload.thinking;
}
