export type AcpStartSessionFields = {
  model?: { provider?: string; model?: string };
  thinking?: "off" | "low" | "medium" | "high";
};

export type AcpxSessionOptions = {
  model?: string;
  effort?: "low" | "medium" | "high";
};

export function toAcpxSessionOptions(
  payload: AcpStartSessionFields,
): AcpxSessionOptions {
  const options: AcpxSessionOptions = {};
  if (payload.model?.model) options.model = payload.model.model;
  if (payload.thinking && payload.thinking !== "off") {
    options.effort = payload.thinking;
  }
  return options;
}
