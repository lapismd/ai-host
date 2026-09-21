import { describe, expect, it, vi } from "vitest";
import { createAcpAgentRegistry } from "./acp-agent";
import {
  catalogFromListedModels,
  listAcpAgentInventory,
  mergeCursorAvailableModels,
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

  it("resolves OpenCode through the server provider list, not ACP", async () => {
    await expect(
      resolveAcpModelInventory(createAcpAgentRegistry().resolve("opencode")),
    ).resolves.toEqual({
      kind: "opencode-server",
      command: [
        "opencode",
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
      ],
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

  it("attaches advertised thinkingValues only to the models that listed them", () => {
    expect(
      catalogFromListedModels("codex", [
        {
          id: "gpt-5.6-sol",
          label: "Sol",
          thinkingValues: ["low", "off"],
        },
        { id: "gpt-5.6-terra", label: "Terra" },
      ]),
    ).toMatchObject({
      entries: [
        {
          id: "gpt-5.6-sol",
          label: "Sol",
          thinkingValues: ["low", "off"],
        },
        { id: "gpt-5.6-terra", label: "Terra" },
      ],
      configOptions: [
        { id: "model" },
        {
          id: "thinking",
          category: "thinking",
          options: [
            { value: "low", name: "Low" },
            { value: "off", name: "Off" },
          ],
        },
      ],
    });
  });

  it("does not invent thinking when listed models omit thinkingValues", () => {
    const catalog = catalogFromListedModels("cursor", [
      {
        id: "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]",
        label: "claude-opus-5",
      },
      { id: "composer-2.5", label: "Composer 2.5" },
    ]);
    expect(catalog.configOptions.map((option) => option.id)).toEqual(["model"]);
    expect(
      catalog.configOptions.some((option) => option.category === "thinking"),
    ).toBe(false);
    expect(catalog.entries).toEqual([
      {
        id: "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]",
        label: "claude-opus-5",
        badges: ["High"],
      },
      { id: "composer-2.5", label: "Composer 2.5" },
    ]);
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

  it("lists OpenCode models from the server inventory without starting ACP", async () => {
    const catalog = await listAcpAgentInventory(
      createAcpAgentRegistry().resolve("opencode"),
      {
        startProcess: () => ({
          write() {},
          onData(listener) {
            listener("opencode server listening on http://127.0.0.1:4310\n");
          },
          onClose() {},
          kill() {},
        }),
        fetchJson: async (url) => {
          expect(url).toBe("http://127.0.0.1:4310/provider");
          return {
            connected: ["openai"],
            all: [
              {
                id: "openai",
                models: {
                  "gpt-5.6": {
                    id: "gpt-5.6",
                    name: "GPT-5.6",
                    variants: { high: {}, xhigh: {} },
                  },
                },
              },
            ],
          };
        },
      },
    );
    expect(catalog).toMatchObject({
      agent: "opencode",
      models: ["openai/gpt-5.6"],
      entries: [
        {
          id: "openai/gpt-5.6",
          label: "GPT-5.6",
          thinkingValues: ["high", "xhigh"],
        },
      ],
    });
  });

  it("keeps Cursor --list-models catalogs free of invented thinking options", async () => {
    const catalog = await listAcpAgentInventory(
      {
        id: "cursor",
        label: "Cursor",
        enabled: true,
        command: ["cursor-agent", "acp"],
        mcpTransport: "http",
      },
      {
        runCommand: async () => ({
          code: 0,
          stdout: [
            "auto - Auto (default)",
            "claude-opus-5[thinking=true,effort=high] - Opus High",
            "composer-2.5 - Composer 2.5 (current)",
          ].join("\n"),
          stderr: "",
        }),
      },
    );
    expect(catalog.models).toEqual([
      "auto",
      "claude-opus-5[thinking=true,effort=high]",
      "composer-2.5",
    ]);
    expect(catalog.configOptions.map((option) => option.id)).toEqual(["model"]);
    expect(catalog.entries).toEqual([
      { id: "auto", label: "Auto" },
      {
        id: "claude-opus-5[thinking=true,effort=high]",
        label: "claude-opus-5",
        badges: ["High"],
      },
      { id: "composer-2.5", label: "Composer 2.5" },
    ]);
  });

  it("merges background Cursor thinkingValues onto matching catalog entries", () => {
    const catalog = catalogFromListedModels("cursor", [
      { id: "composer-2.5", label: "Composer 2.5" },
      {
        id: "claude-opus-5[effort=high]",
        label: "claude-opus-5",
      },
    ]);
    const enriched = mergeCursorAvailableModels(catalog, [
      {
        id: "composer-2.5",
        label: "Composer 2.5",
        thinkingValues: ["low", "high"],
      },
      {
        id: "claude-opus-5",
        label: "claude-opus-5",
        thinkingValues: ["xhigh"],
      },
    ]);
    expect(enriched.entries).toEqual([
      {
        id: "composer-2.5",
        label: "Composer 2.5",
        thinkingValues: ["low", "high"],
      },
      {
        id: "claude-opus-5[effort=high]",
        label: "claude-opus-5",
        badges: ["High"],
        thinkingValues: ["xhigh"],
      },
    ]);
    expect(enriched.configOptions.map((option) => option.id)).toEqual([
      "model",
      "thinking",
    ]);
  });
});
