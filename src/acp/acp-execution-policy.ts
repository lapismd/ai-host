export type AcpApprovalPolicy = "ask" | "allow-all";

type PolicyInput = {
  approvalPolicy?: AcpApprovalPolicy;
  permissionMode?: string;
  restricted?: boolean;
};

export type AcpLaunchPolicy = {
  command: string | string[];
  environment: Record<string, string>;
  configureMode?: string;
  nativeMode?: { requested: string; effective: string };
};

const BUILT_INS = new Set(["codex", "cursor", "opencode"]);

/** Apply provider-native full access before acpx starts the agent process. */
export function acpLaunchPolicy(
  command: string | string[],
  input: PolicyInput & { agentId: string },
): AcpLaunchPolicy {
  if (input.restricted || input.approvalPolicy !== "allow-all")
    return { command, environment: {} };
  if (input.agentId === "cursor") {
    return {
      command: cursorForceCommand(command),
      environment: {},
      nativeMode: { requested: "full-access", effective: "--force" },
    };
  }
  if (input.agentId === "opencode") {
    return {
      command,
      environment: {
        OPENCODE_PERMISSION: JSON.stringify({
          "*": "allow",
          external_directory: "allow",
        }),
      },
      nativeMode: {
        requested: "full-access",
        effective: "permission:*:allow",
      },
    };
  }
  if (input.agentId === "codex") {
    return {
      command,
      environment: { INITIAL_AGENT_MODE: "agent-full-access" },
      configureMode: "agent-full-access",
      nativeMode: {
        requested: "agent-full-access",
        effective: "agent-full-access",
      },
    };
  }
  return { command, environment: {} };
}

/** Built-ins derive their native mode from approval policy; custom agents keep explicit modes. */
export function effectiveAcpPermissionMode(
  agentId: string,
  input: PolicyInput,
): string | undefined {
  if (input.approvalPolicy === "allow-all" && agentId === "codex")
    return "agent-full-access";
  if (input.approvalPolicy !== undefined && BUILT_INS.has(agentId)) return;
  return input.permissionMode;
}

export function appliedLaunchNativeMode(
  agentId: string,
  input: PolicyInput,
): AcpLaunchPolicy["nativeMode"] {
  if (input.restricted || input.approvalPolicy !== "allow-all") return;
  return acpLaunchPolicy([], { ...input, agentId }).nativeMode;
}

function cursorForceCommand(command: string | string[]): string | string[] {
  if (Array.isArray(command)) {
    if (command.includes("--force") || command.includes("--yolo"))
      return [...command];
    const index = command.lastIndexOf("acp");
    return index < 0
      ? [...command, "--force"]
      : [...command.slice(0, index), "--force", ...command.slice(index)];
  }
  if (/(?:^|\s)--(?:force|yolo)(?:\s|$)/u.test(command)) return command;
  return /(?:^|\s)acp(?:\s|$)/u.test(command)
    ? command.replace(/(^|\s)acp(?=\s|$)/u, "$1--force acp")
    : `${command} --force`;
}
