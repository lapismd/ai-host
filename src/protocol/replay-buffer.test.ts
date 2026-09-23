import { describe, expect, it, vi } from "vitest";
import { RuntimeEventReplayBuffer } from "./replay-buffer";
import type { NativeAgentRuntimeEvent } from "./protocol";

function frame(
  sequence: number,
  text = `event-${sequence}`,
): NativeAgentRuntimeEvent {
  return {
    sessionId: "session-1",
    runId: "run-1",
    sequence,
    event: { type: "event", event: { type: "text_delta", text } },
  };
}

describe("RuntimeEventReplayBuffer", () => {
  it("replays ordered frames after the requested cursor", () => {
    const buffer = new RuntimeEventReplayBuffer();
    buffer.append(frame(1));
    buffer.append(frame(2));
    buffer.append(frame(3));
    const send = vi.fn();

    expect(
      buffer.replay([{ sessionId: "session-1", afterSequence: 1 }], send),
    ).toEqual([
      {
        sessionId: "session-1",
        replayed: 2,
        latestSequence: 3,
        gap: false,
      },
    ]);
    expect(send.mock.calls.map(([event]) => event.sequence)).toEqual([2, 3]);
  });

  it("reports an evicted cursor as a replay gap", () => {
    const buffer = new RuntimeEventReplayBuffer(2, 1024 * 1024);
    buffer.append(frame(1));
    buffer.append(frame(2));
    buffer.append(frame(3));

    expect(
      buffer.replay([{ sessionId: "session-1", afterSequence: 0 }], () => {}),
    ).toMatchObject([{ latestSequence: 3, gap: true }]);
  });

  it("drops state on explicit close", () => {
    const buffer = new RuntimeEventReplayBuffer();
    buffer.append(frame(1));
    buffer.clear("session-1");
    expect(
      buffer.replay([{ sessionId: "session-1", afterSequence: 0 }], () => {}),
    ).toEqual([
      {
        sessionId: "session-1",
        replayed: 0,
        latestSequence: 0,
        gap: false,
      },
    ]);
  });
});
