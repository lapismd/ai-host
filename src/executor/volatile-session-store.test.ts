import { expect, it } from "vitest";
import type { AcpSessionRecord } from "acpx/runtime";
import { VolatileSessionStore } from "./volatile-session-store";

const record = (id: string, text = "synthetic-secret") => ({ acpxRecordId: id, messages: [{ text }] }) as unknown as AcpSessionRecord;
it("retains independent records only until disposal", async () => {
  const store = new VolatileSessionStore();
  const source = record("one");
  await store.save(source);
  source.messages = [];
  const saved = await store.load("one");
  expect(saved?.messages).toHaveLength(1);
  saved!.messages = [];
  expect((await store.load("one"))?.messages).toHaveLength(1);
  store.dispose();
  expect(await store.load("one")).toBeUndefined();
  await expect(store.save(record("two"))).rejects.toThrow("session_store_closed");
});
it("bounds records and bytes without evicting or corrupting live sessions", async () => {
  const store = new VolatileSessionStore(200, 1);
  await store.save(record("one"));
  await expect(store.save(record("two"))).rejects.toThrow("session_store_limit");
  await expect(store.save(record("one", "x".repeat(200)))).rejects.toThrow("session_store_limit");
  expect((await store.load("one"))?.messages).toHaveLength(1);
  await store.save(record("one", "small"));
});
