import { describe, expect, it, vi } from "vitest";
import { createAcpAgentRegistry } from "./acp-agent";
import {
  createAgentRuntimeExecutor,
  normalizePermissionDecision,
  type AcpPermissionDecision,
  type CreateAcpxRuntime,
} from "./executor";

const sink = {
  connectionId: "connection-1",
  sendRuntimeEvent: vi.fn(),
  sendProcessMessage: vi.fn(),
};

describe("ACP host control boundaries", () => {
  it("lists only enabled registered agents and exposes session state", async () => {
    const executor = createAgentRuntimeExecutor({
      agentRegistry: createAcpAgentRegistry([
        {
          id: "claude",
          label: "Claude",
          enabled: true,
          mcpTransport: "stdio",
        },
        {
          id: "hidden",
          label: "Hidden",
          enabled: false,
          mcpTransport: "stdio",
        },
      ]),
      createAcpxRuntime: inertRuntime(),
    });
    expect(executor.listAcpAgents()).toEqual({
      agents: [{ id: "claude", label: "Claude", mcpTransport: "stdio" }],
    });
    await executor.startAcpSession(sink, {
      sessionId: "session-1",
      agent: "claude",
    });
    expect(executor.getAcpSessionStatus("session-1")).toMatchObject({
      state: "idle",
      latestSequence: 0,
    });
    expect(executor.getAcpSessionStatus("missing").state).toBe("missing");
    await executor.close();
  });

  it("rejects unknown and unoffered permission outcomes", () => {
    expect(() => normalizePermissionDecision("yes")).toThrow(/invalid/i);
    expect(() =>
      normalizePermissionDecision("allow_always", [
        "allow_once",
        "reject_once",
      ]),
    ).toThrow(/not offered/i);
    expect(normalizePermissionDecision("allow_once", ["allow_once"])).toEqual({
      outcome: "allow_once",
    });
    expect(normalizePermissionDecision("cancel", ["allow_once"])).toEqual({
      outcome: "cancel",
    });
  });

  it("settles pending permissions when a session is cancelled", async () => {
    const decisions: AcpPermissionDecision[] = [];
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: pendingPermissionRuntime(decisions),
    });
    await executor.startAcpSession(sink, { sessionId: "session-2" });
    await executor.promptAcpSession(sink, "session-2", "run");
    await expect
      .poll(
        () =>
          executor.getAcpSessionStatus("session-2").pendingPermissions.length,
      )
      .toBe(1);
    expect(() =>
      executor.respondAcpSession("session-2", "permission-1", "allow_always"),
    ).toThrow(/not offered/i);
    await executor.cancelAcpSession("session-2");
    expect(decisions).toEqual([{ outcome: "cancel" }]);
    expect(
      executor.getAcpSessionStatus("session-2").pendingPermissions,
    ).toEqual([]);
    await executor.close();
  });

  it("rejects a permission after its controlling connection expires", async () => {
    const decisions: AcpPermissionDecision[] = [];
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: pendingPermissionRuntime(decisions),
      disconnectGraceMs: 5,
    });
    await executor.startAcpSession(sink, { sessionId: "session-3" });
    await executor.promptAcpSession(sink, "session-3", "run");
    await expect
      .poll(
        () =>
          executor.getAcpSessionStatus("session-3").pendingPermissions.length,
      )
      .toBe(1);
    executor.disconnectConnection("connection-1");
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions).toEqual([{ outcome: "reject_once" }]);
    await executor.close();
  });
});

function inertRuntime(): CreateAcpxRuntime {
  return async () => ({
    async ensureSession(input) {
      return { sessionKey: input.sessionKey };
    },
    startTurn() {
      return {
        events: (async function* () {})(),
        result: Promise.resolve({ status: "completed" }),
      };
    },
    async cancel() {},
    async close() {},
  });
}

function pendingPermissionRuntime(
  decisions: AcpPermissionDecision[],
): CreateAcpxRuntime {
  return async (runtimeSink, sessionId, _payload, pending, context) => ({
    async ensureSession(input) {
      return { sessionKey: input.sessionKey };
    },
    startTurn() {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        events: (async function* () {
          const approval = ((decision: AcpPermissionDecision) => {
            decisions.push(decision);
            finish();
          }) as Parameters<typeof pending.set>[1];
          approval.options = ["allow_once", "reject_once"];
          approval.connectionId = context.connectionId;
          pending.set(`${sessionId}:permission-1`, approval);
          runtimeSink.sendRuntimeEvent({
            sessionId,
            type: "permission",
            request: { requestId: "permission-1" },
          });
          await finished;
        })(),
        result: finished.then(() => ({ status: "completed" })),
      };
    },
    async cancel() {},
    async close() {},
  });
}
