import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveAcpAgent } from "./acp-agent";
import type {
  NativeAgentProcessMessage,
  NativeAgentRuntimeEvent,
  UnsequencedAgentRuntimeEvent,
} from "./protocol";
import {
  toAcpxSessionOptions,
  toAcpxThinkingValue,
  type AcpxSessionOptions,
} from "./acp-session-options";

export type AgentHostSink = {
  sendRuntimeEvent(event: NativeAgentRuntimeEvent): void;
  sendProcessMessage(event: NativeAgentProcessMessage): void;
};

export type AgentRuntimeInputSink = {
  sendRuntimeEvent(event: UnsequencedAgentRuntimeEvent): void;
  sendProcessMessage(event: NativeAgentProcessMessage): void;
};

export type SpawnPayload = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type AcpStartPayload = {
  workspace?: string;
  agent?: string;
  model?: { provider?: string; model?: string };
  thinking?: "off" | "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
  tools?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  resumeSessionId?: string;
};

export type AcpPermissionDecision = {
  outcome:
    | "allow_once"
    | "allow_always"
    | "reject_once"
    | "reject_always"
    | "cancel";
};

export type AcpModelCatalog = {
  agent: string;
  currentModel?: string;
  models: string[];
};

type AcpRuntimeHandle = {
  sessionKey: string;
  backend?: string;
  runtimeSessionName?: string;
};

export type AcpxRuntimeLike = {
  ensureSession(input: {
    sessionKey: string;
    agent: string;
    mode: "persistent" | "oneshot";
    cwd?: string;
    resumeSessionId?: string;
    sessionOptions?: AcpxSessionOptions;
  }): Promise<AcpRuntimeHandle>;
  startTurn(input: {
    handle: AcpRuntimeHandle;
    text: string;
    mode: "prompt" | "steer";
    requestId: string;
  }): {
    events: AsyncIterable<{ type: string; [key: string]: unknown }>;
    result: Promise<{
      status: string;
      stopReason?: string;
      error?: { message?: string };
    }>;
  };
  getStatus?(input: { handle: AcpRuntimeHandle }): Promise<{
    models?: {
      currentModelId?: string;
      availableModelIds?: string[];
    };
  }>;
  getCapabilities?(input: {
    handle: AcpRuntimeHandle;
  }):
    | Promise<{ configOptionKeys?: string[] }>
    | { configOptionKeys?: string[] };
  setConfigOption?(input: {
    handle: AcpRuntimeHandle;
    key: string;
    value: string;
  }): Promise<void>;
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;
  close(input: {
    handle: AcpRuntimeHandle;
    reason: string;
    discardPersistentState?: boolean;
  }): Promise<void>;
};

export type CreateAcpxRuntime = (
  sink: AgentRuntimeInputSink,
  sessionId: string,
  payload: AcpStartPayload,
  pendingApprovals: Map<string, (decision: AcpPermissionDecision) => void>,
) => Promise<AcpxRuntimeLike>;

export type AgentRuntimeExecutor = {
  spawnProcess(
    sink: AgentHostSink,
    payload: SpawnPayload,
  ): { processId: string };
  writeProcess(processId: string, data: string): void;
  killProcess(processId: string): void;
  startAcpSession(
    sink: AgentHostSink,
    payload: AcpStartPayload,
  ): Promise<{ sessionId: string }>;
  listAcpModels(
    sink: AgentHostSink,
    payload: Pick<AcpStartPayload, "workspace" | "agent">,
  ): Promise<AcpModelCatalog>;
  promptAcpSession(
    sink: AgentHostSink,
    sessionId: string,
    text: string,
  ): Promise<{ runId: string }>;
  cancelAcpSession(sessionId: string): Promise<void>;
  closeAcpSession(sessionId: string): Promise<void>;
  respondAcpSession(
    sessionId: string,
    requestId: string,
    decision: string | AcpPermissionDecision,
  ): void;
};

