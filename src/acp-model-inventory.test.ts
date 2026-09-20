import { describe, expect, it, vi } from "vitest";
import { createAcpAgentRegistry } from "./acp-agent";
import {
  catalogFromListedModels,
  listAcpAgentInventory,
  resolveAcpModelInventory,
} from "./acp-model-inventory";

describe("ACP model inventory", () => {
  it("resolves Cursor --list-models from the ACP launch binary", async () => {
    await expect(
      resolveAcpModelInventory({
        id: "cursor",
        label: "Cursor",
        enabled: true,
        command: ["cursor-agent", "acp"],
        mcpTransport: "http",
      }),
    ).resolves.toEqual({
      kind: "cli",
      command: ["cursor-agent", "--list-models"],
    });
  });

  it("resolves Codex through app-server model/list, not the ACP adapter", async () => {
    await expect(
      resolveAcpModelInventory(createAcpAgentRegistry().resolve("codex")),
    ).resolves.toEqual({
      kind: "codex-app-server",
      command: ["codex", "app-server", "--stdio"],
    });
  });

  it("builds a selectable catalog from listed models", () => {
    expect(
      catalogFromListedModels("cursor", [
        { id: "auto", label: "Auto", default: true },
        { id: "composer-2.5", label: "Composer 2.5", current: true },
      ]),
    ).toMatchObject({
      agent: "cursor",
      currentModel: "composer-2.5",
      models: ["auto", "composer-2.5"],
      entries: [
        { id: "auto", label: "Auto" },
        { id: "composer-2.5", label: "Composer 2.5" },
      ],
      configOptions: [
        {
          id: "model",
          category: "model",
          currentValue: "composer-2.5",
          options: [
            { value: "auto", name: "Auto" },
            { value: "composer-2.5", name: "Composer 2.5" },
          ],
        },
      ],
    });
  });

  it("runs the Cursor CLI inventory without starting ACP", async () => {
    const runCommand = vi.fn(async () => ({
      code: 0,
      stdout: "composer-2.5 - Composer 2.5 (current)\n",
      stderr: "",
    }));
    await expect(
      listAcpAgentInventory(
        {
          id: "cursor",
          label: "Cursor",
          enabled: true,
          command: ["cursor-agent", "acp"],
          mcpTransport: "http",
        },
        { runCommand },
      ),
    ).resolves.toMatchObject({
      agent: "cursor",
      currentModel: "composer-2.5",
      models: ["composer-2.5"],
    });
    expect(runCommand).toHaveBeenCalledWith(
      ["cursor-agent", "--list-models"],
      expect.objectContaining({}),
    );
  });
});
