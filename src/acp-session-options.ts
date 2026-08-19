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
  const parts = [
    portableSessionBootstrap(payload.metadata),
    portableAvailableSkillsManifest(payload.metadata),
  ].filter((part): part is string => Boolean(part));
  if (parts.length > 0) options.systemPrompt = { append: parts.join("\n\n") };
  return options;
}

export function portableSessionBootstrap(
  metadata?: Record<string, unknown>,
): string | undefined {
  const value = metadata?.sessionBootstrap;
  if (typeof value !== "string") return undefined;
  const bootstrap = value.trim();
  if (!bootstrap.includes("<lapis_context>")) return undefined;
  if (hasHostFilesystemPath(bootstrap)) return undefined;
  return bootstrap;
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
  return /(?:(?:^|[\s"'>=])(?:\/|[A-Za-z]:\\|file:\/\/)|\.lapis\/skills\/|\.agents\/(?:user\/)?skills\/)/u.test(
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
