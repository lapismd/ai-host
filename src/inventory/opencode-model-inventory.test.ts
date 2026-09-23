import { describe, expect, it } from "vitest";
import {
  listOpenCodeServerModels,
  normalizeOpenCodeProviderList,
} from "./opencode-model-inventory";
import type { InventoryStdioProcess } from "./inventory-process";

class FakeOpenCodeProcess implements InventoryStdioProcess {
  #data: Array<(chunk: string) => void> = [];
  #closed: Array<(code: number | null) => void> = [];
  writes: string[] = [];
  killed = false;

  write(data: string): void {
    this.writes.push(data);
  }

  onData(listener: (chunk: string) => void): void {
    this.#data.push(listener);
    listener("opencode server listening on http://127.0.0.1:4096\n");
  }

  onClose(listener: (code: number | null) => void): void {
    this.#closed.push(listener);
  }

  kill(): void {
    this.killed = true;
    for (const listener of this.#closed) listener(0);
  }
}

describe("OpenCode model inventory", () => {
  it("flattens connected providers to provider/model and listed variants only", () => {
    expect(
      normalizeOpenCodeProviderList({
        connected: ["openai", "anthropic"],
        default: { openai: "gpt-5.6" },
        all: [
          {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-5.6": {
                id: "gpt-5.6",
                name: "GPT-5.6",
                variants: { low: {}, medium: {}, high: {}, xhigh: {} },
              },
              "gpt-5.6-mini": { id: "gpt-5.6-mini", name: "Mini" },
            },
          },
          {
            id: "anthropic",
            models: {
              "claude-sonnet-4": {
                id: "claude-sonnet-4",
                name: "Sonnet 4",
                variants: ["high"],
              },
            },
          },
          {
            id: "disconnected",
            models: { ignore: { id: "ignore", name: "Ignore" } },
          },
        ],
      }),
    ).toEqual([
      {
        id: "openai/gpt-5.6",
        label: "GPT-5.6",
        default: true,
        thinkingValues: ["low", "medium", "high", "xhigh"],
      },
      { id: "openai/gpt-5.6-mini", label: "Mini" },
      {
        id: "anthropic/claude-sonnet-4",
        label: "Sonnet 4",
        thinkingValues: ["high"],
      },
    ]);
  });

  it("does not invent thinking when a model lists no variants", () => {
    expect(
      normalizeOpenCodeProviderList({
        all: [
          {
            id: "opencode",
            models: { "grok-code": { id: "grok-code", name: "Grok" } },
          },
        ],
      }),
    ).toEqual([{ id: "opencode/grok-code", label: "Grok" }]);
  });

  it("lists models through opencode serve /provider without ACP", async () => {
    const process = new FakeOpenCodeProcess();
    const fetchJson = async (url: string) => {
      expect(url).toBe("http://127.0.0.1:4096/provider");
      return {
        connected: ["openai"],
        all: [
          {
            id: "openai",
            models: {
              "gpt-5.6": {
                id: "gpt-5.6",
                name: "GPT-5.6",
                variants: { medium: {} },
              },
            },
          },
        ],
      };
    };
    await expect(
      listOpenCodeServerModels({
        command: ["opencode", "serve", "--port", "0"],
        startProcess: (command) => {
          expect(command).toEqual(["opencode", "serve", "--port", "0"]);
          return process;
        },
        fetchJson,
      }),
    ).resolves.toEqual([
      {
        id: "openai/gpt-5.6",
        label: "GPT-5.6",
        thinkingValues: ["medium"],
      },
    ]);
    expect(process.killed).toBe(true);
    expect(process.writes).toEqual([]);
  });
});
