import { spawn } from "node:child_process";

export const MODEL_INVENTORY_TIMEOUT_MS = 10_000;

export type RunInventoryCommand = (
  command: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export type InventoryStdioProcess = {
  write(data: string): void;
  onData(listener: (chunk: string) => void): void;
  onClose(listener: (code: number | null) => void): void;
  kill(): void;
};

export type StartInventoryProcess = (
  command: string[],
  options?: { cwd?: string },
) => InventoryStdioProcess;

export function commandArgv(command: string | string[]): string[] {
  return Array.isArray(command)
    ? command.map((part) => part.trim()).filter(Boolean)
    : command
        .trim()
        .split(/\s+/u)
        .filter(Boolean);
}

export async function runInventoryCommand(
  command: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const [file, ...args] = command;
  if (!file) throw new Error("Model inventory command is empty");
  const timeoutMs = options.timeoutMs ?? MODEL_INVENTORY_TIMEOUT_MS;
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Model inventory timed out"));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function startInventoryProcess(
  command: string[],
  options: { cwd?: string } = {},
): InventoryStdioProcess {
  const [file, ...args] = command;
  if (!file) throw new Error("Model inventory command is empty");
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    write(data) {
      child.stdin.write(data);
    },
    onData(listener) {
      child.stdout.on("data", (chunk) => listener(String(chunk)));
    },
    onClose(listener) {
      child.on("close", (code) => listener(code));
    },
    kill() {
      child.kill();
    },
  };
}
