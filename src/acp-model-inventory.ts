import {
  resolveAcpAgentCommand,
  type AcpAgentDefinition,
} from "./acp-agent";
import { normalizeAcpModelEntry } from "./acp-model-catalog";
import { listCodexAppServerModels } from "./codex-model-inventory";
import { parseCursorListModelsOutput } from "./cursor-model-inventory";
import type { AcpConfigOption, AcpModelCatalog } from "./executor";
import {
  commandArgv,
  runInventoryCommand,
  type RunInventoryCommand,
  type StartInventoryProcess,
} from "./inventory-process";

export type AcpModelInventory =
  | { kind: "cli"; command: string[] }
  | { kind: "codex-app-server"; command: string[] };

export type ListedInventoryModel = {
  id: string;
  label?: string;
  current?: boolean;
  default?: boolean;
  thinkingValues?: Array<"off" | "low" | "medium" | "high">;
};

const DEFAULT_CODEX_INVENTORY = ["codex", "app-server", "--stdio"];

export async function resolveAcpModelInventory(
  agent: AcpAgentDefinition,
): Promise<AcpModelInventory | undefined> {
  if (agent.listModelsCommand) {
    return inventoryForCommand(agent.id, agent.listModelsCommand);
  }
  if (agent.id === "codex") {
    return { kind: "codex-app-server", command: [...DEFAULT_CODEX_INVENTORY] };
  }
  if (agent.id === "cursor") {
    return {
      kind: "cli",
      command: cursorListModelsArgv(await resolveAcpAgentCommand(agent)),
    };
  }
  return undefined;
}

export function catalogFromListedModels(
  agent: string,
  models: readonly ListedInventoryModel[],
): AcpModelCatalog {
  const unique: ListedInventoryModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({ ...model, id });
  }
  const currentModel =
    unique.find((model) => model.current)?.id ??
    unique.find((model) => model.default)?.id;
  const thinkingValues = [
    ...new Set(unique.flatMap((model) => model.thinkingValues ?? [])),
  ];
  const catalog: AcpModelCatalog = {
    agent,
    models: unique.map((model) => model.id),
    entries: unique.map((model) =>
      normalizeAcpModelEntry(agent, model.id, model.label),
    ),
    configOptions: [
      ...(unique.length > 0
        ? [modelConfigOption(unique, currentModel ?? unique[0]!.id)]
        : []),
      ...(thinkingValues.length > 0 ? [thinkingConfigOption(thinkingValues)] : []),
    ],
  };
  return currentModel ? { ...catalog, currentModel } : catalog;
}

export async function listAcpAgentInventory(
  agent: AcpAgentDefinition,
  options: {
    workspace?: string;
    timeoutMs?: number;
    runCommand?: RunInventoryCommand;
    startProcess?: StartInventoryProcess;
    resolveInventory?: (
      agent: AcpAgentDefinition,
    ) => Promise<AcpModelInventory | undefined>;
  } = {},
): Promise<AcpModelCatalog> {
  const inventory = await (options.resolveInventory ?? resolveAcpModelInventory)(
    agent,
  );
  if (!inventory) {
    return emptyUnavailableCatalog(agent.id);
  }
  if (inventory.kind === "codex-app-server") {
    const models = await listCodexAppServerModels({
      command: inventory.command,
      cwd: options.workspace,
      timeoutMs: options.timeoutMs,
      startProcess: options.startProcess,
    });
    return catalogFromListedModels(agent.id, models);
  }
  const result = await (options.runCommand ?? runInventoryCommand)(
    inventory.command,
    { cwd: options.workspace, timeoutMs: options.timeoutMs },
  );
  const models = parseCursorListModelsOutput(result.stdout);
  if (models.length === 0) {
    throw new Error(result.stderr.trim() || "Model inventory returned no models");
  }
  return catalogFromListedModels(agent.id, models);
}

function inventoryForCommand(
  agentId: string,
  command: string | string[],
): AcpModelInventory {
  const argv = commandArgv(command);
  if (agentId === "codex" && !argv.includes("--list-models")) {
    return { kind: "codex-app-server", command: argv };
  }
  return { kind: "cli", command: argv };
}

function cursorListModelsArgv(command: string | string[]): string[] {
  const argv = commandArgv(command);
  if (argv.at(-1) === "acp") argv.pop();
  return [...argv, "--list-models"];
}

function modelConfigOption(
  models: readonly ListedInventoryModel[],
  currentModel: string,
): AcpConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: currentModel,
    options: models.map((model) => ({
      value: model.id,
      name: model.label?.trim() || model.id,
    })),
  };
}

function thinkingConfigOption(
  values: Array<"off" | "low" | "medium" | "high">,
): AcpConfigOption {
  const names = { off: "Off", low: "Low", medium: "Medium", high: "High" };
  return {
    id: "thinking",
    name: "Thinking",
    category: "thinking",
    type: "select",
    currentValue: values.includes("medium") ? "medium" : values[0]!,
    options: values.map((value) => ({ value, name: names[value] })),
  };
}

function emptyUnavailableCatalog(agent: string): AcpModelCatalog {
  return {
    agent,
    models: [],
    entries: [],
    configOptions: [],
    error: "catalog unavailable",
  };
}
