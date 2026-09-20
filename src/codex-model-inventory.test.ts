import { describe, expect, it } from "vitest";
import {
  listCodexAppServerModels,
  normalizeCodexModelList,
} from "./codex-model-inventory";
import type { InventoryStdioProcess } from "./inventory-process";

class FakeCodexProcess implements InventoryStdioProcess {
  #data: Array<(chunk: string) => void> = [];
  #closed: Array<(code: number | null) => void> = [];
  writes: string[] = [];
  killed = false;

  write(data: string): void {
    this.writes.push(data);
    const message = JSON.parse(data) as {
      id?: number;
      method?: string;
      params?: { cursor?: string };
    };
    if (message.method === "initialize") {
      this.#emit({ id: message.id, result: {} });
      return;
    }
    if (message.method !== "model/list") return;
    const page = message.params?.cursor
      ? {
          data: [{ id: "luna-id", model: "gpt-5.6-luna", displayName: "Luna" }],
          nextCursor: null,
        }
      : {
          data: [
            {
              id: "sol-id",
              model: "gpt-5.6-sol",
              displayName: "Sol",
              isDefault: true,
              supportedReasoningEfforts: [
                { reasoningEffort: "low" },
                { reasoningEffort: "none" },
              ],
            },
            { id: "terra-id", model: "gpt-5.6-terra", displayName: "Terra" },
          ],
          nextCursor: "page-2",
        };
    this.#emit({ id: message.id, result: page });
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

describe("Codex model inventory", () => {
  it("normalizes paged model/list payloads and thinking values", () => {
    expect(
      normalizeCodexModelList({
        data: [
          {
            model: "gpt-5.6-sol",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "none" }],
          },
          { model: "gpt-5.6-sol" },
          { model: "gpt-5.6-terra" },
        ],
      }),
    ).toEqual([
      {
        id: "gpt-5.6-sol",
        label: "gpt-5.6-sol",
        default: true,
        thinkingValues: ["off"],
      },
      { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
    ]);
  });

  it("lists models through the app-server JSON-RPC process", async () => {
    const process = new FakeCodexProcess();
    await expect(
      listCodexAppServerModels({
        command: ["codex", "app-server", "--stdio"],
        startProcess: () => process,
      }),
    ).resolves.toEqual([
      {
        id: "gpt-5.6-sol",
        label: "Sol",
        default: true,
        thinkingValues: ["low", "off"],
      },
      { id: "gpt-5.6-terra", label: "Terra" },
      { id: "gpt-5.6-luna", label: "Luna" },
    ]);
    expect(process.killed).toBe(true);
  });
});
