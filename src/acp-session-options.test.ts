import { describe, expect, it } from "vitest";
import { resolveAcpAgent } from "./acp-agent";
import {
  toAcpxSessionOptions,
  toAcpxThinkingValue,
} from "./acp-session-options";

describe("resolveAcpAgent", () => {
  it("prefers the first-class agent and defaults unknown names to codex", () => {
    expect(resolveAcpAgent({ agent: "cursor" })).toBe("cursor");
    expect(resolveAcpAgent({ metadata: { acpAgent: "cursor" } })).toBe(
      "cursor",
    );
    expect(resolveAcpAgent({ agent: "claude" })).toBe("codex");
    expect(resolveAcpAgent({})).toBe("codex");
  });
});

describe("toAcpxSessionOptions", () => {
  it("maps only model to acpx session options", () => {
    expect(
      toAcpxSessionOptions({
        model: { provider: "codex", model: "gpt-5.4-medium" },
        thinking: "high",
      }),
    ).toEqual({ model: "gpt-5.4-medium" });
  });

  it("omits thinking when it is off", () => {
    expect(
      toAcpxSessionOptions({
        model: { provider: "codex", model: "gpt-5.6-sol" },
        thinking: "off",
      }),
    ).toEqual({ model: "gpt-5.6-sol" });
  });

  it("returns an empty object when neither field is set", () => {
    expect(toAcpxSessionOptions({})).toEqual({});
  });
});

describe("toAcpxThinkingValue", () => {
  it("maps the UI off value to Codex none and preserves other agents", () => {
    expect(toAcpxThinkingValue({ agent: "codex", thinking: "off" })).toBe(
      "none",
    );
    expect(toAcpxThinkingValue({ agent: "cursor", thinking: "off" })).toBe(
      "off",
    );
    expect(toAcpxThinkingValue({ agent: "codex", thinking: "high" })).toBe(
      "high",
    );
  });
});
