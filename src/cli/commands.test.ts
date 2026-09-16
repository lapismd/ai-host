import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  stat,
  chmod,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("./host", () => ({
  runtimes: async () => [],
  prerequisite: async () => [],
  startHost: vi.fn(),
}));
import { runCli } from "./commands";
import { context, loadConfig } from "./config";
import { listenControl, query } from "./control";
import { serviceDefinition, installService, uninstallService } from "./service";
let temp = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = "";
});
async function setup() {
  temp = await mkdtemp(join(tmpdir(), "host-cli-test-"));
  vi.stubEnv("XDG_CONFIG_HOME", join(temp, "config"));
  vi.stubEnv("XDG_STATE_HOME", join(temp, "state"));
  return context({});
}
async function cli(...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    stdout: (v) => stdout.push(v),
    stderr: (v) => stderr.push(v),
  });
  return { code, stdout, stderr };
}
describe("operator lifecycle", () => {
  it("initializes idempotently, preserves conflicts, and reveals secrets only explicitly", async () => {
    const ctx = await setup();
    const secret = "private-test-connection-token";
    const first = await cli(
      "init",
      "--workspace",
      temp,
      "--port",
      "0",
      "--token",
      secret,
      "--json",
    );
    expect(first.code).toBe(0);
    expect(first.stdout.join()).not.toContain(secret);
    const original = await readFile(ctx.configPath, "utf8");
    expect((await stat(ctx.configPath)).mode & 0o077).toBe(0);
    expect(
      (await cli("init", "--workspace", temp, "--port", "0", "--json")).code,
    ).toBe(0);
    expect(
      (await cli("init", "--workspace", join(temp, "other"), "--json")).code,
    ).toBe(2);
    expect(await readFile(ctx.configPath, "utf8")).toBe(original);
    const token = await cli("token", "show", "--json");
    expect(JSON.parse(token.stdout[0]).data.token).toBe(secret);
    expect((await cli("config", "validate", "--json")).code).toBe(0);
    const config = await loadConfig(ctx, true);
    await chmod(config!.tokenFile, 0o644);
    expect((await cli("token", "show", "--json")).code).toBe(2);
  });
  it("initializes explicit paths without rotating a shared token or changing parent permissions", async () => {
    await setup();
    await chmod(temp, 0o755);
    const path = join(temp, "custom.json");
    const token = join(temp, "shared-token");
    await writeFile(token, "existing-secret\n", { mode: 0o600 });
    const args = [
      "init",
      "--config",
      path,
      "--workspace",
      temp,
      "--token-file",
      token,
      "--json",
    ];
    expect((await cli(...args)).code).toBe(0);
    expect((await stat(temp)).mode & 0o777).toBe(0o755);
    const defaults = context({});
    const conflict = await cli(
      "init",
      "--workspace",
      temp,
      "--token",
      "different-secret",
      "--json",
    );
    expect(conflict.code).toBe(0);
    expect(
      (
        await cli(
          "init",
          "--workspace",
          temp,
          "--token",
          "rotated-secret",
          "--json",
        )
      ).code,
    ).toBe(2);
    const stored = await loadConfig(defaults, true);
    expect((await readFile(stored!.tokenFile, "utf8")).trim()).toBe(
      "different-secret",
    );
    expect((await readFile(token, "utf8")).trim()).toBe("existing-secret");
  });
  it("concurrent initialization retains one complete credential", async () => {
    await setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        cli("init", "--workspace", temp, "--json"),
      ),
    );
    expect(results.every((r) => r.code === 0)).toBe(true);
    const token = await cli("token", "show", "--json");
    expect(JSON.parse(token.stdout[0]).data.token).toHaveLength(72);
  });
  it("returns parseable errors and service-unavailable codes", async () => {
    await setup();
    const bad = await cli(
      "status",
      "--token",
      "private-error-token",
      "--json",
      "--color",
      "always",
    );
    expect(bad.code).toBe(2);
    expect(bad.stdout).toHaveLength(1);
    expect(bad.stdout[0]).not.toContain("private-error-token");
    expect(bad.stdout[0]).not.toContain("\x1b");
    expect((await cli("sessions", "list", "--json")).code).toBe(3);
    expect((await cli("sessions", "show", "--json")).code).toBe(2);
    const stopped = await cli("status", "--json");
    expect(JSON.parse(stopped.stdout[0]).data.state).toBe("stopped");
  });
  it("bounds Unix socket paths under long runtime directories", async () => {
    await setup();
    vi.stubEnv("XDG_RUNTIME_DIR", "/tmp/" + "long".repeat(70));
    expect(Buffer.byteLength(context({}).socket)).toBeLessThan(100);
  });
  it("isolates control sockets and rejects duplicate ownership", async () => {
    const ctx = await setup();
    const server = await listenControl(ctx.socket, () => ({
      state: "running",
    }));
    try {
      expect(await query(ctx.socket, "status")).toEqual({ state: "running" });
      expect((await stat(ctx.socket)).mode & 0o077).toBe(0);
      await expect(listenControl(ctx.socket, () => null)).rejects.toThrow(
        /already running/,
      );
      expect(context({ instance: "other" }).socket).not.toBe(ctx.socket);
      expect(context({ config: join(temp, "different.json") }).socket).not.toBe(
        ctx.socket,
      );
    } finally {
      await server.close();
    }
  });
  it("renders isolated service definitions and preserves configuration on uninstall", async () => {
    const ctx = await setup();
    await cli("init", "--workspace", temp);
    const invocation = { command: "/opt/Lapis Host/bin", argsPrefix: [] };
    const mac = serviceDefinition(ctx.configPath, "default", {
      platform: "launchd",
      home: temp,
      invocation,
    });
    const linux = serviceDefinition(ctx.configPath, "default", {
      platform: "systemd",
      home: temp,
      invocation,
    });
    expect(mac.contents).toContain("/opt/Lapis Host/bin");
    expect(mac.contents).toContain("--json");
    expect(linux.contents).toContain('ExecStart="/opt/Lapis Host/bin"');
    expect(linux.contents).toContain(
      `Environment="XDG_STATE_HOME=${join(temp, "state")}"`,
    );
    expect(mac.contents).toContain("<key>XDG_STATE_HOME</key>");
    expect(
      serviceDefinition(ctx.configPath + "other", "default", {
        platform: "launchd",
        home: temp,
        invocation,
      }).id,
    ).not.toBe(mac.id);
    const run = vi.fn(async () => ({ code: 0, stdout: "active", stderr: "" }));
    await installService(linux, run);
    const firstContents = await readFile(linux.path, "utf8");
    run.mockClear();
    await installService(linux, run);
    expect(await readFile(linux.path, "utf8")).toBe(firstContents);
    expect(
      run.mock.calls.some((call: unknown[]) =>
        JSON.stringify(call).includes("daemon-reload"),
      ),
    ).toBe(false);
    await uninstallService(linux, run);
    expect(await readFile(ctx.configPath, "utf8")).toContain(temp);
  });
});
