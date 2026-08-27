import { stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const acpx = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  stateDir: undefined as string | undefined,
  close: vi.fn(async () => undefined),
}));

vi.mock("acpx/runtime", () => ({
  createAgentRegistry: () => ({}),
  createRuntimeStore: ({ stateDir }: { stateDir: string }) => {
    acpx.stateDir = stateDir;
    return {};
  },
  createAcpRuntime: (options: Record<string, unknown>) => {
    acpx.options = options;
    return {
      async ensureSession(input: { sessionKey: string; agent: string }) {
        return { sessionKey: input.sessionKey, backend: input.agent };
      },
      startTurn() {
        return {
          events: (async function* () {})(),
          result: Promise.resolve({ status: "completed" }),
        };
      },
      async cancel() {},
      close: acpx.close,
    };
  },
}));

import { defaultCreateAcpxRuntime } from "./executor";

describe("default restricted ACP runtime", () => {
  it("uses temporary state, rejects permissions, and cleans up on close", async () => {
    const sink = {
      sendRuntimeEvent: vi.fn(),
      sendProcessMessage: vi.fn(),
    };
    const runtime = await defaultCreateAcpxRuntime(
      sink,
      "restricted-session",
      { restricted: true, workspace: "/private/vault" },
      new Map(),
    );
    const cwd = String(acpx.options?.cwd);
    const stateDir = String(acpx.stateDir);

    expect(cwd).toMatch(/lapis-acp-restricted-/u);
    expect(cwd).not.toContain("/private/vault");
    expect(stateDir).toBe(`${cwd}/.lapis/ai-sessions`);
    await expect(stat(cwd)).resolves.toBeTruthy();
    const onPermissionRequest = acpx.options?.onPermissionRequest as (
      request: Record<string, unknown>,
    ) => Promise<unknown>;
    await expect(onPermissionRequest({})).resolves.toEqual({
      outcome: "reject_once",
    });
    expect(sink.sendRuntimeEvent).not.toHaveBeenCalled();

    await runtime.close({
      handle: { sessionKey: "restricted-session" },
      reason: "test",
      discardPersistentState: true,
    });

    expect(acpx.close).toHaveBeenCalledOnce();
    await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
