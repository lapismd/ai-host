import { describe, expect, it } from "vitest";
import {
  listCursorAvailableModelsViaAcp,
  parseCursorListAvailableModels,
  parseCursorListModelsOutput,
} from "./cursor-model-inventory";
import type { InventoryStdioProcess } from "./inventory-process";

describe("Cursor model inventory", () => {
  it("parses id, label, current, and default markers", () => {
    expect(
      parseCursorListModelsOutput(`
Available models

auto - Auto (default)
composer-2.5 - Composer 2.5 (current)
gpt-5.3-codex-low - Codex 5.3 Low
composer-2.5 - ignored duplicate
`),
    ).toEqual([
      { id: "auto", label: "Auto", default: true },
      { id: "composer-2.5", label: "Composer 2.5", current: true },
      { id: "gpt-5.3-codex-low", label: "Codex 5.3 Low" },
    ]);
  });

  it("extracts per-model thinkingValues from cursor/list_available_models", () => {
    expect(
      parseCursorListAvailableModels({
        models: [
          {
            value: "composer-2.5",
            name: "Composer 2.5",
            configOptions: [
              {
                id: "effort",
                name: "Effort",
                type: "select",
                currentValue: "high",
                options: [
                  { value: "low", name: "Low" },
                  { value: "high", name: "High" },
                  { value: "xhigh", name: "Extra High" },
                ],
              },
            ],
          },
          { value: "auto", name: "Auto" },
          {
            value: "claude-opus-5[effort=high]",
            name: "Opus",
            configOptions: [],
          },
        ],
      }),
    ).toEqual([
      {
        id: "composer-2.5",
        label: "Composer 2.5",
        thinkingValues: ["low", "high", "xhigh"],
      },
      { id: "auto", label: "Auto" },
      { id: "claude-opus-5[effort=high]", label: "Opus" },
    ]);
  });
});

class FakeCursorProcess implements InventoryStdioProcess {
  #data: Array<(chunk: string) => void> = [];
  #closed: Array<(code: number | null) => void> = [];
  writes: string[] = [];
  killed = false;

  write(data: string): void {
    this.writes.push(data);
    const message = JSON.parse(data) as {
      id?: number;
      method?: string;
    };
    if (message.method === "initialize") {
      this.#emit({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    if (message.method !== "cursor/list_available_models") return;
    this.#emit({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        models: [
          {
            value: "composer-2.5",
            name: "Composer 2.5",
            configOptions: [
              {
                id: "effort",
                name: "Effort",
                type: "select",
                currentValue: "medium",
                options: [
                  { value: "low", name: "Low" },
                  { value: "medium", name: "Medium" },
                ],
              },
            ],
          },
        ],
      },
    });
  }

  onData(listener: (chunk: string) => void): void {
    this.#data.push(listener);
  }

  onClose(listener: (code: number | null) => void): void {
    this.#closed.push(listener);
  }

  kill(): void {
    this.killed = true;
    for (const listener of this.#closed) listener(0);
  }

  #emit(value: unknown): void {
    for (const listener of this.#data) {
      listener(`${JSON.stringify(value)}\n`);
    }
  }
}

describe("Cursor list_available_models probe", () => {
  it("lists models through cursor-agent acp without using --list-models", async () => {
    const process = new FakeCursorProcess();
    await expect(
      listCursorAvailableModelsViaAcp({
        agent: {
          id: "cursor",
          label: "Cursor",
          enabled: true,
          command: ["cursor-agent", "acp"],
          mcpTransport: "http",
        },
        startProcess: (command) => {
          expect(command).toEqual(["cursor-agent", "acp"]);
          return process;
        },
      }),
    ).resolves.toEqual([
      {
        id: "composer-2.5",
        label: "Composer 2.5",
        thinkingValues: ["low", "medium"],
      },
    ]);
    expect(process.killed).toBe(true);
    expect(process.writes.some((write) => write.includes("--list-models"))).toBe(
      false,
    );
  });
});