export function createAgentRuntimeExecutor(options?: {
  createAcpxRuntime?: CreateAcpxRuntime;
}): AgentRuntimeExecutor {
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const acpSessions = new Map<string, AcpSessionState>();
  const pendingApprovals = new Map<
    string,
    (decision: AcpPermissionDecision) => void
  >();
  const createAcpx = options?.createAcpxRuntime ?? defaultCreateAcpxRuntime;

  return {
    spawnProcess(sink, payload) {
      const command = payload.command?.trim();
      if (!command) throw new Error("agent-runtime spawn requires a command");
      const processId = randomUUID();
      const child = spawn(command, payload.args ?? [], {
        cwd: payload.cwd,
        env: { ...process.env, ...payload.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      processes.set(processId, child);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        sink.sendProcessMessage({ processId, type: "stdout", data });
      });
      child.stderr.on("data", (data: string) => {
        sink.sendProcessMessage({ processId, type: "stderr", data });
      });
      child.on("exit", (code) => {
        processes.delete(processId);
        sink.sendProcessMessage({
          processId,
          type: "exit",
          exitCode: code ?? 0,
        });
      });
      return { processId };
    },

    writeProcess(processId, data) {
      const child = processes.get(processId);
      if (!child) throw new Error(`Unknown agent process: ${processId}`);
      child.stdin.write(data);
    },

    killProcess(processId) {
      const child = processes.get(processId);
      if (!child) return;
      child.kill();
      processes.delete(processId);
    },

    async startAcpSession(sink, payload) {
      const sessionId = payload.resumeSessionId ?? randomUUID();
      const existing = acpSessions.get(sessionId);
      if (existing) {
        existing.sink = sink;
        return { sessionId };
      }
      const agent = resolveAcpAgent(payload);
      const session: AcpSessionState = {
        sessionId,
        sink,
        currentRunId: "session",
        nextSequence: 0,
        runtime: undefined as unknown as AcpxRuntimeLike,
        handle: undefined as unknown as AcpRuntimeHandle,
      };
      const runtimeSink: AgentRuntimeInputSink = {
        sendRuntimeEvent(event) {
          emitRuntimeEvent(session, session.currentRunId, event);
        },
        sendProcessMessage(event) {
          session.sink.sendProcessMessage(event);
        },
      };
      const runtime = await createAcpx(
        runtimeSink,
        sessionId,
        payload,
        pendingApprovals,
      );
      const handle = await runtime.ensureSession({
        sessionKey: sessionId,
        agent,
        mode: "persistent",
        cwd: payload.workspace,
        resumeSessionId: payload.resumeSessionId,
        sessionOptions: toAcpxSessionOptions(payload),
      });
      const thinking = toAcpxThinkingValue({
        agent,
        thinking: payload.thinking,
      });
      if (thinking && (await supportsThinkingConfiguration(runtime, handle))) {
        try {
          if (!runtime.setConfigOption) {
            throw new Error(
              `ACP agent ${agent} does not support thinking configuration.`,
            );
          }
          await runtime.setConfigOption({
            handle,
            key: "thinking",
            value: thinking,
          });
        } catch (error) {
          await runtime.close({
            handle,
            reason: "thinking configuration unavailable",
            discardPersistentState: !payload.resumeSessionId,
          });
          throw error;
        }
      }
      session.runtime = runtime;
      session.handle = handle;
      acpSessions.set(sessionId, session);
      return { sessionId };
    },

    async listAcpModels(sink, payload) {
      const sessionId = randomUUID();
      const agent = resolveAcpAgent(payload);
      let sequence = 0;
      const catalogSink: AgentRuntimeInputSink = {
        sendRuntimeEvent(event) {
          sequence += 1;
          sink.sendRuntimeEvent({
            sessionId,
            runId: "model-catalog",
            sequence,
            event: {
              type: event.type,
              event: event.event,
              request: event.request,
            },
          });
        },
        sendProcessMessage: (event) => sink.sendProcessMessage(event),
      };
      const runtime = await createAcpx(
        catalogSink,
        sessionId,
        { ...payload, agent },
        pendingApprovals,
      );
      const handle = await runtime.ensureSession({
        sessionKey: `model-catalog:${agent}:${sessionId}`,
        agent,
        mode: "oneshot",
        cwd: payload.workspace,
      });
      try {
        if (!runtime.getStatus) {
          return { agent, models: [] };
        }
        const status = await runtime.getStatus({ handle });
        const currentModel = status.models?.currentModelId?.trim() || undefined;
        const models = [
          ...new Set(
            (status.models?.availableModelIds ?? [])
              .map((model) => model.trim())
              .filter(Boolean),
          ),
        ];
        return { agent, currentModel, models };
      } finally {
        await closeDisposableAcpSession(runtime, handle);
      }
    },

    async promptAcpSession(sink, sessionId, text) {
      const session = acpSessions.get(sessionId);
      if (!session) throw new Error(`Unknown ACP session: ${sessionId}`);
      session.sink = sink;
      const runId = randomUUID();
      session.currentRunId = runId;
      const turn = session.runtime.startTurn({
        handle: session.handle,
        text,
        mode: "prompt",
        requestId: runId,
      });
      void (async () => {
        try {
          for await (const event of turn.events) {
            emitRuntimeEvent(session, runId, {
              sessionId,
              type: "event",
              event,
            });
          }
          const result = await turn.result;
          if (result.status === "failed") {
            emitRuntimeEvent(session, runId, {
              sessionId,
              type: "event",
              event: {
                type: "error",
                message: result.error?.message ?? "ACP turn failed",
              },
            });
            return;
          }
          emitRuntimeEvent(session, runId, {
            sessionId,
            type: "event",
            event: {
              type: "done",
              stopReason: result.stopReason ?? result.status,
            },
          });
        } catch (error) {
          emitRuntimeEvent(session, runId, {
            sessionId,
            type: "event",
            event: {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      })();
      return { runId };
    },

    async cancelAcpSession(sessionId) {
      const session = acpSessions.get(sessionId);
      if (!session) return;
      await session.runtime.cancel({ handle: session.handle });
    },

    async closeAcpSession(sessionId) {
      const session = acpSessions.get(sessionId);
      if (!session) return;
      await session.runtime.close({ handle: session.handle, reason: "close" });
      acpSessions.delete(sessionId);
    },

    respondAcpSession(sessionId, requestId, decision) {
      const key = `${sessionId}:${requestId}`;
      const resolve = pendingApprovals.get(key);
      if (!resolve) throw new Error(`Unknown ACP approval: ${key}`);
      pendingApprovals.delete(key);
      resolve(normalizePermissionDecision(decision));
    },
  };
}

type AcpSessionState = {
  sessionId: string;
  runtime: AcpxRuntimeLike;
  handle: AcpRuntimeHandle;
  sink: AgentHostSink;
  currentRunId: string;
  nextSequence: number;
};

function emitRuntimeEvent(
  session: AcpSessionState,
  runId: string,
  input: UnsequencedAgentRuntimeEvent,
): void {
  session.nextSequence += 1;
  session.sink.sendRuntimeEvent({
    sessionId: session.sessionId,
    runId,
    sequence: session.nextSequence,
    event: {
      type: input.type,
      event: input.event,
      request: input.request,
    },
  });
}

async function closeDisposableAcpSession(
  runtime: AcpxRuntimeLike,
  handle: AcpRuntimeHandle,
): Promise<void> {
  const input = { handle, reason: "model catalog complete" };
  try {
    await runtime.close({ ...input, discardPersistentState: true });
  } catch (error) {
    if (!isUnsupportedAcpControl(error)) throw error;
    await runtime.close(input);
  }
}

function isUnsupportedAcpControl(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ACP_BACKEND_UNSUPPORTED_CONTROL"
  );
}

async function supportsThinkingConfiguration(
  runtime: AcpxRuntimeLike,
  handle: AcpRuntimeHandle,
): Promise<boolean> {
  if (!runtime.getCapabilities) return true;
  const capabilities = await runtime.getCapabilities({ handle });
  const keys = capabilities.configOptionKeys ?? [];
  return keys.includes("thinking") || keys.includes("effort");
}

export async function defaultCreateAcpxRuntime(
  sink: AgentRuntimeInputSink,
  sessionId: string,
  payload: AcpStartPayload,
  pendingApprovals: Map<string, (decision: AcpPermissionDecision) => void>,
): Promise<AcpxRuntimeLike> {
  let acpx: {
    createAcpRuntime: (options: Record<string, unknown>) => AcpxRuntimeLike;
    createAgentRegistry: () => unknown;
    createRuntimeStore: (options: { stateDir: string }) => unknown;
  };
  try {
    const specifier = "acpx/runtime";
    acpx = (await import(specifier)) as typeof acpx;
  } catch {
    throw new Error(
      "acpx/runtime is not available. Install acpx >= 0.8.0 on the AI host.",
    );
  }
  const cwd = payload.workspace ?? process.cwd();
  return acpx.createAcpRuntime({
    cwd,
    sessionStore: acpx.createRuntimeStore({
      stateDir: `${cwd}/.lapis/ai-sessions`,
    }),
    agentRegistry: acpx.createAgentRegistry(),
    mcpServers: (payload.tools ?? []).map((tool) => ({
      name: tool.name,
      command: tool.command,
      args: tool.args ?? [],
      env: tool.env,
    })),
    permissionMode: "deny-all",
    onPermissionRequest: async (request: {
      sessionId?: string;
      inferredKind?: string;
      raw?: Record<string, unknown>;
    }) => {
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
        },
      });
      return new Promise<AcpPermissionDecision>((resolve) => {
        pendingApprovals.set(`${sessionId}:${requestId}`, resolve);
      });
    },
  });
}

export function normalizePermissionDecision(
  decision: string | AcpPermissionDecision,
): AcpPermissionDecision {
  if (typeof decision !== "string") return decision;
  if (decision === "allow_always" || decision === "allow-always") {
    return { outcome: "allow_always" };
  }
  if (
    decision === "reject_once" ||
    decision === "deny_once" ||
    decision === "deny-once"
  ) {
    return { outcome: "reject_once" };
  }
  if (
    decision === "reject_always" ||
    decision === "deny_always" ||
    decision === "deny-always"
  ) {
    return { outcome: "reject_always" };
  }
  if (decision === "cancel") return { outcome: "cancel" };
  return { outcome: "allow_once" };
}
