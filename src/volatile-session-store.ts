import type { AcpSessionRecord, AcpSessionStore } from "acpx/runtime";

/** Native execution state only. Canonical transcript durability belongs upstream. */
export class VolatileSessionStore implements AcpSessionStore {
  #records = new Map<string, { bytes: number; record: AcpSessionRecord }>();
  #bytes = 0;
  #closed = false;
  constructor(private readonly maxBytes = 16 * 1024 * 1024, private readonly maxRecords = 16) {}
  async load(id: string): Promise<AcpSessionRecord | undefined> {
    const item = this.#records.get(id);
    return item ? structuredClone(item.record) : undefined;
  }
  async save(record: AcpSessionRecord): Promise<void> {
    if (this.#closed) throw new Error("session_store_closed");
    const bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    const previous = this.#records.get(record.acpxRecordId);
    const total = this.#bytes - (previous?.bytes ?? 0) + bytes;
    if (total > this.maxBytes || (!previous && this.#records.size >= this.maxRecords)) {
      throw new Error("session_store_limit");
    }
    this.#records.set(record.acpxRecordId, { bytes, record: structuredClone(record) });
    this.#bytes = total;
  }
  dispose(): void { this.#closed = true; this.#records.clear(); this.#bytes = 0; }
}
