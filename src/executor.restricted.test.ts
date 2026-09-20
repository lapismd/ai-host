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

    expect(cwd).toMatch(/lapis-acp-restricted-/u);
    expect(cwd).not.toContain("/private/vault");
    expect(acpx.stateDir).toBeUndefined();
    const store = acpx.options?.sessionStore as { save(record: unknown): Promise<void>; load(id: string): Promise<unknown> };
    await store.save({ acpxRecordId: "restricted-session", messages: [{ text: "synthetic-only-secret" }] });
    expect(await store.load("restricted-session")).toBeTruthy();
    await expect(stat(`${cwd}/.lapis/ai-sessions`)).rejects.toMatchObject({ code: "ENOENT" });
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
    expect(await store.load("restricted-session")).toBeUndefined();
    await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
