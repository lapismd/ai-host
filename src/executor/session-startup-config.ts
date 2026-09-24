import {
  advertisedCursorEffort,
  toAcpxThinkingValue,
} from "../acp/acp-session-options";
import { thinkingConfigurationKey } from "./session";
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

export interface PermissionModeResult {
  requested: string;
  status: "applied" | "unsupported" | "rejected";
  effective?: string;
}

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
  if (payload.restricted && payload.permissionMode) return { requested: payload.permissionMode, status: "unsupported" };
  return applyAdvertisedPermissionMode(runtime, handle, payload.permissionMode);
}

async function applyAdvertisedPermissionMode(
  runtime: StartupRuntime,
  handle: AcpRuntimeHandle,
  mode: string | undefined,
): Promise<PermissionModeResult | undefined> {
  if (!mode) return;
  const result = { requested: mode, status: "unsupported" as const };
  if (!runtime.setMode || !runtime.getCapabilities) return result;
  try {
    const capabilities = await runtime.getCapabilities({ handle });
    if (!(capabilities.configOptionKeys ?? []).includes("mode")) return result;
    await runtime.setMode({ handle, mode });
    return { requested: mode, status: "applied", effective: mode };
  } catch {
    return { requested: mode, status: "rejected" };
  }
}
