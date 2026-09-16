import { createConnection, createServer, type Socket } from "node:net";
import { lstat, unlink, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { privateDirectory } from "./config";
import { CliError } from "./types";
const MAX = 1024 * 1024;
export async function query(path: string, method: string): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    let settled = false;
    const finish = (error?: unknown, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new CliError("unavailable", "Host control request timed out", 3),
        ),
      2000,
    );
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify({ method }) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX)
        return finish(
          new CliError("invalid_response", "Control response too large", 1),
        );
      if (buffer.includes("\n")) {
        try {
          const r = JSON.parse(buffer.split("\n")[0]);
          finish(
            r.ok
              ? undefined
              : new CliError(
                  "control_failed",
                  r.error ?? "Control request failed",
                  1,
                ),
            r.data,
          );
        } catch {
          finish(
            new CliError("invalid_response", "Invalid control response", 1),
          );
        }
      }
    });
    socket.on("error", (cause: NodeJS.ErrnoException) =>
      finish(
        Object.assign(
          new CliError(
            "unavailable",
            "Host is not running or control socket is unavailable",
            3,
          ),
          { socketCode: cause.code },
        ),
      ),
    );
    socket.on("close", () =>
      finish(
        new CliError("unavailable", "Host closed the control connection", 3),
      ),
    );
  });
}
export async function listenControl(
  path: string,
  handler: (method: string) => unknown,
) {
  await privateDirectory(dirname(path));
  try {
    const stat = await lstat(path);
    if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid()))
      throw new CliError(
        "unsafe_socket",
        "Refusing to replace a non-owned socket",
        1,
      );
    try {
      await query(path, "ping");
      throw new CliError(
        "already_running",
        "This host instance is already running",
        1,
      );
    } catch (e) {
      if (
        !(e instanceof CliError) ||
        !["ENOENT", "ECONNREFUSED"].includes(
          (e as CliError & { socketCode?: string }).socketCode ?? "",
        )
      )
        throw e;
    }
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const clients = new Set<Socket>();
  const server = createServer((socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(2000, () => socket.destroy());
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return;
      buffer += chunk;
      if (buffer.length > MAX) {
        socket.destroy();
        return;
      }
      if (!buffer.includes("\n")) return;
      handled = true;
      try {
        const req = JSON.parse(buffer.split("\n")[0]);
        const data = handler(req.method);
        socket.end(JSON.stringify({ ok: true, data }) + "\n");
      } catch {
        socket.end(
          JSON.stringify({ ok: false, error: "Invalid control request" }) +
            "\n",
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { chmod } = await import("node:fs/promises");
  await chmod(path, 0o600);
  return {
    async close() {
      for (const socket of clients) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await unlink(path).catch(() => {});
      await rmdir(dirname(path)).catch(() => {});
    },
  };
}
