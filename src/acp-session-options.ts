export type AcpStartSessionFields = {
  model?: { provider?: string; model?: string };
  thinking?: "off" | "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
};

export type AcpxSessionOptions = {
  model?: string;
  systemPrompt?: string | { append: string };
};

export function toAcpxSessionOptions(
  payload: AcpStartSessionFields,
): AcpxSessionOptions {
  const options: AcpxSessionOptions = {};
  if (payload.model?.model) options.model = payload.model.model;
  const manifest = portableAvailableSkillsManifest(payload.metadata);
  if (manifest) options.systemPrompt = { append: manifest };
  return options;
}

export function portableAvailableSkillsManifest(
  metadata?: Record<string, unknown>,
): string | undefined {
  const value = metadata?.availableSkillsManifest;
  if (typeof value !== "string") return undefined;
  const manifest = value.trim();
  if (!manifest.includes("<available_skills>")) return undefined;
  if (hasHostFilesystemPath(manifest)) return undefined;
  return manifest;
}

function hasHostFilesystemPath(value: string): boolean {
  return /(?:(?:^|[\s"'>=])(?:\/|[A-Za-z]:\\|file:\/\/)|\.lapis\/skills\/)/u.test(
    value,
  );
}

export function toAcpxThinkingValue(
  payload: Pick<AcpStartSessionFields, "thinking"> & { agent?: string },
): string | undefined {
  if (!payload.thinking) return undefined;
  if (payload.agent === "codex" && payload.thinking === "off") return "none";
  return payload.thinking;
}
