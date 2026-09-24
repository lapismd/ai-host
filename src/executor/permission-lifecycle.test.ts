import { expect, it, vi } from "vitest";
import type { PendingAcpApproval } from "./types";
import { defaultCreateAcpxRuntime } from "./acpx-runtime";
import { createAcpAgentRegistry } from "../acp/acp-agent";

const fake = vi.hoisted(() => ({ options: {} as Record<string, unknown> }));
vi.mock("acpx/runtime", () => ({
  createAgentRegistry: () => ({}),
  createAcpRuntime: (options: Record<string, unknown>) => {
    fake.options = options;
    return { ensureSession: async () => ({}), close: async () => {} };
  },
}));

it.each(["resolved", "expired", "cancelled"] as const)("emits one %s settlement with the original identity and deadline", async state => {
  const sink = { sendRuntimeEvent: vi.fn(), sendProcessMessage: vi.fn() };
  const pending = new Map<string, PendingAcpApproval>();
  const abort = new AbortController();
  const runtime = await defaultCreateAcpxRuntime(sink, "session", {}, pending, {
    agent: createAcpAgentRegistry().resolve("codex"), permissionTimeoutMs: state === "expired" ? 5 : 1000,
  });
  try {
    const request = fake.options.onPermissionRequest as (value: unknown, context: { signal: AbortSignal }) => Promise<unknown>;
    const result = request({ raw: { toolCall: { toolCallId: "tool" }, options: [{ optionId: "exact", kind: "allow_once" }] } }, { signal: abort.signal });
    if (state === "resolved") pending.get("session:tool")!({ outcome: "allow_once" });
    if (state === "cancelled") abort.abort();
    await result;
    const events = sink.sendRuntimeEvent.mock.calls.map(([event]) => event);
    expect(events).toHaveLength(2);
    expect(events[0].request.state).toBe("pending");
    expect(events[1].request).toMatchObject({ requestId: "tool", state, expiresAt: events[0].request.expiresAt });
    expect(pending.size).toBe(0);
    abort.abort();
    expect(sink.sendRuntimeEvent).toHaveBeenCalledTimes(2);
  } finally { await runtime.close({ handle: { sessionKey: "session" }, reason: "test" }); }
});

it("registers the approval before publishing it to a synchronous consumer", async () => {
  const pending = new Map<string, PendingAcpApproval>();
  const sink = { sendProcessMessage: vi.fn(), sendRuntimeEvent: vi.fn((event: any) => {
    if (!event.request.state || event.request.state === "pending") pending.get("session:tool")?.({ outcome: "allow_once" });
  }) };
  const runtime = await defaultCreateAcpxRuntime(sink, "session", {}, pending, {
    agent: createAcpAgentRegistry().resolve("codex"), permissionTimeoutMs: 5,
  });
  try {
    const request = fake.options.onPermissionRequest as (value: unknown) => Promise<unknown>;
    expect(await request({ raw: { toolCall: { toolCallId: "tool" }, options: [{ optionId: "exact", kind: "allow_once" }] } })).toEqual({ outcome: "allow_once" });
  } finally { await runtime.close({ handle: { sessionKey: "session" }, reason: "test" }); }
});
