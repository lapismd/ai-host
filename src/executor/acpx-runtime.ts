import { randomUUID } from "node:crypto";
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
import {
  clearPendingApprovalTimers,
  permissionOptionOutcomes,
} from "./permissions";
import type {
  AcpPermissionDecision,
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
      onPermissionRequest: async (
        request: {
          sessionId?: string;
          inferredKind?: string;
          raw?: Record<string, unknown>;
        },
        requestContext?: { signal?: AbortSignal },
      ) => {
        if (payload.restricted) return { outcome: "reject_once" };
        const raw = request.raw ?? {};
        const toolCall =
          raw.toolCall && typeof raw.toolCall === "object"
            ? (raw.toolCall as Record<string, unknown>)
            : {};
        const requestId = String(
          toolCall.toolCallId ??
            raw.toolCallId ??
            request.sessionId ??
            randomUUID(),
        );
        const key = `${sessionId}:${requestId}`;
        if (pendingApprovals.has(key)) {
          return { outcome: "reject_once" };
        }
        const options = permissionOptionOutcomes(raw.options);
        if (options.length === 0 || new Set(options).size !== options.length) {
          return { outcome: "reject_once" };
        }
        const expiresAt = Date.now() + context.permissionTimeoutMs;
        sink.sendRuntimeEvent({
          sessionId,
          type: "permission",
          request: {
            requestId,
            id: requestId,
            sessionId: request.sessionId,
            inferredKind: request.inferredKind,
            raw,
            kind: request.inferredKind ?? toolCall.kind,
            title: toolCall.title,
            toolName: toolCall.title ?? toolCall.kind,
            input: toolCall.rawInput,
            options: raw.options,
            expiresAt,
          },
        });
        return new Promise<AcpPermissionDecision>((resolve) => {
          const pending = ((decision: AcpPermissionDecision) => {
            clearPendingApprovalTimers(pending);
            resolve(decision);
          }) as PendingAcpApproval;
          pending.connectionId = context.connectionId;
          pending.expiresAt = expiresAt;
          pending.options = options;
          pending.timeout = setTimeout(() => {
            if (!pendingApprovals.delete(key)) return;
            pending({ outcome: "reject_once" });
          }, context.permissionTimeoutMs);
          requestContext?.signal?.addEventListener(
            "abort",
            () => {
              if (!pendingApprovals.delete(key)) return;
              pending({ outcome: "reject_once" });
            },
            { once: true },
          );
          pendingApprovals.set(key, pending);
        });
      },
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
