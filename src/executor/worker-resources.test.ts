import { describe, expect, it } from "vitest";
import { WorkerProcessRegistry } from "./worker-resources";

describe("owned ACP process resources", () => {
  it("deduplicates a shared worker and its descendants without counting other processes", async () => {
    const registry = new WorkerProcessRegistry(async () => [
      { pid: 10, parent: 1, rssKiB: 100 },
      { pid: 11, parent: 10, rssKiB: 50 },
      { pid: 12, parent: 11, rssKiB: 25 },
      { pid: 99, parent: 1, rssKiB: 999 },
    ]);
    registry.started("first", 10);
    registry.started("second", 10);
    const snapshot = await registry.snapshot([
      { sessionId: "first", state: "idle" },
      { sessionId: "second", state: "running" },
      { sessionId: "starting", state: "initializing" },
    ]);
    expect(snapshot.status).toBe("available");
    expect(snapshot.workers).toEqual({ busy: 1, idle: 0, starting: 1, stopping: 0 });
    expect(snapshot.sessions).toBe(3);
    expect(snapshot.rssBytes).toBe(175 * 1024);
  });

  it("reports partial or unavailable samples explicitly", async () => {
    const missing = new WorkerProcessRegistry(async () => []);
    missing.started("first", 10);
    expect((await missing.snapshot([{ sessionId: "first", state: "idle" }])).status)
      .toBe("partial");
    const failed = new WorkerProcessRegistry(async () => { throw new Error("ps failed"); });
    failed.started("first", 10);
    expect(await failed.snapshot([{ sessionId: "first", state: "idle" }]))
      .toMatchObject({ status: "unavailable", rssBytes: null });
    failed.exited("first", 10);
    expect((await failed.snapshot([])).workers.idle).toBe(0);
  });
});
