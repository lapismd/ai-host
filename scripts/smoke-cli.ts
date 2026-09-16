import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BINARY, IS_AI } from "../src/cli/brand.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
const target = `${Deno.build.os === "darwin" ? "darwin" : "linux"}-${Deno.build.arch === "aarch64" ? "arm64" : "x64"}`;
const temporary = await Deno.makeTempDir({ prefix: "lapis-cli-smoke-" });
const binary = join(temporary, BINARY);
await Deno.copyFile(join(root, "artifacts", `${BINARY}-${target}`), binary);
await Deno.chmod(binary, 0o755);
const env = {
  HOME: temporary,
  PATH: join(temporary, "empty-bin"),
  XDG_CONFIG_HOME: join(temporary, "config"),
  XDG_STATE_HOME: join(temporary, "state"),
  XDG_CACHE_HOME: join(temporary, "cache"),
  DENO_DIR: join(temporary, "deno-cache"),
  SHELL: "/bin/sh",
  TMPDIR: temporary,
  NO_COLOR: "1",
};
await Deno.mkdir(env.PATH);
const workspace = join(temporary, "workspace");
await Deno.mkdir(workspace);
let child: Deno.ChildProcess | undefined;
let ws: WebSocket | undefined;
let output = "";
let errors = "";
const decoder = new TextDecoder();
const encode = new TextEncoder();
async function run(args: string[], expected = 0) {
  const result = await new Deno.Command(binary, {
    args,
    cwd: temporary,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = decoder.decode(result.stdout);
  if (result.code !== expected)
    throw new Error(
      `CLI ${args[0]} failed (${result.code}): ${text} ${decoder.decode(result.stderr)}`,
    );
  return JSON.parse(text);
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const frames: Record<string, unknown>[] = [];
async function until(test: () => boolean, timeout = 15000) {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > timeout)
      throw new Error(`Smoke timed out: ${output} ${errors}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function request(command: string, payload: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  ws!.send(JSON.stringify({ id, command, payload }));
  await until(() => frames.some((f) => f.id === id));
  const frame = frames.find((f) => f.id === id)!;
  if (frame.error) throw new Error(JSON.stringify(frame.error));
  return frame.result as Record<string, unknown>;
}
try {
  assert((await run(["--version", "--json"])).ok, "version");
  assert(
    (await run(["docs", "markdown-help", "--json"])).data.markdown.includes(
      "token show",
    ),
    "help",
  );
  const init = ["init", "--workspace", workspace, "--port", "0", "--json"];
  if (IS_AI) {
    const fixture = join(temporary, "fixture-acp");
    const status = await new Deno.Command(Deno.execPath(), {
      cwd: root,
      args: [
        "compile",
        "-A",
        "--output",
        fixture,
        "tests/fixtures/acp-agent.ts",
      ],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!status.success) throw new Error(decoder.decode(status.stderr));
    const registry = join(temporary, "agents.json");
    await Deno.writeTextFile(
      registry,
      JSON.stringify({
        agents: [
          {
            id: "fixture",
            label: "Fixture",
            enabled: true,
            command: [fixture],
            mcpTransport: "stdio",
          },
          {
            id: "codex",
            label: "Missing external agent",
            enabled: true,
            mcpTransport: "stdio",
          },
        ],
      }),
    );
    init.push("--agent-config", registry);
  }
  const initialized = await run(init);
  assert(
    !JSON.stringify(initialized).includes('"token":'),
    "init must not reveal token",
  );
  child = new Deno.Command(binary, {
    args: ["serve", "--json"],
    cwd: temporary,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stdout = (async () => {
    for await (const bytes of child!.stdout) output += decoder.decode(bytes);
  })();
  const stderr = (async () => {
    for await (const bytes of child!.stderr) errors += decoder.decode(bytes);
  })();
  let status: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) {
    status = (await run(["status", "--json"])).data;
    if (status.state === "running") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(status.state === "running", `host readiness: ${output} ${errors}`);
  const token = (await run(["token", "show", "--json"])).data.token;
  await run(["serve", "--json"], 1);
  const bad = new WebSocket(String(status.url));
  await new Promise<void>((r) =>
    bad.addEventListener("open", () => r(), { once: true }),
  );
  bad.send(JSON.stringify({ type: "hello", token: "wrong" }));
  await new Promise<void>((r) =>
    bad.addEventListener("close", () => r(), { once: true }),
  );
  ws = new WebSocket(String(status.url));
  ws.addEventListener("message", (e) =>
    frames.push(JSON.parse(String(e.data))),
  );
  await new Promise<void>((r) =>
    ws!.addEventListener("open", () => r(), { once: true }),
  );
  ws.send(JSON.stringify({ id: "hello", type: "hello", token }));
  await until(() => frames.some((f) => f.type === "hello.ok"));
  if (IS_AI) {
    const runtimes = (await run(["runtimes", "list", "--json"])).data.runtimes;
    assert(
      runtimes.some(
        (r: { id: string; available: boolean }) =>
          r.id === "codex" && !r.available,
      ),
      "missing external agent is reported without installation",
    );
    let missingFailed = false;
    try {
      await request("desktop_agent_acp_start", { agent: "codex", workspace });
    } catch {
      missingFailed = true;
    }
    assert(missingFailed, "missing external agent fails without installation");
    const session = await request("desktop_agent_acp_start", {
      agent: "fixture",
      workspace,
    });
    assert(session.sessionId, "ACP session");
    await request("desktop_agent_acp_prompt", {
      sessionId: session.sessionId,
      text: "fixture input",
    });
    await until(() => JSON.stringify(frames).includes("fixture-complete"));
    const sessions = (await run(["sessions", "list", "--json"])).data.sessions;
    assert(
      sessions.some(
        (s: { sessionId: string }) => s.sessionId === session.sessionId,
      ),
      "live AI inspection",
    );
    await request("desktop_agent_acp_close", { sessionId: session.sessionId });
    await mcpSmoke(binary, env);
  } else {
    const session = await request("terminal_session_create", {
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    assert(session.sessionId, "PTY session");
    await request("terminal_session_write", {
      sessionId: session.sessionId,
      data: btoa("printf 'PTY_SMOKE_OK\\n'\n"),
    });
    await request("terminal_session_resize", {
      sessionId: session.sessionId,
      cols: 100,
      rows: 30,
    });
    const control = new WebSocket(
      `${status.url}/terminal/control?token=${encodeURIComponent(token)}&sessionId=${session.sessionId}&clientId=smoke`,
    );
    const restore: Record<string, unknown>[] = [];
    control.addEventListener("message", (e) =>
      restore.push(JSON.parse(String(e.data))),
    );
    await until(() => restore.some((f) => f.type === "restore"));
    assert(restore[0].cols === 100, "PTY resize restore");
    const io = new WebSocket(
      `${status.url}/terminal/io?token=${encodeURIComponent(token)}&sessionId=${session.sessionId}&clientId=smoke`,
    );
    let bytes = "";
    io.binaryType = "arraybuffer";
    io.addEventListener("message", (e) => (bytes += decoder.decode(e.data)));
    await new Promise<void>((r) =>
      io.addEventListener("open", () => r(), { once: true }),
    );
    await request("terminal_session_write", {
      sessionId: session.sessionId,
      data: btoa("printf 'LIVE_PTY_OK\\n'\n"),
    });
    await until(() => bytes.includes("LIVE_PTY_OK"));
    await request("terminal_session_stop", { sessionId: session.sessionId });
    await until(() => restore.some((f) => f.type === "exit"));
    control.close();
    io.close();
  }
  for (const args of [
    ["status", "--watch", "--json"],
    ["logs", "--follow", "--json"],
  ]) {
    const stream = new Deno.Command(binary, {
      args,
      cwd: temporary,
      env,
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    let records = "";
    const reading = (async () => {
      for await (const bytes of stream.stdout) records += decoder.decode(bytes);
    })();
    try {
      await until(() => records.includes("\n"));
    } finally {
      stream.kill("SIGTERM");
      assert((await stream.status).success, "stream shutdown");
      await reading;
    }
    assert(
      records
        .trim()
        .split("\n")
        .every((line) => JSON.parse(line).schema === BINARY + ".cli/1"),
      "stream NDJSON",
    );
    assert(!records.includes(token), "stream token redaction");
  }
  ws.close();
  ws = undefined;
  child.kill("SIGTERM");
  const exited = await child.status;
  await Promise.all([stdout, stderr]);
  child = undefined;
  assert(exited.success, "shutdown");
  for (const line of output.trim().split("\n"))
    assert(JSON.parse(line).schema === BINARY + ".cli/1", "NDJSON stdout");
  assert(!output.includes(token) && !errors.includes(token), "token redaction");
  assert((await run(["status", "--json"])).data.state === "stopped", "stopped");
  await run(["sessions", "list", "--json"], 3);
  assert(
    !(await run(["logs", "--json"])).data.records.some((r: unknown) =>
      JSON.stringify(r).includes(token),
    ),
    "private logs",
  );
  // A crash leaves a socket on disk. A new process must recover it safely.
  for (const signal of ["SIGKILL", "SIGTERM"] as const) {
    child = new Deno.Command(binary, {
      args: ["serve", "--json"],
      cwd: temporary,
      env,
      clearEnv: true,
      stdout: "null",
      stderr: "null",
    }).spawn();
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if ((await run(["status", "--json"])).data.state === "running") {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(ready, "stale socket recovery");
    child.kill(signal);
    await child.status;
    child = undefined;
  }
  console.log(
    `${BINARY}: isolated binary, authentication, runtime, inspection, logs and shutdown passed`,
  );
} finally {
  ws?.close();
  if (child) {
    try {
      child.kill("SIGKILL");
    } catch {}
    await child.status;
  }
  await Deno.remove(temporary, { recursive: true });
}
async function mcpSmoke(binary: string, env: Record<string, string>) {
  if (!IS_AI) return;
  const { ToolBridgeBroker } = await import("../src/tool-bridge.ts");
  const broker = new ToolBridgeBroker({
    shimCommand: { command: binary, args: ["__internal", "mcp-shim"] },
  });
  const opened = await broker.open(
    { connectionId: "smoke", sendToolCall: () => {}, sendToolCancel: () => {} },
    {
      bindingId: "smoke",
      conversationId: "smoke",
      descriptors: [
        {
          name: "fixture_tool",
          description: "Fixture tool",
          inputSchema: { type: "object" },
          effect: "read",
        },
      ],
    },
  );
  const contribution = broker.serverContribution("smoke", opened.bridgeId);
  const shim = new Deno.Command(binary, {
    args: contribution.args,
    env: { ...env, ...contribution.env },
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const writer = shim.stdin.getWriter();
  const messages: Record<string, unknown>[] = [];
  let pending = "";
  const read = (async () => {
    for await (const b of shim.stdout) {
      pending += decoder.decode(b);
      while (pending.includes("\n")) {
        const end = pending.indexOf("\n");
        messages.push(JSON.parse(pending.slice(0, end)));
        pending = pending.slice(end + 1);
      }
    }
  })();
  try {
    await writer.write(
      encode.encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "smoke", version: "1" },
          },
        }) + "\n",
      ),
    );
    await until(() => messages.some((m) => m.id === 1));
    await writer.write(
      encode.encode(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) +
          "\n" +
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }) +
          "\n",
      ),
    );
    await until(() => messages.some((m) => m.id === 2));
    assert(
      JSON.stringify(messages).includes("fixture_tool"),
      "bundled MCP shim tools",
    );
  } finally {
    await writer.close();
    try {
      shim.kill("SIGTERM");
    } catch {}
    await shim.status;
    await read;
    await broker.close();
  }
}
