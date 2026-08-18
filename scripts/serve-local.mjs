import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LOCAL_SERVE_TOKEN_KEY = "LAPIS_AGENT_RUNTIME_TOKEN";
export const DEFAULT_LOCAL_SERVE_TOKEN = "lapis-ai-host-local";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function readEnvToken(contents) {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (key !== LOCAL_SERVE_TOKEN_KEY) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

export async function ensureLocalServeToken(
  envPath,
  defaultToken = DEFAULT_LOCAL_SERVE_TOKEN,
) {
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      try {
        await writeFile(envPath, `${LOCAL_SERVE_TOKEN_KEY}=${defaultToken}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
        return { token: defaultToken, created: true };
      } catch (writeError) {
        if (
          !writeError ||
          typeof writeError !== "object" ||
          !("code" in writeError) ||
          writeError.code !== "EEXIST"
        ) {
          throw writeError;
        }
        contents = await readFile(envPath, "utf8");
      }
    } else {
      throw error;
    }
  }

  const existing = readEnvToken(contents);
  if (existing) return { token: existing, created: false };

  const suffix = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
  await writeFile(
    envPath,
    `${contents}${suffix}${LOCAL_SERVE_TOKEN_KEY}=${defaultToken}\n`,
  );
  return { token: defaultToken, created: true };
}

export function buildServeArgs(extraArgs, token) {
  return ["serve", ...extraArgs, "--token", token];
}

async function main() {
  const envPath = join(packageRoot, ".env");
  const { token, created } = await ensureLocalServeToken(envPath);
  if (created) {
    console.log(`[serve:local] wrote ${LOCAL_SERVE_TOKEN_KEY} to ${envPath}`);
  }

  const extraArgs = process.argv.slice(2);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(packageRoot, "src/cli.ts"), ...buildServeArgs(extraArgs, token)],
    {
      cwd: packageRoot,
      stdio: "inherit",
    },
  );

  const shutdown = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) process.exit(code);
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  void main();
}
