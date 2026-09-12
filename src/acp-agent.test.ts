import { describe, expect, it } from "vitest";
import {
  createAcpAgentRegistry,
  parseAcpAgentDefinitions,
  resolveAcpAgent,
} from "./acp-agent";

describe("ACP agent registry", () => {
  it("defaults to Codex and resolves configured built-ins", () => {
    const registry = createAcpAgentRegistry();
    expect(resolveAcpAgent({}, registry).id).toBe("codex");
    expect(resolveAcpAgent({ agent: " cursor " }, registry)).toMatchObject({
      id: "cursor",
      mcpTransport: "http",
    });
  });

  it("accepts custom commands without exposing disabled definitions", () => {
    const registry = createAcpAgentRegistry([
      {
        id: "company-agent",
        label: "Company Agent",
        enabled: true,
        command: ["company-acp", "--stdio"],
        mcpTransport: "stdio",
      },
      {
        id: "disabled",
        label: "Disabled",
        enabled: false,
        mcpTransport: "stdio",
      },
    ]);
    expect(registry.list()).toEqual([
      {
        id: "company-agent",
        label: "Company Agent",
        enabled: true,
        command: ["company-acp", "--stdio"],
        mcpTransport: "stdio",
      },
    ]);
    expect(() => registry.resolve("disabled")).toThrow(/not enabled/i);
  });

  it("fails closed for blank, malformed, duplicate, and unknown agents", () => {
    const registry = createAcpAgentRegistry();
    expect(() => resolveAcpAgent({ agent: "" }, registry)).toThrow(/invalid/i);
    expect(() => resolveAcpAgent({ agent: "claude" }, registry)).toThrow(
      /not enabled/i,
    );
    expect(() =>
      createAcpAgentRegistry([
        {
          id: "custom",
          label: "One",
          enabled: true,
          mcpTransport: "stdio",
        },
        {
          id: "custom",
          label: "Two",
          enabled: true,
          mcpTransport: "stdio",
        },
      ]),
    ).toThrow(/duplicate/i);
  });

  it("parses operator configuration without accepting untyped commands", () => {
    expect(
      parseAcpAgentDefinitions({
        agents: [
          {
            id: "claude",
            label: "Claude",
            command: ["claude-agent-acp"],
          },
        ],
      }),
    ).toEqual([
      {
        id: "claude",
        label: "Claude",
        enabled: true,
        command: ["claude-agent-acp"],
        mcpTransport: "stdio",
      },
    ]);
    expect(() =>
      parseAcpAgentDefinitions({ agents: [{ command: [1] }] }),
    ).toThrow(/command/i);
  });
});
