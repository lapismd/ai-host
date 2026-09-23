import {
  parseAcpThinkingValue,
  type AcpThinkingValue,
} from "../acp/acp-session-options";
import {
  MODEL_INVENTORY_TIMEOUT_MS,
  startInventoryProcess,
  type StartInventoryProcess,
} from "./inventory-process";

export type OpenCodeListedModel = {
  id: string;
  label: string;
  default?: boolean;
  thinkingValues?: AcpThinkingValue[];
};

const READY = /opencode server listening on (https?:\/\/\S+)/u;

export function normalizeOpenCodeProviderList(
  result: unknown,
): OpenCodeListedModel[] {
  const data = asRecord(result);
  const all = Array.isArray(data.all) ? data.all : [];
  const connected = new Set(
    (Array.isArray(data.connected) ? data.connected : [])
      .map((id) => text(id))
      .filter((id): id is string => Boolean(id)),
  );
  const defaults = asRecord(data.default);
  const models: OpenCodeListedModel[] = [];
  const seen = new Set<string>();
  for (const entry of all) {
    const provider = asRecord(entry);
    const providerId = text(provider.id);
    if (!providerId) continue;
    if (connected.size > 0 && !connected.has(providerId)) continue;
    const providerModels = asRecord(provider.models);
    for (const [modelKey, modelEntry] of Object.entries(providerModels)) {
      const model = asRecord(modelEntry);
      const modelId = text(model.id) ?? text(modelKey);
      if (!modelId) continue;
      const id = `${providerId}/${modelId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const thinkingValues = thinkingFromVariants(model.variants);
      models.push({
        id,
        label: text(model.name) ?? id,
        ...(text(defaults[providerId]) === modelId ? { default: true } : {}),
        ...(thinkingValues ? { thinkingValues } : {}),
      });
    }
  }
  return models;
}

export async function listOpenCodeServerModels(input: {
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  startProcess?: StartInventoryProcess;
  fetchJson?: (url: string) => Promise<unknown>;
}): Promise<OpenCodeListedModel[]> {
  const timeoutMs = input.timeoutMs ?? MODEL_INVENTORY_TIMEOUT_MS;
  const process = (input.startProcess ?? startInventoryProcess)(input.command, {
    cwd: input.cwd,
  });
  try {
    return await withTimeout(
      (async () => {
        const origin = await waitForOpenCodeOrigin(process);
        const payload = await (input.fetchJson ?? fetchJson)(
          `${origin.replace(/\/$/u, "")}/provider`,
        );
        return normalizeOpenCodeProviderList(payload);
      })(),
      timeoutMs,
      "OpenCode model inventory timed out",
    );
  } finally {
    process.kill();
  }
}

function thinkingFromVariants(value: unknown): AcpThinkingValue[] | undefined {
  const keys = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.keys(value)
      : [];
  const thinking: AcpThinkingValue[] = [];
  for (const key of keys) {
    const mapped = parseAcpThinkingValue(key);
    if (mapped && !thinking.includes(mapped)) thinking.push(mapped);
  }
  return thinking.length > 0 ? thinking : undefined;
}

function waitForOpenCodeOrigin(process: {
  onData(listener: (chunk: string) => void): void;
  onClose(listener: (code: number | null) => void): void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    process.onData((chunk) => {
      stdout += chunk;
      const match = READY.exec(stdout);
      if (match) resolve(match[1]!);
    });
    process.onClose(() =>
      reject(new Error("OpenCode model inventory closed")),
    );
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenCode /provider failed: ${response.status}`);
  }
  return response.json();
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
