import { describe, expect, it } from "vitest";
import {
  acpLaunchPolicy,
  effectiveAcpPermissionMode,
} from "./acp-execution-policy";

describe("native ACP allow-all policy", () => {
  it("adds Cursor force before the ACP subcommand", () => {
    expect(
      acpLaunchPolicy(["cursor-agent", "acp"], {
        agentId: "cursor",
        approvalPolicy: "allow-all",
      }),
    ).toEqual({
      command: ["cursor-agent", "--force", "acp"],
      environment: {},
      nativeMode: { requested: "full-access", effective: "--force" },
    });
  });

  it("gives OpenCode process-scoped full-access rules", () => {
    const policy = acpLaunchPolicy(["opencode", "acp"], {
      agentId: "opencode",
      approvalPolicy: "allow-all",
    });
    expect(policy.command).toEqual(["opencode", "acp"]);
    expect(JSON.parse(policy.environment.OPENCODE_PERMISSION!)).toEqual({
      "*": "allow",
      external_directory: "allow",
    });
    expect(policy.nativeMode).toEqual({
      requested: "full-access",
      effective: "permission:*:allow",
    });
  });

  it("starts Codex in full access and selects its advertised mode", () => {
    const policy = acpLaunchPolicy(["codex-acp"], {
      agentId: "codex",
      approvalPolicy: "allow-all",
    });
    expect(policy.environment).toEqual({
      INITIAL_AGENT_MODE: "agent-full-access",
    });
    expect(policy.configureMode).toBe("agent-full-access");
    expect(effectiveAcpPermissionMode("codex", {
      approvalPolicy: "allow-all",
    })).toBe("agent-full-access");
  });

  it("does not relax Ask or restricted sessions", () => {
    const command = ["cursor-agent", "acp"];
    expect(
      acpLaunchPolicy(command, { agentId: "cursor", approvalPolicy: "ask" }),
    ).toEqual({ command, environment: {} });
    expect(
      acpLaunchPolicy(command, {
        agentId: "cursor",
        approvalPolicy: "allow-all",
        restricted: true,
      }),
    ).toEqual({ command, environment: {} });
  });

  it("preserves explicit legacy modes for custom agents", () => {
    expect(
      effectiveAcpPermissionMode("company", {
        approvalPolicy: "allow-all",
        permissionMode: "trusted",
      }),
    ).toBe("trusted");
    expect(
      effectiveAcpPermissionMode("cursor", {
        approvalPolicy: "ask",
        permissionMode: "legacy-full",
      }),
    ).toBeUndefined();
    expect(
      effectiveAcpPermissionMode("cursor", { permissionMode: "legacy-full" }),
    ).toBe("legacy-full");
  });
});
