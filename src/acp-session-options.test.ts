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

  it("appends a path-free available_skills manifest", () => {
    const manifest = [
      "<available_skills>",
      "  <skill><name>research-notes</name></skill>",
      "</available_skills>",
    ].join("\n");
    expect(
      toAcpxSessionOptions({
        model: { provider: "codex", model: "gpt-5.4-medium" },
        metadata: { availableSkillsManifest: manifest },
      }),
    ).toEqual({
      model: "gpt-5.4-medium",
      systemPrompt: { append: manifest },
    });
  });

  it("appends path-free sessionBootstrap with the skills manifest", () => {
    const bootstrap = [
      "<lapis_context>",
      "Use application tools for notes.",
      "</lapis_context>",
    ].join("\n");
    const manifest = [
      "<available_skills>",
      "  <skill><name>research-notes</name></skill>",
      "</available_skills>",
    ].join("\n");
    expect(
      toAcpxSessionOptions({
        metadata: {
          sessionBootstrap: bootstrap,
          availableSkillsManifest: manifest,
        },
      }),
    ).toEqual({
      systemPrompt: { append: `${bootstrap}\n\n${manifest}` },
    });
  });

  it("omits path-bearing bootstrap text", () => {
    expect(
      toAcpxSessionOptions({
        metadata: {
          sessionBootstrap:
            "<lapis_context>/Users/steve/vault</lapis_context>",
        },
      }),
    ).toEqual({});
  });

  it("omits path-bearing or non-manifest metadata", () => {
    expect(
      toAcpxSessionOptions({
        metadata: {
          availableSkillsManifest:
            "<available_skills>Notes/.agents/skills/research-notes</available_skills>",
        },
      }),
    ).toEqual({});
    expect(
      toAcpxSessionOptions({
        metadata: { availableSkillsManifest: "just a note" },
      }),
    ).toEqual({});
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
