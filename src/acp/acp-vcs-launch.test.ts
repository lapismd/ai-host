import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { createAcpAgentRegistry, withAcpVcsEnvironment } from "./acp-agent";
import { createAgentRuntimeExecutor } from "../executor/executor";

test("scoped launch preserves literal arguments and exit status", () => {
  const value = "Nyra ' \" $(echo should-not-run)";
  const command = withAcpVcsEnvironment(
    [
      process.execPath,
      "-e",
      "console.log(JSON.stringify([process.env.JJ_USER,process.argv[1]]));process.exit(7)",
      "--",
      value,
    ],
    { JJ_USER: value },
  ) as string[];
  const result = spawnSync(command[0]!, command.slice(1), { encoding: "utf8" });
  expect(result.status).toBe(7);
  expect(JSON.parse(result.stdout)).toEqual([value, value]);
});

test("real acpx persists a session while the registered child receives VCS identity", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "acp-vcs-"));
  const output = join(workspace, "identity.json");
  const fake = `require("node:fs").writeFileSync(process.argv[1], JSON.stringify({name:process.env.JJ_USER,email:process.env.GIT_COMMITTER_EMAIL}));
require("node:readline").createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==="initialize"?{protocolVersion:1,agentCapabilities:{},authMethods:[]}:m.method==="session/new"?{sessionId:"fake-native"}:{};console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));});`;
  const executor = createAgentRuntimeExecutor({
    agentRegistry: createAcpAgentRegistry([
      {
        id: "fake",
        label: "Fake ACP",
        enabled: true,
        mcpTransport: "stdio",
        command: [process.execPath, "-e", fake, "--", output],
      },
    ]),
  });
  const original = process.env.JJ_USER;
  try {
    await executor.startAcpSession(
      {
        connectionId: "test",
        sendRuntimeEvent: () => {},
        sendProcessMessage: () => {},
      },
      {
        sessionId: "scoped-author",
        agent: "fake",
        workspace,
        metadata: {
          vcsIdentity: { name: "Nyra", email: "nyra@nostr.invalid" },
        },
      },
    );
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual({
      name: "Nyra",
      email: "nyra@nostr.invalid",
    });
    expect(process.env.JJ_USER).toBe(original);
  } finally {
    await executor.close();
    await rm(workspace, { recursive: true, force: true });
  }
}, 15000);
