import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createAcpAgentRegistry } from "../acp/acp-agent";
import { defaultCreateAcpxRuntime } from "./acpx-runtime";

test("real acpx retains a thread worker across turns and closes it on eviction", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "acpx-residency-"));
  const starts: number[] = [];
  const exits: number[] = [];
  const fake = `require("node:readline").createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};if(m.method==="initialize")result={protocolVersion:1,agentCapabilities:{},authMethods:[]};if(m.method==="session/new")result={sessionId:"fake-session"};if(m.method==="session/prompt")result={stopReason:"end_turn"};console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));});`;
  const agent = createAcpAgentRegistry([
    {
      id: "fake",
      label: "Fake ACP",
      enabled: true,
      mcpTransport: "stdio",
      command: [process.execPath, "-e", fake],
    },
  ]).resolve("fake");
  const runtime = await defaultCreateAcpxRuntime(
    { sendRuntimeEvent: () => {}, sendProcessMessage: () => {} },
    "thread",
    { workspace },
    new Map(),
    {
      agent,
      permissionTimeoutMs: 1_000,
      onProcessStarted: (pid) => starts.push(pid),
      onProcessExit: (pid) => exits.push(pid),
    },
  );
  try {
    const handle = await runtime.ensureSession({
      sessionKey: "thread",
      agent: "fake",
      mode: "persistent",
      cwd: workspace,
    });
    try {
      for (const requestId of ["first", "second"]) {
        const turn = runtime.startTurn({ handle, text: requestId, mode: "prompt", requestId });
        for await (const _event of turn.events) { /* Drain the public event stream. */ }
        await expect(turn.result).resolves.toMatchObject({ status: "completed" });
      }
      expect(starts).toHaveLength(1);
      expect(exits).toEqual([]);
    } finally {
      await runtime.close({ handle, reason: "idle eviction" });
    }
    await vi.waitFor(() => expect(exits).toEqual(starts));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}, 15_000);
