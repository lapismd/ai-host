import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runtimes } from "./host";
import { context, effectiveConfig } from "./config";
let temp: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (temp) await rm(temp, { recursive: true, force: true });
});
it("reports missing external agents without installing them and classifies invalid registries", async () => {
  temp = await mkdtemp(join(tmpdir(), "host-registry-"));
  const agentConfig = join(temp, "agents.json");
  await writeFile(
    agentConfig,
    JSON.stringify({ agents: [{ id: "codex", label: "Codex" }] }),
  );
  vi.stubEnv("PATH", "");
  const config = effectiveConfig(context({}), { "agent-config": agentConfig });
  expect(await runtimes(config)).toMatchObject([
    { id: "codex", available: false },
  ]);
  expect(await readdir(temp)).toEqual(["agents.json"]);
  await writeFile(agentConfig, "invalid-json");
  await expect(runtimes(config)).rejects.toMatchObject({
    code: "invalid_config",
    exitCode: 2,
  });
});
