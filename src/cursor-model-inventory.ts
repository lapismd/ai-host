import { resolveAcpAgentCommand, type AcpAgentDefinition } from "./acp-agent";
import {
  parseAcpThinkingValue,
  stripCursorModelId,
  type AcpThinkingValue,
} from "./acp-session-options";
import {
  MODEL_INVENTORY_TIMEOUT_MS,
  startInventoryProcess,
  type StartInventoryProcess,
} from "./inventory-process";

export type CursorListedModel = {
  id: string;
  label: string;
  current?: boolean;
  default?: boolean;
  thinkingValues?: AcpThinkingValue[];
};

const MARKERS = /\s+\((?:current|default)\)$/iu;

export function parseCursorListModelsOutput(stdout: string): CursorListedModel[] {
  const models: CursorListedModel[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || /^available models$/iu.test(line)) continue;
    const separator = line.indexOf(" - ");
    const id = (separator >= 0 ? line.slice(0, separator) : line).trim();
    if (!id || seen.has(id)) continue;
    const rest = separator >= 0 ? line.slice(separator + 3).trim() : id;
    const current = /\(current\)/iu.test(rest);
    const isDefault = /\(default\)/iu.test(rest);
    seen.add(id);
    models.push({
      id,
      label: rest.replace(MARKERS, "").trim() || id,
      ...(current ? { current: true } : {}),
      ...(isDefault ? { default: true } : {}),
    });
  }
  return models;
}

export function thinkingValuesFromCursorConfigOptions(
  value: unknown,
): AcpThinkingValue[] | undefined {
  if (!Array.isArray(value)) return;
  const thinking: AcpThinkingValue[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const option = item as Record<string, unknown>;
    if (option.type !== "select" || !Array.isArray(option.options)) continue;
    if (!isCursorThinkingConfigOption(option)) continue;
    for (const entry of option.options) {
      if (!entry || typeof entry !== "object") continue;
      const parsed = parseAcpThinkingValue(
        (entry as Record<string, unknown>).value,
      );
      if (parsed && !thinking.includes(parsed)) thinking.push(parsed);
    }
  }
  return thinking.length > 0 ? thinking : undefined;
}

export function parseCursorListAvailableModels(
  result: unknown,
): CursorListedModel[] {
  const models = asRecord(result).models;
  if (!Array.isArray(models)) return [];
  const listed: CursorListedModel[] = [];
  const seen = new Set<string>();
  for (const entry of models) {
    const record = asRecord(entry);
    const id =
      text(record.value) ??
      text(record.id) ??
      text(record.modelId) ??
      text(record.model);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const thinkingValues = thinkingValuesFromCursorConfigOptions(
      record.configOptions,
    );
    listed.push({
      id,
      label: text(record.name) ?? stripCursorModelId(id),
      ...(thinkingValues ? { thinkingValues } : {}),
    });
  }
  return listed;
}

export async function listCursorAvailableModelsViaAcp(input: {
  agent: AcpAgentDefinition;
  workspace?: string;
  timeoutMs?: number;
  startProcess?: StartInventoryProcess;
}): Promise<CursorListedModel[]> {
  const command = cursorAcpArgv(await resolveAcpAgentCommand(input.agent));
  const timeoutMs = input.timeoutMs ?? MODEL_INVENTORY_TIMEOUT_MS;
  const process = (input.startProcess ?? startInventoryProcess)(command, {
    cwd: input.workspace,
  });
  const rpc = new CursorCatalogRpc(process);
  try {
    return await withTimeout(
      (async () => {
        await rpc.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: {
            name: "lapis_ai_host_cursor_models",
            version: "0.1.0",
          },
        });
        rpc.notify("initialized", {});
        return parseCursorListAvailableModels(
          await rpc.request("cursor/list_available_models", {}),
        );
      })(),
      timeoutMs,
      "Cursor list_available_models timed out",
    );
  } finally {
    rpc.close();
  }
}

function isCursorThinkingConfigOption(option: Record<string, unknown>): boolean {
  const id = text(option.id)?.toLowerCase() ?? "";
  const category = text(option.category)?.toLowerCase() ?? "";
  const name = text(option.name)?.toLowerCase() ?? "";
  return (
    ["thinking", "effort", "reasoning", "reasoning_effort", "thought_level"].includes(
      id,
    ) ||
    ["thinking", "thought", "thought_level"].includes(category) ||
    name === "effort" ||
    name === "thinking" ||
    name.includes("reasoning")
  );
}

function cursorAcpArgv(command: string | string[]): string[] {
  const argv = Array.isArray(command)
    ? command.map((part) => part.trim()).filter(Boolean)
    : command.trim().split(/\s+/u).filter(Boolean);
  if (argv.at(-1) !== "acp") argv.push("acp");
  return argv;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class CursorCatalogRpc {
  #id = 1;
  #buffer = "";
  #pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  constructor(
    private readonly process: {
      write(data: string): void;
      onData(listener: (chunk: string) => void): void;
      onClose(listener: (code: number | null) => void): void;
      kill(): void;
    },
  ) {
    this.process.onData((chunk) => this.#onData(chunk));
    this.process.onClose(() =>
      this.#rejectAll("Cursor list_available_models closed"),
    );
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#id++;
    const result = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.process.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return result;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.process.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  close(): void {
    this.#rejectAll("Cursor list_available_models closed");
    this.process.kill();
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#handleLine(line);
  }

  #handleLine(line: string): void {
    if (!line.trim()) return;
    let parsed: {
      id?: string | number;
      method?: string;
      result?: unknown;
      error?: { message?: string } | unknown;
    };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.id === undefined || parsed.method) return;
    const pending = this.#pending.get(Number(parsed.id));
    if (!pending) return;
    this.#pending.delete(Number(parsed.id));
    if (parsed.error) {
      pending.reject(
        new Error(
          text(asRecord(parsed.error).message) ??
            "cursor/list_available_models failed",
        ),
      );
      return;
    }
    pending.resolve(parsed.result);
  }

  #rejectAll(message: string): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.reject(new Error(message));
    }
  }
}
