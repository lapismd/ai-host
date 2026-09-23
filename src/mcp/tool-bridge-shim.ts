import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveDefaultShimPath(moduleUrl = import.meta.url): string {
  let directory = path.dirname(fileURLToPath(moduleUrl));
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, "bin", "lapis-mcp-shim.mjs");
    if (existsSync(candidate)) return candidate;
    directory = path.dirname(directory);
  }
  return path.join(directory, "bin", "lapis-mcp-shim.mjs");
}

export function normalizeShimCommand(input: {
  command: string;
  args: string[];
}): {
  command: string;
  args: string[];
} {
  const command = input.command.trim();
  if (!command) throw new Error("MCP shim command must not be empty");
  if (!Array.isArray(input.args) || input.args.some((arg) => !arg.trim())) {
    throw new Error("MCP shim arguments must not be empty");
  }
  return { command, args: input.args.map((arg) => arg.trim()) };
}

export function validateListenPort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      "Tool bridge listen port must be an integer from 0 to 65535",
    );
  }
  return port;
}

export function normalizeExternalHttpBaseUrl(
  value: string | undefined,
): URL | null {
  if (value === undefined) return null;
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "External tool bridge URL must be an uncredentialed 127.0.0.1 HTTP URL",
    );
  }
  url.pathname = `${url.pathname.replace(/\/*$/u, "")}/`;
  return url;
}
