import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { privateDirectory, type Context } from "./config";
export type LogRecord = {
  id: string;
  time: string;
  event: string;
  data: Record<string, unknown>;
};
export async function logger(ctx: Context) {
  await privateDirectory(ctx.state);
  const path = join(ctx.state, "operations.ndjson");
  let queue = Promise.resolve();
  return {
    write(event: string, data: Record<string, unknown>) {
      const record = {
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        event,
        data,
      };
      queue = queue.then(async () => {
        if (
          (await stat(path).catch(() => ({ size: 0 }))).size >
          10 * 1024 * 1024
        ) {
          await unlink(path + ".3").catch(() => {});
          for (let i = 2; i >= 1; i--)
            await rename(path + "." + i, path + "." + (i + 1)).catch(() => {});
          await rename(path, path + ".1");
        }
        const f = await open(path, "a", 0o600);
        try {
          await f.writeFile(JSON.stringify(record) + "\n");
        } finally {
          await f.close();
        }
      });
      return queue;
    },
    flush() {
      return queue;
    },
  };
}
export async function readLogs(
  ctx: Context,
  lines: number,
): Promise<LogRecord[]> {
  const path = join(ctx.state, "operations.ndjson");
  const records: LogRecord[] = [];
  for (const file of [path + ".3", path + ".2", path + ".1", path]) {
    const text = await readFile(file, "utf8").catch((e) => {
      if (e.code === "ENOENT") return "";
      throw e;
    });
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        records.push(JSON.parse(line));
      } catch {
        /* Ignore an incomplete final record. */
      }
    }
  }
  return records.slice(-lines);
}
