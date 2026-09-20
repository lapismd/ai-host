import {
  MODEL_INVENTORY_TIMEOUT_MS,
  startInventoryProcess,
  type StartInventoryProcess,
} from "./inventory-process";

export type CodexListedModel = {
  id: string;
  label: string;
  default?: boolean;
  thinkingValues?: Array<"off" | "low" | "medium" | "high">;
};

type AppServerMessage = {
  id?: string | number;
  method?: string;
  result?: unknown;
  error?: { message?: string } | unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeCodexModelList(result: unknown): CodexListedModel[] {
  const data = asRecord(result).data;
  if (!Array.isArray(data)) return [];
  const models: CodexListedModel[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const record = asRecord(entry);
    const id = text(record.model) ?? text(record.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const thinkingValues = thinkingFromCodex(record.supportedReasoningEfforts);
    models.push({
      id,
      label: text(record.displayName) ?? id,
      ...(record.isDefault === true ? { default: true } : {}),
      ...(thinkingValues ? { thinkingValues } : {}),
    });
  }
  return models;
}

export async function listCodexAppServerModels(input: {
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  startProcess?: StartInventoryProcess;
}): Promise<CodexListedModel[]> {
  const timeoutMs = input.timeoutMs ?? MODEL_INVENTORY_TIMEOUT_MS;
  const process = (input.startProcess ?? startInventoryProcess)(input.command, {
    cwd: input.cwd,
  });
  const rpc = new CodexCatalogRpc(process);
  try {
    return await withTimeout(
      (async () => {
        await rpc.request("initialize", {
          clientInfo: {
            name: "lapis_ai_host_model_inventory",
            title: "Lapis AI Host Model Inventory",
            version: "0.0.1",
          },
          capabilities: {},
        });
        rpc.notify("initialized", {});
        const models: CodexListedModel[] = [];
        let cursor: string | null = null;
        const seenCursors = new Set<string>();
        do {
          const result = await rpc.request("model/list", {
            limit: 100,
            includeHidden: false,
            ...(cursor ? { cursor } : {}),
          });
          models.push(...normalizeCodexModelList(result));
          const next = text(asRecord(result).nextCursor) ?? null;
          if (!next || seenCursors.has(next)) break;
          seenCursors.add(next);
          cursor = next;
        } while (cursor);
        return models;
      })(),
      timeoutMs,
      "Codex model inventory timed out",
    );
  } finally {
    rpc.close();
  }
}

function thinkingFromCodex(
  value: unknown,
): Array<"off" | "low" | "medium" | "high"> | undefined {
  if (!Array.isArray(value)) return;
  const thinking: Array<"off" | "low" | "medium" | "high"> = [];
  for (const entry of value) {
    const effort = text(asRecord(entry).reasoningEffort);
    const mapped =
      effort === "none"
        ? "off"
        : effort === "low" || effort === "medium" || effort === "high"
          ? effort
          : undefined;
    if (mapped && !thinking.includes(mapped)) thinking.push(mapped);
  }
  return thinking.length > 0 ? thinking : undefined;
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

class CodexCatalogRpc {
  #id = 1;
  #buffer = "";
  #pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  constructor(private readonly process: InventoryProcessLike) {
    this.process.onData((chunk) => this.#onData(chunk));
    this.process.onClose(() => this.#rejectAll("Codex model inventory closed"));
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#id++;
    const result = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.process.write(`${JSON.stringify({ id, method, params })}\n`);
    return result;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.process.write(`${JSON.stringify({ method, params })}\n`);
  }

  close(): void {
    this.#rejectAll("Codex model inventory closed");
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
    let parsed: AppServerMessage;
    try {
      parsed = JSON.parse(line) as AppServerMessage;
    } catch {
      return;
    }
    if (parsed.id === undefined || parsed.method) return;
    const pending = this.#pending.get(Number(parsed.id));
    if (!pending) return;
    this.#pending.delete(Number(parsed.id));
    if (parsed.error) {
      pending.reject(
        new Error(text(asRecord(parsed.error).message) ?? "Codex model/list failed"),
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

type InventoryProcessLike = {
  write(data: string): void;
  onData(listener: (chunk: string) => void): void;
  onClose(listener: (code: number | null) => void): void;
  kill(): void;
};
