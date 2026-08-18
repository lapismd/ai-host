import { isLoopbackBind } from "./token";

export const DEFAULT_SERVE_PORT = 7345;
export const DEFAULT_SERVE_BIND = "127.0.0.1";
export const DEFAULT_SERVE_WORKSPACE = "./tmp/agent-workspace";
export const LOCAL_TESTING_TOKEN = "lapis-ai-host-local";

export type ServeCommand = "serve" | "serve-local";

export type ServeArgs = {
  command?: ServeCommand;
  port: number;
  bind: string;
  workspace: string;
  token?: string;
  origins: string[];
};

export type ParsedCli =
  | { ok: true; args: ServeArgs }
  | { ok: false; error: string }
  | { ok: false; help: true };

const USAGE =
  "Usage: lapis-ai-host <serve|serve-local> [--port 7345] [--bind 127.0.0.1] [--workspace <path>] [--token <token>] [--origin <url>]";

export function parseServeArgs(argv: string[]): ParsedCli {
  if (argv.includes("-h") || argv.includes("--help")) {
    return { ok: false, help: true };
  }
  const [command, ...rest] = argv;
  if (command !== "serve" && command !== "serve-local") {
    return { ok: false, error: USAGE };
  }

  const args: ServeArgs = {
    command,
    port: DEFAULT_SERVE_PORT,
    bind: DEFAULT_SERVE_BIND,
    workspace: DEFAULT_SERVE_WORKSPACE,
    origins: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === "--port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        return { ok: false, error: `${command} --port must be an integer 0-65535` };
      }
      args.port = port;
      index += 1;
      continue;
    }
    if (flag === "--bind") {
      if (!value) return { ok: false, error: `${command} --bind requires a host` };
      args.bind = value;
      index += 1;
      continue;
    }
    if (flag === "--workspace") {
      if (!value) return { ok: false, error: `${command} --workspace requires a path` };
      args.workspace = value;
      index += 1;
      continue;
    }
    if (flag === "--token") {
      if (command === "serve-local") {
        return {
          ok: false,
          error: "serve-local uses a fixed token; do not pass --token",
        };
      }
      if (!value?.trim()) {
        return { ok: false, error: "serve --token must be a non-empty token" };
      }
      args.token = value;
      index += 1;
      continue;
    }
    if (flag === "--origin") {
      if (!value) return { ok: false, error: `${command} --origin requires a URL` };
      args.origins.push(value);
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${flag}` };
  }

  if (command === "serve-local") {
    if (!isLoopbackBind(args.bind)) {
      return {
        ok: false,
        error: "serve-local must bind localhost",
      };
    }
    args.token = LOCAL_TESTING_TOKEN;
    return { ok: true, args };
  }

  if (!isLoopbackBind(args.bind) && args.origins.length === 0) {
    return {
      ok: false,
      error: "Non-localhost --bind requires at least one --origin allowlist entry",
    };
  }

  return { ok: true, args };
}

export function formatCliHelp(): string {
  return [
    "Usage: lapis-ai-host <serve|serve-local> [options]",
    "",
    "Commands:",
    "  serve         Start the host (generates a token when --token is omitted)",
    "  serve-local   Start the host with a fixed token for loopback local testing",
    "",
    "  --port <number>       Listen port (default 7345)",
    "  --bind <host>         Bind address (default 127.0.0.1)",
    "  --workspace <path>    Executor workspace root (default ./tmp/agent-workspace)",
    "  --token <token>       Required handshake token for serve (generated when omitted)",
    "  --origin <url>        Allowed Origin for non-localhost serve binds (repeatable)",
  ].join("\n");
}
