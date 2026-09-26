import {
  appliedLaunchNativeMode,
  effectiveAcpPermissionMode,
} from "../acp/acp-execution-policy";
import type { AcpRuntimeHandle, AcpStartPayload, AcpxRuntimeLike } from "./types";

type StartupRuntime = Pick<AcpxRuntimeLike, "getCapabilities"> & {
  setMode?(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void>;
};

export interface PermissionModeResult {
  requested: string;
  status: "applied" | "unsupported" | "rejected";
  effective?: string;
}

export async function applyNativePermissionPolicy(input: {
  runtime: StartupRuntime;
  handle: AcpRuntimeHandle;
  payload: AcpStartPayload;
  agentId: string;
}): Promise<PermissionModeResult | undefined> {
  const { runtime, handle, payload, agentId } = input;
  const requested = effectiveAcpPermissionMode(agentId, payload);
  if (payload.restricted && requested)
    return { requested, status: "unsupported" };
  const configured = await applyAdvertisedPermissionMode(runtime, handle, requested);
  if (configured?.status === "applied") return configured;
  const launched = appliedLaunchNativeMode(agentId, payload);
  return launched
    ? { requested: launched.requested, status: "applied", effective: launched.effective }
    : configured;
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
