import type { AgentHostSink } from "../executor/executor";
import type { AgentRuntimeServerOptions } from "./ws-types";

export async function dispatchCommand(
  options: AgentRuntimeServerOptions,
  sink: AgentHostSink,
  command: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const executor = options.executor;
  switch (command) {
    case "desktop_agent_acp_models":
      return executor.listAcpModels(sink, {
        workspace: options.workspace,
        agent: String(payload.agent ?? ""),
        ...(typeof payload.sessionId === "string" && payload.sessionId.trim()
          ? { sessionId: payload.sessionId }
          : {}),
      });
    case "desktop_agent_acp_agents":
      return executor.listAcpAgents();
    case "desktop_agent_acp_status":
      return executor.getAcpSessionStatus(String(payload.sessionId ?? ""));
    case "desktop_agent_acp_start":
      if (
        options.profile === "controller" &&
        Array.isArray(payload.mcpServers) &&
        payload.mcpServers.length > 0
      ) {
        throw new Error(
          "Controller profile does not accept caller MCP servers",
        );
      }
      return executor.startAcpSession(sink, {
        ...payload,
        workspace: options.workspace,
        ...(options.profile === "controller" ? { mcpServers: [] } : {}),
      });
    case "desktop_agent_tools_open":
      return executor.openToolBridge(sink, {
        bindingId: String(payload.bindingId ?? ""),
        conversationId: String(payload.conversationId ?? ""),
        descriptors: Array.isArray(payload.descriptors)
          ? (payload.descriptors as never[])
          : [],
      });
    case "desktop_agent_tools_respond":
      executor.respondToolBridge(sink, {
        bridgeId: String(payload.bridgeId ?? ""),
        callId: String(payload.callId ?? ""),
        result: payload.result,
        error:
          payload.error && typeof payload.error === "object"
            ? (payload.error as { code: string; message: string })
            : undefined,
      });
      return null;
    case "desktop_agent_tools_close":
      executor.closeToolBridge(sink, String(payload.bridgeId ?? ""));
      return null;
    case "desktop_agent_acp_prompt":
      return executor.promptAcpSession(
        sink,
        String(payload.sessionId ?? ""),
        String(payload.text ?? ""),
      );
    case "desktop_agent_acp_configure":
      return executor.configureAcpSession({
        sessionId: String(payload.sessionId ?? ""),
        model:
          payload.model && typeof payload.model === "object"
            ? (payload.model as { provider?: string; model?: string })
            : undefined,
        thinking: payload.thinking as
          | "off"
          | "low"
          | "medium"
          | "high"
          | undefined,
      });
    case "desktop_agent_acp_cancel":
      await executor.cancelAcpSession(String(payload.sessionId ?? ""));
      return null;
    case "desktop_agent_acp_close":
      await executor.closeAcpSession(String(payload.sessionId ?? ""));
      return null;
    case "desktop_agent_acp_respond":
      executor.respondAcpSession(
        String(payload.sessionId ?? ""),
        String(payload.requestId ?? ""),
        (payload.decision as string) ?? "",
      );
      return null;
    case "desktop_agent_process_spawn":
      return executor.spawnProcess(sink, {
        ...payload,
        cwd: options.workspace,
      });
    case "desktop_agent_process_write":
      executor.writeProcess(
        String(payload.processId ?? ""),
        String(payload.data ?? ""),
      );
      return null;
    case "desktop_agent_process_kill":
      executor.killProcess(String(payload.processId ?? ""));
      return null;
    default:
      throw new Error(`Unknown agent-runtime command: ${command}`);
  }
}
