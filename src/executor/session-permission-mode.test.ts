import { describe, expect, it, vi } from "vitest";
import { createAgentRuntimeExecutor, type AcpxRuntimeLike } from "./executor";

const sink = {
  sendRuntimeEvent: vi.fn(),
  sendProcessMessage: vi.fn(),
};

function runtimeWith(keys: string[], setMode = vi.fn()) {
  const runtime = {
    async ensureSession(input: { sessionKey: string; agent: string }) {
      return { sessionKey: input.sessionKey, backend: input.agent };
    },
    startTurn() {
      return {
        events: (async function* () {})(),
        result: Promise.resolve({ status: "completed" as const }),
      };
    },
    getCapabilities() {
      return { configOptionKeys: keys };
    },
    setMode,
    async cancel() {},
    async close() {},
  };
  return { runtime: runtime as AcpxRuntimeLike, setMode };
}

describe("harness permission mode", () => {
  it("calls setMode only when the session advertises mode", async () => {
    const advertised = runtimeWith(["mode"]);
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => advertised.runtime,
    });
    const started = await executor.startAcpSession(sink, {
      agent: "codex",
      permissionMode: "bypassPermissions",
    });
    expect(advertised.setMode).toHaveBeenCalledWith({
      handle: expect.any(Object),
      mode: "bypassPermissions",
    });
    await executor.closeAcpSession(started.sessionId);

    const hidden = runtimeWith(["model"]);
    const asking = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => hidden.runtime,
    });
    const session = await asking.startAcpSession(sink, {
      agent: "codex",
      permissionMode: "bypassPermissions",
    });
    expect(hidden.setMode).not.toHaveBeenCalled();
    await asking.closeAcpSession(session.sessionId);
  });

  it("keeps the session when setMode fails", async () => {
    const fake = runtimeWith(
      ["mode"],
      vi.fn(async () => {
        throw new Error("rejected");
      }),
    );
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => fake.runtime,
    });
    const started = await executor.startAcpSession(sink, {
      agent: "codex",
      permissionMode: "bypassPermissions",
    });
    expect(started.sessionId).toBeTruthy();
    await executor.closeAcpSession(started.sessionId);
  });
});
