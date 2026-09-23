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

export async function applyStartupConfiguration(input: {
  runtime: StartupRuntime;
  handle: AcpRuntimeHandle;
  payload: AcpStartPayload;
  agentId: string;
  resumeSessionId?: string;
}): Promise<void> {
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
  await applyAdvertisedPermissionMode(runtime, handle, payload.permissionMode);
}

async function applyAdvertisedPermissionMode(
  runtime: StartupRuntime,
  handle: AcpRuntimeHandle,
  mode: string | undefined,
): Promise<void> {
  if (!mode || !runtime.setMode || !runtime.getCapabilities) return;
  const capabilities = await runtime.getCapabilities({ handle });
  if (!(capabilities.configOptionKeys ?? []).includes("mode")) return;
  try {
    await runtime.setMode({ handle, mode });
  } catch {
    // A rejected harness mode leaves owner permission prompts in place.
  }
}
