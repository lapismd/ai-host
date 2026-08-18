import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentRuntimeExecutor } from "./executor";
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
});
