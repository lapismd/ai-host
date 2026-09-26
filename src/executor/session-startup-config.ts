import {
  advertisedCursorEffort,
  toAcpxThinkingValue,
} from "../acp/acp-session-options";
import { thinkingConfigurationKey } from "./session";
import { applyNativePermissionPolicy, type PermissionModeResult } from "./session-permission-policy";
export type { PermissionModeResult } from "./session-permission-policy";
import type {
  AcpRuntimeHandle,
  AcpStartPayload,
  AcpxRuntimeLike,
} from "./types";

type StartupRuntime = Pick<
  AcpxRuntimeLike,
  "getCapabilities" | "setConfigOption" | "close"
> & {
  setMode?(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void>;
};

export async function applyStartupConfiguration(input: {
  runtime: StartupRuntime;
  handle: AcpRuntimeHandle;
  payload: AcpStartPayload;
  agentId: string;
  resumeSessionId?: string;
}): Promise<PermissionModeResult | undefined> {
  const { runtime, handle, payload, agentId } = input;
  const thinking = toAcpxThinkingValue({
    agent: agentId,
    thinking:
      payload.thinking ??
      (agentId === "cursor" && payload.model?.model
        ? advertisedCursorEffort(payload.model.model)
        : undefined),
  });
  const thinkingKey = thinking
    ? await thinkingConfigurationKey(runtime as AcpxRuntimeLike, handle)
    : undefined;
  if (thinking && thinkingKey) {
    try {
      if (!runtime.setConfigOption) {
        throw new Error(
          `ACP agent ${agentId} does not support thinking configuration.`,
        );
      }
      await runtime.setConfigOption({
        handle,
        key: thinkingKey,
        value: thinking,
      });
    } catch (error) {
      await runtime.close({
        handle,
        reason: "thinking configuration unavailable",
        discardPersistentState: !input.resumeSessionId,
      });
      throw error;
    }
  }
  return applyNativePermissionPolicy({ runtime, handle, payload, agentId });
}
