export type AcpAgentMcpTransport = "stdio" | "http";

export type AcpAgentDefinition = {
  id: string;
  label: string;
  enabled: boolean;
  command?: string | string[];
  mcpTransport: AcpAgentMcpTransport;
};

export type AcpAgentRegistry = {
  resolve(id: string): AcpAgentDefinition;
  list(): AcpAgentDefinition[];
};

const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export const DEFAULT_ACP_AGENTS: readonly AcpAgentDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    enabled: true,
    mcpTransport: "stdio",
  },
  {
    id: "cursor",
    label: "Cursor",
    enabled: true,
    mcpTransport: "http",
  },
];

export function createAcpAgentRegistry(
  definitions: readonly AcpAgentDefinition[] = DEFAULT_ACP_AGENTS,
): AcpAgentRegistry {
  const agents = new Map<string, AcpAgentDefinition>();
  for (const input of definitions) {
    const definition = normalizeAcpAgentDefinition(input);
    if (agents.has(definition.id)) {
      throw new Error(`Duplicate ACP agent: ${definition.id}`);
    }
    agents.set(definition.id, definition);
  }
  return {
    resolve(id) {
      const normalized = normalizeAcpAgentId(id);
      const definition = agents.get(normalized);
      if (!definition || !definition.enabled) {
        throw new Error(`ACP agent is not enabled: ${normalized}`);
      }
      return { ...definition, command: cloneCommand(definition.command) };
    },
    list() {
      return [...agents.values()]
        .filter((agent) => agent.enabled)
        .map((agent) => ({
          ...agent,
          command: cloneCommand(agent.command),
        }));
    },
  };
}

export function resolveAcpAgent(
  payload: {
    agent?: string;
    metadata?: Record<string, unknown>;
  },
  registry: AcpAgentRegistry = createAcpAgentRegistry(),
): AcpAgentDefinition {
  const value = payload.agent ?? payload.metadata?.acpAgent ?? "codex";
  if (typeof value !== "string") {
    throw new Error("Invalid ACP agent: expected a string identifier");
  }
  return registry.resolve(value);
}

function normalizeAcpAgentDefinition(
  input: AcpAgentDefinition,
): AcpAgentDefinition {
  const id = normalizeAcpAgentId(input.id);
  const label = input.label.trim();
  if (!label) throw new Error(`ACP agent ${id} requires a label`);
  if (label.length > 100) throw new Error(`ACP agent ${id} label is too long`);
  const command = normalizeCommand(input.command, id);
  if (input.mcpTransport !== "stdio" && input.mcpTransport !== "http") {
    throw new Error(`ACP agent ${id} has an invalid MCP transport`);
  }
  return {
    id,
    label,
    enabled: input.enabled === true,
    ...(command ? { command } : {}),
    mcpTransport: input.mcpTransport,
  };
}

function normalizeAcpAgentId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!AGENT_ID.test(id)) {
    throw new Error("Invalid ACP agent identifier");
  }
  return id;
}

function normalizeCommand(
  value: string | string[] | undefined,
  id: string,
): string | string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const command = value.trim();
    if (!command) throw new Error(`ACP agent ${id} command is empty`);
    return command;
  }
  if (value.length === 0 || value.some((part) => !part.trim())) {
    throw new Error(`ACP agent ${id} command is empty`);
  }
  return value.map((part) => part.trim());
}

function cloneCommand(
  value: string | string[] | undefined,
): string | string[] | undefined {
  return Array.isArray(value) ? [...value] : value;
}

export function parseAcpAgentDefinitions(value: unknown): AcpAgentDefinition[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ACP agent configuration must be an object");
  }
  const agents = (value as Record<string, unknown>).agents;
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error(
      "ACP agent configuration requires a non-empty agents array",
    );
  }
  return agents.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("ACP agent definition must be an object");
    }
    const record = entry as Record<string, unknown>;
    const command = record.command;
    if (
      command !== undefined &&
      typeof command !== "string" &&
      (!Array.isArray(command) ||
        command.some((part) => typeof part !== "string"))
    ) {
      throw new Error("ACP agent command must be a string or string array");
    }
    if (
      record.mcpTransport !== undefined &&
      record.mcpTransport !== "stdio" &&
      record.mcpTransport !== "http"
    ) {
      throw new Error("ACP agent MCP transport must be stdio or http");
    }
    return {
      id: String(record.id ?? ""),
      label: String(record.label ?? ""),
      enabled: record.enabled !== false,
      ...(command === undefined
        ? {}
        : { command: command as string | string[] }),
      mcpTransport:
        record.mcpTransport === "http" ? ("http" as const) : ("stdio" as const),
    };
  });
}
