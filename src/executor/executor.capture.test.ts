import { expect, it, vi } from "vitest";
import { createAgentRuntimeExecutor, type AcpxRuntimeLike } from "./executor";

it("preserves observable plans, tool structures and unknown records with explicit coverage", async () => {
  const observed = [
    { type: "status", tag: "plan", text: "Plan updated", entries: [{ content: "Read README", status: "in_progress", priority: "high" }] },
    { type: "tool_call", toolCallId: "tool-1", rawInput: { path: "/synthetic/workspace/README" }, locations: [{ path: "/synthetic/workspace/README", line: 4 }], content: [{ type: "diff", path: "README", oldText: "old", newText: "new" }] },
    { type: "provider_extension", data: { childSessionId: "child", initiatingToolId: "tool-1" } },
  ];
  const runtime: AcpxRuntimeLike = {
    async ensureSession(input) { return { sessionKey: input.sessionKey }; },
    startTurn() { return { events: (async function* () { for (const event of observed) yield event; })(), result: Promise.resolve({ status: "completed" }) }; },
    async cancel() {}, async close() {},
  };
  const sink = { sendRuntimeEvent: vi.fn(), sendProcessMessage: vi.fn() };
  const executor = createAgentRuntimeExecutor({ createAcpxRuntime: async () => runtime });
  const { sessionId } = await executor.startAcpSession(sink, { workspace: "/synthetic/workspace" });
  await executor.promptAcpSession(sink, sessionId, "read");
  await vi.waitFor(() => expect(sink.sendRuntimeEvent.mock.calls.some(([frame]) => frame.event?.event?.type === "done")).toBe(true));
  const payloads = sink.sendRuntimeEvent.mock.calls.map(([frame]) => frame.event?.event).filter(Boolean);
  expect(payloads).toContainEqual(expect.objectContaining({ type: "capture_coverage", sessionStorage: "volatile", excluded: expect.arrayContaining(["unexposed-acp-updates"]) }));
  for (const event of observed) expect(payloads).toContainEqual(event);
  await executor.closeAcpSession(sessionId);
});
