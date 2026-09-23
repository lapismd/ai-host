import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeProcessBridge, nativeProcessArgs, requiredConnectionId } from "./mcp-servers";
import type { ExecutorState } from "./state";
import type { AgentHostSink, AgentRuntimeExecutor, SpawnPayload } from "./types";

export function createProcessCommands(
  state: ExecutorState,
): Pick<AgentRuntimeExecutor, "spawnProcess" | "writeProcess" | "killProcess"> {
  return {
    spawnProcess(sink: AgentHostSink, payload: SpawnPayload) {
      const command = payload.command?.trim();
      if (!command) throw new Error("agent-runtime spawn requires a command");
      const processId = randomUUID();
      const bridge = payload.appToolBridgeId
        ? state.toolBridges.serverContribution(
            requiredConnectionId(sink),
            payload.appToolBridgeId,
          )
        : undefined;
      const child = spawn(
        command,
        nativeProcessArgs(payload.args ?? [], bridge),
        {
          cwd: payload.cwd,
          env: { ...process.env, ...payload.env, ...bridge?.env },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      state.processes.set(processId, child);
      if (bridge && payload.appToolBridgeId) {
        state.processBridges.set(processId, {
          connectionId: requiredConnectionId(sink),
          bridgeId: payload.appToolBridgeId,
        });
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        sink.sendProcessMessage({ processId, type: "stdout", data });
      });
      child.stderr.on("data", (data: string) => {
        sink.sendProcessMessage({ processId, type: "stderr", data });
      });
      child.on("exit", (code) => {
        state.processes.delete(processId);
        closeProcessBridge(processId, state.processBridges, state.toolBridges);
        sink.sendProcessMessage({
          processId,
          type: "exit",
          exitCode: code ?? 0,
        });
      });
      return { processId };
    },

    writeProcess(processId, data) {
      const child = state.processes.get(processId);
      if (!child) throw new Error(`Unknown agent process: ${processId}`);
      child.stdin.write(data);
    },

    killProcess(processId) {
      const child = state.processes.get(processId);
      if (!child) return;
      child.kill();
      state.processes.delete(processId);
      closeProcessBridge(processId, state.processBridges, state.toolBridges);
    },
  };
}
