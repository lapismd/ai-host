import {
  REPLAY_MAX_BYTES,
  REPLAY_MAX_FRAMES,
  type NativeAgentRuntimeEvent,
  type RuntimeReplayCursor,
  type RuntimeReplaySubscription,
} from "./protocol";

type BufferedFrame = {
  event: NativeAgentRuntimeEvent;
  bytes: number;
};

type SessionReplayState = {
  frames: BufferedFrame[];
  bytes: number;
  latestSequence: number;
};

export class RuntimeEventReplayBuffer {
  readonly #sessions = new Map<string, SessionReplayState>();

  constructor(
    private readonly maxFrames = REPLAY_MAX_FRAMES,
    private readonly maxBytes = REPLAY_MAX_BYTES,
  ) {}

  append(event: NativeAgentRuntimeEvent): void {
    const state = this.#sessions.get(event.sessionId) ?? {
      frames: [],
      bytes: 0,
      latestSequence: 0,
    };
    if (event.sequence <= state.latestSequence) return;
    state.latestSequence = event.sequence;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (bytes <= this.maxBytes && this.maxFrames > 0) {
      state.frames.push({ event: structuredClone(event), bytes });
      state.bytes += bytes;
      while (
        state.frames.length > this.maxFrames ||
        state.bytes > this.maxBytes
      ) {
        const removed = state.frames.shift();
        if (removed) state.bytes -= removed.bytes;
      }
    } else {
      state.frames = [];
      state.bytes = 0;
    }
    this.#sessions.set(event.sessionId, state);
  }

  replay(
    cursors: RuntimeReplayCursor[],
    send: (event: NativeAgentRuntimeEvent) => void,
  ): RuntimeReplaySubscription[] {
    return cursors.map((cursor) => {
      const state = this.#sessions.get(cursor.sessionId);
      if (!state) {
        return {
          sessionId: cursor.sessionId,
          replayed: 0,
          latestSequence: 0,
          gap: cursor.afterSequence > 0,
        };
      }
      const firstSequence = state.frames[0]?.event.sequence;
      const gap =
        cursor.afterSequence < state.latestSequence &&
        (firstSequence == null || firstSequence > cursor.afterSequence + 1);
      const frames = state.frames.filter(
        (frame) => frame.event.sequence > cursor.afterSequence,
      );
      for (const frame of frames) send(structuredClone(frame.event));
      return {
        sessionId: cursor.sessionId,
        replayed: frames.length,
        latestSequence: state.latestSequence,
        gap,
      };
    });
  }

  clear(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }
}
