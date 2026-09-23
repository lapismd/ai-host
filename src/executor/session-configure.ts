import {
  ACP_THINKING_KEYS,
  advertisedCursorEffort,
  stripCursorModelId,
  toAcpxThinkingValue,
} from "../acp/acp-session-options";
import { isCursorAutoModel } from "./permissions";
import type { ExecutorState } from "./state";
import type {
  AcpConfigurePayload,
  AcpConfigureResult,
  AgentRuntimeExecutor,
} from "./types";

export function createSessionConfigureCommands(
  state: ExecutorState,
): Pick<AgentRuntimeExecutor, "configureAcpSession"> {
  return {
    async configureAcpSession(payload: AcpConfigurePayload) {
      const pending = state.pendingAcpSessions.get(payload.sessionId);
      const session =
        state.acpSessions.get(payload.sessionId) ?? (await pending?.ready);
      if (!session)
        throw new Error(`Unknown ACP session: ${payload.sessionId}`);
      const runtime = session.runtime;
      const keys = runtime.getCapabilities
        ? ((await runtime.getCapabilities({ handle: session.handle }))
            .configOptionKeys ?? [])
        : [];
      const result: AcpConfigureResult = {};

      const requestedModel = payload.model?.model?.trim();
      if (requestedModel) {
        const appliedModel =
          session.agentId === "cursor"
            ? stripCursorModelId(requestedModel)
            : requestedModel;
        const cursorAuto = isCursorAutoModel(
          session.agentId ?? "",
          requestedModel,
        );
        const currentModel = runtime.getStatus
          ? (await runtime.getStatus({ handle: session.handle })).models
              ?.currentModelId
          : undefined;
        if (currentModel === appliedModel || currentModel === requestedModel) {
          result.model = { status: "unchanged" };
        } else if (!keys.includes("model") || !runtime.setConfigOption) {
          result.model = cursorAuto
            ? { status: "unchanged" }
            : {
                status: "unsupported",
                reason:
                  "The ACP session does not advertise model configuration.",
              };
        } else {
          try {
            await runtime.setConfigOption({
              handle: session.handle,
              key: "model",
              value: appliedModel,
            });
            const effectiveModel = runtime.getStatus
              ? (await runtime.getStatus({ handle: session.handle })).models
                  ?.currentModelId
              : undefined;
            result.model =
              effectiveModel === appliedModel ||
              effectiveModel === requestedModel ||
              cursorAuto
                ? { status: "applied" }
                : {
                    status: "unsupported",
                    reason:
                      "The ACP session did not verify the requested model.",
                  };
          } catch (error) {
            result.model = cursorAuto
              ? { status: "unchanged" }
              : {
                  status: "unsupported",
                  reason:
                    error instanceof Error ? error.message : String(error),
                };
          }
        }
      }

      const thinking =
        payload.thinking ??
        (session.agentId === "cursor" && requestedModel
          ? advertisedCursorEffort(requestedModel)
          : undefined);
      if (thinking) {
        const thinkingKey = ACP_THINKING_KEYS.find((key) => keys.includes(key));
        if (!thinkingKey || !runtime.setConfigOption) {
          result.thinking = {
            status: "unsupported",
            reason:
              "The ACP session does not advertise thinking configuration.",
          };
        } else {
          try {
            await runtime.setConfigOption({
              handle: session.handle,
              key: thinkingKey,
              value: toAcpxThinkingValue({
                agent: session.agentId,
                thinking,
              })!,
            });
            result.thinking = { status: "applied" };
          } catch (error) {
            result.thinking = {
              status: "unsupported",
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        }
      }
      return result;
    },
  };
}
