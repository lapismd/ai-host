import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkerResources = {
  status: "available" | "partial" | "unavailable";
  observedAt: number;
  workers: { busy: number; idle: number; starting: number; stopping: number };
  sessions: number;
  rssBytes: number | null;
};

type ProcessRow = { pid: number; parent: number; rssKiB: number };

async function processTable(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss="], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/).map(Number);
    return fields.length === 3 && fields.every(Number.isSafeInteger)
      ? [{ pid: fields[0]!, parent: fields[1]!, rssKiB: fields[2]! }]
      : [];
  });
}

/** Tracks only processes launched by this executor. Sampling never starts an agent. */
export class WorkerProcessRegistry {
  readonly #roots = new Map<string, Set<number>>();
  constructor(readTable: () => Promise<ProcessRow[]> = processTable) {
    this.readTable = readTable;
  }
  private readonly readTable: () => Promise<ProcessRow[]>;

  started(sessionId: string, pid: number): void {
    if (!Number.isSafeInteger(pid) || pid <= 0) return;
    const roots = this.#roots.get(sessionId) ?? new Set<number>();
    roots.add(pid);
    this.#roots.set(sessionId, roots);
  }

  exited(sessionId: string, pid: number): void {
    const roots = this.#roots.get(sessionId);
    roots?.delete(pid);
    if (roots?.size === 0) this.#roots.delete(sessionId);
  }

  async snapshot(sessions: Array<{ sessionId: string; state: "initializing" | "running" | "idle" }>): Promise<WorkerResources> {
    const rootStates = new Map<number, "busy" | "idle">();
    let starting = 0;
    for (const session of sessions) {
      const roots = this.#roots.get(session.sessionId);
      if (session.state === "initializing" && !roots?.size) starting++;
      for (const pid of roots ?? []) {
        const state = session.state === "running" ? "busy" : "idle";
        if (state === "busy" || !rootStates.has(pid)) rootStates.set(pid, state);
      }
    }
    const base = {
      observedAt: Date.now(),
      workers: {
        busy: [...rootStates.values()].filter((value) => value === "busy").length,
        idle: [...rootStates.values()].filter((value) => value === "idle").length,
        starting,
        stopping: 0,
      },
      sessions: sessions.length,
    };
    try {
      const rows = await this.readTable();
      const byPid = new Map(rows.map((row) => [row.pid, row]));
      const children = new Map<number, number[]>();
      for (const row of rows) {
        const siblings = children.get(row.parent) ?? [];
        siblings.push(row.pid);
        children.set(row.parent, siblings);
      }
      const seen = new Set<number>();
      const pending = [...rootStates.keys()].filter((pid) => byPid.has(pid));
      while (pending.length) {
        const pid = pending.pop()!;
        if (seen.has(pid)) continue;
        seen.add(pid);
        pending.push(...(children.get(pid) ?? []));
      }
      const rssBytes = [...seen].reduce((sum, pid) => sum + byPid.get(pid)!.rssKiB * 1024, 0);
      return {
        ...base,
        status: [...rootStates.keys()].every((pid) => seen.has(pid))
          ? "available"
          : "partial",
        rssBytes,
      };
    } catch {
      return { ...base, status: "unavailable", rssBytes: null };
    }
  }
}
