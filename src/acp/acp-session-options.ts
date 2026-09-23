export type AcpThinkingValue = "off" | "low" | "medium" | "high" | "xhigh";

export const ACP_THINKING_VALUES = [
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const ACP_THINKING_KEYS = [
  "thinking",
  "effort",
  "reasoning_effort",
  "variant",
] as const;

export const ACP_THINKING_NAMES: Record<AcpThinkingValue, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

export type AcpStartSessionFields = {
  agent?: string;
  model?: { provider?: string; model?: string };
  thinking?: AcpThinkingValue;
  metadata?: Record<string, unknown>;
};

export function isAcpThinkingValue(value: string): value is AcpThinkingValue {
  return (ACP_THINKING_VALUES as readonly string[]).includes(value);
}

export function parseAcpThinkingValue(
  value: unknown,
): AcpThinkingValue | undefined {
  const text =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : undefined;
  if (!text) return undefined;
  if (text === "none") return "off";
  return isAcpThinkingValue(text) ? text : undefined;
}

export function uniqueThinkingValues(
  values: readonly (AcpThinkingValue | undefined)[],
): AcpThinkingValue[] {
  const unique: AcpThinkingValue[] = [];
  for (const value of values) {
    if (value && !unique.includes(value)) unique.push(value);
  }
  return unique;
}

export function stripCursorModelId(model: string): string {
  const trimmed = model.trim();
  const bracket = trimmed.indexOf("[");
  return bracket >= 0 ? trimmed.slice(0, bracket) : trimmed;
}

export function advertisedCursorEffort(
  model: string,
): AcpThinkingValue | undefined {
  const match = model.trim().match(/\[(.*)\]$/u);
  if (!match) return;
  for (const part of match[1].split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== "effort" && key !== "reasoning") continue;
    return parseAcpThinkingValue(part.slice(separator + 1));
  }
}

export type AcpxSessionOptions = {
  model?: string;
  systemPrompt?: string | { append: string };
};

export function toAcpxSessionOptions(
  payload: AcpStartSessionFields,
): AcpxSessionOptions {
  const options: AcpxSessionOptions = {};
  if (payload.model?.model) {
    options.model =
      payload.agent === "cursor"
        ? stripCursorModelId(payload.model.model)
        : payload.model.model;
  }
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
  if (!bootstrap) return undefined;
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

export function vcsEnvironment(
  payload: AcpStartSessionFields,
): Record<string, string> | undefined {
  if (payload.metadata?.vcsIdentity !== undefined) {
    const identity = payload.metadata.vcsIdentity as {
      name?: unknown;
      email?: unknown;
    } | null;
    if (
      !identity ||
      typeof identity.name !== "string" ||
      typeof identity.email !== "string" ||
      !identity.name.trim() ||
      !identity.email.trim() ||
      identity.name.length > 256 ||
      identity.email.length > 320 ||
      /[\r\n\0]/u.test(identity.name + identity.email)
    )
      throw new Error("Invalid VCS identity");
    return {
      JJ_USER: identity.name,
      JJ_EMAIL: identity.email,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    };
  }
  return undefined;
}
