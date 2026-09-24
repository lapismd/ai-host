import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VolatileSessionStore } from "./volatile-session-store";
import {
  createAcpAgentRegistry,
  withAcpVcsEnvironment,
} from "../acp/acp-agent";
import { vcsEnvironment } from "../acp/acp-session-options";
import { toAcpxMcpServers } from "./mcp-servers";
import { requestAcpPermission, type AcpxPermissionRequest } from "./permission-request";
import type {
  AcpStartPayload,
  AgentRuntimeInputSink,
  CreateAcpxRuntimeContext,
  AcpxRuntimeLike,
  PendingAcpApproval,
} from "./types";

export async function defaultCreateAcpxRuntime(
  sink: AgentRuntimeInputSink,
  sessionId: string,
  payload: AcpStartPayload,
  pendingApprovals: Map<string, PendingAcpApproval>,
  context: CreateAcpxRuntimeContext = {
    agent: createAcpAgentRegistry().resolve("codex"),
    permissionTimeoutMs: 15 * 60_000,
  },
): Promise<AcpxRuntimeLike> {
  let acpx: {
    createAcpRuntime: (options: Record<string, unknown>) => AcpxRuntimeLike;
    createAgentRegistry: (params?: {
      overrides?: Record<string, string | string[]>;
    }) => { resolve(agent: string): string | string[] };
  };
  try {
    acpx = (await import("acpx/runtime")) as unknown as typeof acpx;
  } catch {
    throw new Error(
      "acpx/runtime is not available. Install acpx >= 0.8.0 on the AI host.",
    );
  }
  const temporaryCwd = payload.restricted
    ? await mkdtemp(join(tmpdir(), "lapis-acp-restricted-"))
    : undefined;
  const cwd = temporaryCwd ?? payload.workspace ?? process.cwd();
  const sessionStore = new VolatileSessionStore();
  let runtime: AcpxRuntimeLike;
  try {
    const identity = vcsEnvironment(payload);
    const configured = acpx.createAgentRegistry(
      context.agent.command
        ? { overrides: { [context.agent.id]: context.agent.command } }
        : undefined,
    );
    const registry = identity
      ? acpx.createAgentRegistry({
          overrides: {
            [context.agent.id]: withAcpVcsEnvironment(
              configured.resolve(context.agent.id),
              identity,
            ),
          },
        })
      : configured;
    runtime = acpx.createAcpRuntime({
      cwd,
      sessionStore,
      agentRegistry: registry,
      mcpServers: toAcpxMcpServers(payload.mcpServers),
      permissionMode: "deny-all",
      onPermissionRequest: (request: AcpxPermissionRequest, requestContext?: { signal?: AbortSignal }) =>
        requestAcpPermission(sink, sessionId, payload, pendingApprovals, context, request, requestContext?.signal),
    });
  } catch (error) {
    sessionStore.dispose();
    if (temporaryCwd) {
      await rm(temporaryCwd, { recursive: true, force: true });
    }
    throw error;
  }
  const close = runtime.close.bind(runtime);
  const ensureSession = runtime.ensureSession.bind(runtime);
  runtime.ensureSession = async (input) => {
    try {
      return await ensureSession(input);
    } catch (error) {
      sessionStore.dispose();
      if (temporaryCwd) await rm(temporaryCwd, { recursive: true, force: true });
      throw error;
    }
  };
  runtime.close = async (input) => {
    try {
      await close(input);
    } finally {
      sessionStore.dispose();
      if (temporaryCwd) await rm(temporaryCwd, { recursive: true, force: true });
    }
  };
  return runtime;
}
