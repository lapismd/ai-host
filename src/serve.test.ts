import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentRuntimeExecutor } from "./executor";
import { LOCAL_TESTING_TOKEN } from "./parse-cli";
import { serveAgentHost, type RunningAgentHost } from "./serve";

describe("serveAgentHost", () => {
  let host: RunningAgentHost | undefined;

  afterEach(async () => {
    await host?.close();
    host = undefined;
  });

  it("generates a token when one is omitted and prints it once", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "lapis-ai-host-"));
    const printed: string[] = [];
    host = await serveAgentHost(
      {
        command: "serve",
        port: 0,
        bind: "127.0.0.1",
        workspace,
        origins: [],
      },
      {
        executor: createAgentRuntimeExecutor({
          createAcpxRuntime: async () => {
            throw new Error("unused");
          },
        }),
        print: (line) => printed.push(line),
      },
    );
    expect(host.generatedToken).toBe(true);
    expect(host.token.length).toBeGreaterThan(20);
    expect(printed.filter((line) => line.startsWith("token:")).length).toBe(1);
    expect(printed.some((line) => line.includes(host!.url))).toBe(true);
  });

  it("prints the published local-testing token once", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "lapis-ai-host-"));
    const printed: string[] = [];
    host = await serveAgentHost(
      {
        command: "serve-local",
        port: 0,
        bind: "127.0.0.1",
        workspace,
        token: LOCAL_TESTING_TOKEN,
        origins: [],
      },
      {
        executor: createAgentRuntimeExecutor({
          createAcpxRuntime: async () => {
            throw new Error("unused");
          },
        }),
        print: (line) => printed.push(line),
      },
    );
    expect(host.generatedToken).toBe(false);
    expect(host.token).toBe(LOCAL_TESTING_TOKEN);
    expect(printed.filter((line) => line.startsWith("token:")).length).toBe(1);
    expect(printed.some((line) => line.includes("fixed local-testing token"))).toBe(
      true,
    );
  });
});
