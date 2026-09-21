import {
  ACP_THINKING_NAMES,
  type AcpThinkingValue,
} from "./acp-session-options";

export type AcpModelEntry = {
  id: string;
  label: string;
  badges?: string[];
  thinkingValues?: AcpThinkingValue[];
};

const EFFORT_BADGES: Record<string, string> = {
  ...ACP_THINKING_NAMES,
  low: "Low",
  medium: "Medium",
  high: "High",
};

function parseBracketAttributes(
  raw: string,
): { label: string; attrs: Record<string, string> } {
  const match = raw.match(/^([^[]+)\[(.*)\]$/u);
  if (!match) {
    return { label: raw, attrs: {} };
  }
  const attrs: Record<string, string> = {};
  for (const part of match[2].split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) attrs[key] = value;
  }
  return { label: match[1].trim() || raw, attrs };
}

function badgesFromAttributes(attrs: Record<string, string>): string[] {
  const badges: string[] = [];
  if (attrs.fast === "true") badges.push("Fast");
  const effort = attrs.effort ?? attrs.reasoning;
  if (effort && EFFORT_BADGES[effort]) {
    badges.push(EFFORT_BADGES[effort]);
  }
  if (badges.length === 0 && attrs.thinking === "true") {
    badges.push("Thinking");
  }
  return badges;
}

export function normalizeAcpModelEntry(
  agent: string,
  id: string,
  displayName?: string,
  thinkingValues?: readonly AcpThinkingValue[],
): AcpModelEntry {
  const trimmed = id.trim();
  const advertised =
    thinkingValues && thinkingValues.length > 0
      ? [...new Set(thinkingValues)]
      : undefined;
  if (agent === "cursor") {
    const parsed = parseBracketAttributes(trimmed);
    const badges = badgesFromAttributes(parsed.attrs);
    const named = displayName?.trim();
    return {
      id: trimmed,
      label: /\[/u.test(trimmed) ? parsed.label : named || parsed.label,
      ...(badges.length > 0 ? { badges } : {}),
      ...(advertised ? { thinkingValues: advertised } : {}),
    };
  }
  return {
    id: trimmed,
    label: displayName?.trim() || trimmed,
    ...(advertised ? { thinkingValues: advertised } : {}),
  };
}

export function catalogEntriesForAgent(
  agent: string,
  models: string[],
): AcpModelEntry[] {
  return models.map((id) => normalizeAcpModelEntry(agent, id));
}
