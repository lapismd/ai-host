export type AcpModelEntry = {
  id: string;
  label: string;
  badges?: string[];
};

const EFFORT_BADGES: Record<string, string> = {
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
): AcpModelEntry {
  const trimmed = id.trim();
  if (agent === "cursor") {
    const parsed = parseBracketAttributes(trimmed);
    const badges = badgesFromAttributes(parsed.attrs);
    return {
      id: trimmed,
      label: parsed.label,
      ...(badges.length > 0 ? { badges } : {}),
    };
  }
  return {
    id: trimmed,
    label: displayName?.trim() || trimmed,
  };
}

export function catalogEntriesForAgent(
  agent: string,
  models: string[],
): AcpModelEntry[] {
  return models.map((id) => normalizeAcpModelEntry(agent, id));
}
