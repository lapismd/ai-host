import { describe, expect, it } from "vitest";
import { resolveAcpAgent } from "./acp-agent";
import { toAcpxSessionOptions } from "./acp-session-options";

describe("resolveAcpAgent", () => {
  it("prefers the first-class agent and defaults unknown names to codex", () => {
    expect(resolveAcpAgent({ agent: "cursor" })).toBe("cursor");
    expect(resolveAcpAgent({ metadata: { acpAgent: "cursor" } })).toBe("cursor");
    expect(resolveAcpAgent({ agent: "claude" })).toBe("codex");
    expect(resolveAcpAgent({})).toBe("codex");
  });
});

describe("toAcpxSessionOptions", () => {
  it("maps model and thinking to acpx session options", () => {
    expect(
      toAcpxSessionOptions({
        model: { provider: "codex", model: "gpt-5.4-medium" },
        thinking: "high",
      }),
    ).toEqual({ model: "gpt-5.4-medium", effort: "high" });
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
