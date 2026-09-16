import { constants } from "node:fs";
import {
  chmod,
  lstat,
  link,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  access,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { BINARY, IS_AI } from "./brand";
import { CliError, type HostConfig } from "./types";
import type { Arguments } from "./args";
export type Context = ReturnType<typeof context>;
export function context(options: Arguments["options"]) {
  const instance = String(options.instance ?? "default");
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(instance))
    throw new CliError("invalid_instance", "Invalid instance name");
  const configPath = resolve(
    String(
      options.config ??
        join(
          process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
          BINARY,
          instance + ".json",
        ),
    ),
  );
  const hash = createHash("sha256")
    .update(BINARY + "\0" + configPath + "\0" + instance)
    .digest("hex")
    .slice(0, 16);
  const state = resolve(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    BINARY,
    instance + "-" + hash,
  );
  const socketName = `lapis-${process.getuid?.() ?? 0}-${hash}`;
  const runtimeBase = process.env.XDG_RUNTIME_DIR || tmpdir();
  const candidate = join(runtimeBase, socketName, "control.sock");
  const socket =
    Buffer.byteLength(candidate) < 100
      ? candidate
      : join("/tmp", socketName, "control.sock");
  return { instance, configPath, state, socket };
}
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new CliError(
      "unsafe_path",
      "Private directory is not owned by this user",
      1,
    );
  await chmod(path, 0o700);
}
export async function readPrivate(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new CliError(
        "unsafe_permissions",
        `Expected an owner-only file: ${path}`,
      );
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}
export async function atomicWrite(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + randomUUID() + ".tmp";
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export async function loadConfig(
  ctx: Context,
  required = false,
): Promise<HostConfig | undefined> {
  try {
    const text = await readPrivate(ctx.configPath);
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new CliError("invalid_config", "Configuration is not valid JSON");
    }
    return validateConfig(input, dirname(ctx.configPath));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      if (!required) return undefined;
      throw new CliError("invalid_config", "Configuration file does not exist");
    }
    throw e;
  }
}
export function validateConfig(
  input: unknown,
  base = process.cwd(),
): HostConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CliError(
      "invalid_config",
      "Expected a host configuration object",
    );
  const c = input as HostConfig;
  if (
    c.schema !== BINARY + ".config/1" ||
    typeof c.workspace !== "string" ||
    !c.workspace.trim() ||
    typeof c.bind !== "string" ||
    !c.bind.trim() ||
    !Number.isInteger(c.port) ||
    c.port < 0 ||
    c.port > 65535 ||
    !Array.isArray(c.origins) ||
    !c.origins.every((o) => typeof o === "string" && !!o) ||
    typeof c.tokenFile !== "string" ||
    !c.tokenFile
  )
    throw new CliError("invalid_config", "Invalid host configuration fields");
  if (
    !["127.0.0.1", "localhost", "::1"].includes(c.bind) &&
    c.origins.length === 0
  )
    throw new CliError(
      "invalid_config",
      "Non-localhost --bind requires at least one --origin allowlist entry",
    );
  if (
    c.profile !== undefined &&
    (!IS_AI || !["trusted", "controller"].includes(c.profile))
  )
    throw new CliError("invalid_config", "Invalid AI profile");
  if (
    c.agentConfig !== undefined &&
    (typeof c.agentConfig !== "string" || !c.agentConfig)
  )
    throw new CliError("invalid_config", "Invalid agent registry path");
  return {
    schema: c.schema,
    workspace: resolve(base, c.workspace),
    bind: c.bind,
    port: c.port,
    origins: [...c.origins],
    tokenFile: resolve(base, c.tokenFile),
    ...(IS_AI ? { profile: c.profile ?? "trusted" } : {}),
    ...(c.agentConfig ? { agentConfig: resolve(base, c.agentConfig) } : {}),
  };
}
export function effectiveConfig(
  ctx: Context,
  options: Arguments["options"],
  stored?: HostConfig,
): HostConfig {
  const defaults = {
    schema: BINARY + ".config/1",
    workspace: IS_AI ? "./tmp/agent-workspace" : "./tmp/terminal-workspace",
    bind: "127.0.0.1",
    port: IS_AI ? 7345 : 7346,
    origins: [],
    tokenFile: join(ctx.state, "token"),
  };
  const c = { ...defaults, ...stored };
  for (const key of ["workspace", "bind", "profile"] as const)
    if (options[key] !== undefined)
      Object.assign(c, { [key]: String(options[key]) });
  if (options.port !== undefined) c.port = Number(options.port);
  if (options.origin) c.origins = options.origin as string[];
  if (options["token-file"])
    c.tokenFile = resolve(String(options["token-file"]));
  if (options["agent-config"])
    Object.assign(c, { agentConfig: resolve(String(options["agent-config"])) });
  return validateConfig(c);
}
export async function tokenValue(
  config: HostConfig,
  supplied?: string,
  create = false,
): Promise<string> {
  if (supplied) {
    if (!supplied.trim())
      throw new CliError("invalid_token", "Token must not be empty");
    return supplied.trim();
  }
  try {
    const token = (await readPrivate(config.tokenFile)).trim();
    if (!token) throw new CliError("invalid_token", "Token file is empty");
    return token;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if (!create)
      throw new CliError("invalid_token", "Token file does not exist");
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  await createTokenFile(config.tokenFile, token);
  return tokenValue(config);
}
async function createTokenFile(path: string, token: string) {
  const temporary = path + ".init-" + randomUUID();
  await atomicWrite(temporary, token + "\n");
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary);
  }
}

export async function executable(command: string): Promise<string | null> {
  const paths = command.includes("/")
    ? [resolve(command)]
    : (process.env.PATH ?? "")
        .split(":")
        .filter(Boolean)
        .map((p) => join(p, command));
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      if ((await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink())
        return path;
    } catch {}
  }
  return null;
}

export async function initializeToken(config: HostConfig, supplied?: string) {
  if (supplied === undefined) return tokenValue(config, undefined, true);
  const token = await tokenValue(config, supplied);
  await createTokenFile(config.tokenFile, token);
  if ((await tokenValue(config)) !== token)
    throw new CliError(
      "config_conflict",
      "Existing token differs; init never rotates credentials",
    );
  return token;
}
