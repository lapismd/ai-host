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
import {
  catalogEntriesForAgent,
  type AcpModelEntry,
} from "./acp-model-catalog";
import {
  ToolBridgeBroker,
  type ToolBridgeBrokerOptions,
  type ToolBridgeCall,
  type ToolBridgeCancel,
  type ToolBridgeOpenPayload,
  type ToolBridgeResponse,
  type ToolBridgeSink,
} from "./tool-bridge";

export type AgentHostSink = {
  connectionId?: string;
  sendRuntimeEvent(event: NativeAgentRuntimeEvent): void;
  sendProcessMessage(event: NativeAgentProcessMessage): void;
  sendToolCall?(call: ToolBridgeCall): void;
  sendToolCancel?(cancel: ToolBridgeCancel): void;
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
  appToolBridgeId?: string;
};

export type AcpStartPayload = {
  sessionId?: string;
  workspace?: string;
  agent?: string;
  model?: { provider?: string; model?: string };
  thinking?: "off" | "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
  mcpServers?: AcpMcpServer[];
  resumeSessionId?: string;
  appToolBridgeId?: string;
};

export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      type?: "stdio";
    }
  | {
      name: string;
      type: "http" | "sse";
      url: string;
      headers?: Array<{ name: string; value: string }>;
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
  entries: AcpModelEntry[];
};

export type { AcpModelEntry } from "./acp-model-catalog";

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
  startAcpSessionDeferred(
    sink: AgentHostSink,
    payload: AcpStartPayload,
  ): { sessionId: string };
  listAcpModels(
    sink: AgentHostSink,
    payload: Pick<AcpStartPayload, "workspace" | "agent">,
  ): Promise<AcpModelCatalog>;
  promptAcpSession(
    sink: AgentHostSink,
    sessionId: string,
    text: string,
  ): Promise<{ runId: string }>;
  promptAcpSessionDeferred(
    sink: AgentHostSink,
    sessionId: string,
    text: string,
  ): { runId: string };
  cancelAcpSession(sessionId: string): Promise<void>;
  closeAcpSession(sessionId: string): Promise<void>;
  respondAcpSession(
    sessionId: string,
    requestId: string,
    decision: string | AcpPermissionDecision,
  ): void;
  openToolBridge(
    sink: AgentHostSink,
    payload: ToolBridgeOpenPayload,
  ): Promise<{ bridgeId: string }>;
  respondToolBridge(sink: AgentHostSink, payload: ToolBridgeResponse): void;
  closeToolBridge(sink: AgentHostSink, bridgeId: string): void;
  disconnectConnection(connectionId: string): void;
  close(): Promise<void>;
};

export function createAgentRuntimeExecutor(options?: {
  createAcpxRuntime?: CreateAcpxRuntime;
  toolBridgeBroker?: ToolBridgeBroker;
  toolBridgeOptions?: ToolBridgeBrokerOptions;
}): AgentRuntimeExecutor {
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const processBridges = new Map<string, { connectionId: string; bridgeId: string }>();
  const acpSessions = new Map<string, AcpSessionState>();
  const pendingAcpSessions = new Map<string, PendingAcpSessionState>();
  const pendingApprovals = new Map<
    string,
    (decision: AcpPermissionDecision) => void
  >();
  const createAcpx = options?.createAcpxRuntime ?? defaultCreateAcpxRuntime;
  const toolBridges =
    options?.toolBridgeBroker ?? new ToolBridgeBroker(options?.toolBridgeOptions);

  async function initializeAcpSession(
    sink: AgentHostSink,
    payload: AcpStartPayload,
    sessionId: string,
    initialState?: AcpSessionState,
  ): Promise<AcpSessionState> {
    const existing = acpSessions.get(sessionId);
    if (existing) {
      if (existing.appToolBridgeId !== payload.appToolBridgeId) {
        await existing.runtime.close({
          handle: existing.handle,
          reason: "app tool bridge changed",
        });
        acpSessions.delete(sessionId);
        if (existing.connectionId && existing.appToolBridgeId) {
          toolBridges.closeBridge(
            existing.connectionId,
            existing.appToolBridgeId,
          );
        }
      } else {
        existing.sink = sink;
        return existing;
      }
    }
    const effectivePayload = withAppToolMcpServer(payload, sink, toolBridges);
    const agent = resolveAcpAgent(effectivePayload);
    const session = initialState ?? createAcpSessionState(sessionId, sink);
    session.sink = sink;
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
      effectivePayload,
      pendingApprovals,
    );
    const handle = await runtime.ensureSession({
      sessionKey: sessionId,
      agent,
      mode: "persistent",
      cwd: effectivePayload.workspace,
      sessionOptions: toAcpxSessionOptions(effectivePayload),
    });
    const thinking = toAcpxThinkingValue({
      agent,
      thinking: effectivePayload.thinking,
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
    session.connectionId = sink.connectionId;
    session.appToolBridgeId = effectivePayload.appToolBridgeId;
    acpSessions.set(sessionId, session);
    return session;
  }

  function beginAcpTurn(
    session: AcpSessionState,
    sink: AgentHostSink,
    text: string,
    runId: string,
  ): void {
    session.sink = sink;
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
            sessionId: session.sessionId,
            type: "event",
            event,
          });
        }
        const result = await turn.result;
        if (result.status === "failed") {
          emitRuntimeEvent(session, runId, {
            sessionId: session.sessionId,
            type: "event",
            event: {
              type: "error",
              message: result.error?.message ?? "ACP turn failed",
            },
          });
          return;
        }
        emitRuntimeEvent(session, runId, {
          sessionId: session.sessionId,
          type: "event",
          event: {
            type: "done",
            stopReason: result.stopReason ?? result.status,
          },
        });
      } catch (error) {
        emitRuntimeEvent(session, runId, {
          sessionId: session.sessionId,
          type: "event",
          event: {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    })();
  }

  function promptAcpSessionNow(
    sink: AgentHostSink,
    sessionId: string,
    text: string,
    runId: string,
  ): void {
    const session = acpSessions.get(sessionId);
    if (session) {
      beginAcpTurn(session, sink, text, runId);
      return;
    }
    const pending = pendingAcpSessions.get(sessionId);
    if (!pending) throw new Error(`Unknown ACP session: ${sessionId}`);
    pending.session.sink = sink;
    pending.session.currentRunId = runId;
    const prompt: PendingAcpPrompt = { runId, cancelled: false };
    pending.prompts.add(prompt);
    void pending.ready.then(
      (readySession) => {
        pending.prompts.delete(prompt);
        if (!prompt.cancelled && !pending.closed) {
          beginAcpTurn(readySession, sink, text, runId);
        }
      },
      () => {
        pending.prompts.delete(prompt);
      },
    );
  }

  return {
    spawnProcess(sink, payload) {
      const command = payload.command?.trim();
      if (!command) throw new Error("agent-runtime spawn requires a command");
      const processId = randomUUID();
      const bridge = payload.appToolBridgeId
        ? toolBridges.serverContribution(
            requiredConnectionId(sink),
            payload.appToolBridgeId,
          )
        : undefined;
      const child = spawn(command, nativeProcessArgs(payload.args ?? [], bridge), {
        cwd: payload.cwd,
        env: { ...process.env, ...payload.env, ...bridge?.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      processes.set(processId, child);
      if (bridge && payload.appToolBridgeId) {
        processBridges.set(processId, {
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
        processes.delete(processId);
        closeProcessBridge(processId, processBridges, toolBridges);
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
      closeProcessBridge(processId, processBridges, toolBridges);
    },

    async startAcpSession(sink, payload) {
      const sessionId = resolveAcpSessionId(payload);
      const pending = pendingAcpSessions.get(sessionId);
      if (pending) {
        pending.session.sink = sink;
        await pending.ready;
        return { sessionId };
      }
      await initializeAcpSession(sink, payload, sessionId);
      return { sessionId };
    },

    startAcpSessionDeferred(sink, payload) {
      const sessionId = resolveAcpSessionId(payload);
      const existingPending = pendingAcpSessions.get(sessionId);
      if (existingPending) {
        existingPending.session.sink = sink;
        return { sessionId };
      }
      const session = createAcpSessionState(sessionId, sink);
      const pending: PendingAcpSessionState = {
        session,
        prompts: new Set(),
        closed: false,
        ready: new Promise<AcpSessionState>((resolve, reject) => {
          setTimeout(() => {
            void initializeAcpSession(
              sink,
              payload,
              sessionId,
              session,
            ).then(resolve, reject);
          }, 0);
        }),
      };
      pendingAcpSessions.set(sessionId, pending);
      void pending.ready.then(
        () => {
          pendingAcpSessions.delete(sessionId);
        },
        (error) => {
          pendingAcpSessions.delete(sessionId);
          if (pending.closed) return;
          const runId =
            pending.prompts.values().next().value?.runId ?? "session";
          emitRuntimeEvent(session, runId, {
            sessionId,
            type: "event",
            event: {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        },
      );
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
          return { agent, models: [], entries: [] };
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
        return {
          agent,
          currentModel,
          models,
          entries: catalogEntriesForAgent(agent, models),
        };
      } finally {
        await closeDisposableAcpSession(runtime, handle);
      }
    },

    async promptAcpSession(sink, sessionId, text) {
      const runId = randomUUID();
      promptAcpSessionNow(sink, sessionId, text, runId);
      return { runId };
    },

    promptAcpSessionDeferred(sink, sessionId, text) {
      const runId = randomUUID();
      setTimeout(() => {
        try {
          promptAcpSessionNow(sink, sessionId, text, runId);
        } catch (error) {
          const session =
            acpSessions.get(sessionId) ??
            pendingAcpSessions.get(sessionId)?.session ??
            createAcpSessionState(sessionId, sink);
          emitRuntimeEvent(session, runId, {
            sessionId,
            type: "event",
            event: {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }, 0);
      return { runId };
    },

    async cancelAcpSession(sessionId) {
      const session = acpSessions.get(sessionId);
      if (session) {
        await session.runtime.cancel({ handle: session.handle });
        return;
      }
      const pending = pendingAcpSessions.get(sessionId);
      if (!pending) return;
      for (const prompt of pending.prompts) prompt.cancelled = true;
    },

    async closeAcpSession(sessionId) {
      const session = acpSessions.get(sessionId);
      if (session) {
        await closeAcpSessionState(session, acpSessions, toolBridges);
        return;
      }
      const pending = pendingAcpSessions.get(sessionId);
      if (!pending) return;
      pending.closed = true;
      for (const prompt of pending.prompts) prompt.cancelled = true;
      void pending.ready.then(
        (readySession) =>
          closeAcpSessionState(readySession, acpSessions, toolBridges),
        () => undefined,
      );
    },

    respondAcpSession(sessionId, requestId, decision) {
      const key = `${sessionId}:${requestId}`;
      const resolve = pendingApprovals.get(key);
      if (!resolve) throw new Error(`Unknown ACP approval: ${key}`);
      pendingApprovals.delete(key);
      resolve(normalizePermissionDecision(decision));
    },

    openToolBridge(sink, payload) {
      return toolBridges.open(requiredToolSink(sink), payload);
    },

    respondToolBridge(sink, payload) {
      toolBridges.respond(requiredConnectionId(sink), payload);
    },

    closeToolBridge(sink, bridgeId) {
      toolBridges.closeBridge(requiredConnectionId(sink), bridgeId);
    },

    disconnectConnection(connectionId) {
      toolBridges.closeConnection(connectionId);
    },

    async close() {
      for (const child of processes.values()) child.kill();
      processes.clear();
      processBridges.clear();
      for (const pending of pendingAcpSessions.values()) {
        pending.closed = true;
        for (const prompt of pending.prompts) prompt.cancelled = true;
        void pending.ready.then(
          (session) => closeAcpSessionState(session, acpSessions, toolBridges),
          () => undefined,
        );
      }
      for (const session of [...acpSessions.values()]) {
        await closeAcpSessionState(session, acpSessions, toolBridges);
      }
      await toolBridges.close();
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
  connectionId?: string;
  appToolBridgeId?: string;
};

type PendingAcpPrompt = {
  runId: string;
  cancelled: boolean;
};

type PendingAcpSessionState = {
  session: AcpSessionState;
  ready: Promise<AcpSessionState>;
  prompts: Set<PendingAcpPrompt>;
  closed: boolean;
};

function createAcpSessionState(
  sessionId: string,
  sink: AgentHostSink,
): AcpSessionState {
  return {
    sessionId,
    sink,
    currentRunId: "session",
    nextSequence: 0,
    runtime: undefined as unknown as AcpxRuntimeLike,
    handle: undefined as unknown as AcpRuntimeHandle,
  };
}

function resolveAcpSessionId(payload: AcpStartPayload): string {
  const sessionId = payload.sessionId?.trim();
  const resumeSessionId = payload.resumeSessionId?.trim();
  if (sessionId && resumeSessionId && sessionId !== resumeSessionId) {
    throw new Error(
      "ACP sessionId must match resumeSessionId when both are provided.",
    );
  }
  return sessionId || resumeSessionId || randomUUID();
}

async function closeAcpSessionState(
  session: AcpSessionState,
  sessions: Map<string, AcpSessionState>,
  toolBridges: ToolBridgeBroker,
): Promise<void> {
  await session.runtime.close({ handle: session.handle, reason: "close" });
  sessions.delete(session.sessionId);
  if (session.connectionId && session.appToolBridgeId) {
    toolBridges.closeBridge(session.connectionId, session.appToolBridgeId);
  }
}

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
    mcpServers: toAcpxMcpServers(payload.mcpServers),
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

function requiredConnectionId(sink: AgentHostSink): string {
  if (!sink.connectionId) throw new Error("Agent host connection identity missing");
  return sink.connectionId;
}

function requiredToolSink(sink: AgentHostSink): ToolBridgeSink {
  if (!sink.sendToolCall || !sink.sendToolCancel) {
    throw new Error("Agent host does not support app tool events");
  }
  return {
    connectionId: requiredConnectionId(sink),
    sendToolCall: sink.sendToolCall,
    sendToolCancel: sink.sendToolCancel,
  };
}

function withAppToolMcpServer(
  payload: AcpStartPayload,
  sink: AgentHostSink,
  broker: ToolBridgeBroker,
): AcpStartPayload {
  if ((payload.mcpServers ?? []).some((server) => server.name === "lapis-tools")) {
    throw new Error("MCP server name is reserved: lapis-tools");
  }
  if (!payload.appToolBridgeId) return payload;
  const connectionId = requiredConnectionId(sink);
  const appServer =
    resolveAcpAgent(payload) === "cursor"
      ? broker.httpServerContribution(connectionId, payload.appToolBridgeId)
      : broker.serverContribution(connectionId, payload.appToolBridgeId);
  return {
    ...payload,
    mcpServers: [...(payload.mcpServers ?? []), appServer],
  };
}

export function toAcpxMcpServers(
  servers: AcpStartPayload["mcpServers"],
): Array<
  | {
      type: "stdio";
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      type: "http" | "sse";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    }
> {
  return (servers ?? []).map((server) =>
    isHttpMcpServer(server)
      ? {
          type: server.type,
          name: server.name,
          url: server.url,
          headers: [...(server.headers ?? [])],
        }
      : {
          type: "stdio" as const,
          name: server.name,
          command: server.command,
          args: server.args ?? [],
          env: Object.entries(server.env ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
        },
  );
}

function isHttpMcpServer(
  server: AcpMcpServer,
): server is Extract<AcpMcpServer, { type: "http" | "sse" }> {
  return server.type === "http" || server.type === "sse";
}

function nativeProcessArgs(
  args: string[],
  bridge: ReturnType<ToolBridgeBroker["serverContribution"]> | undefined,
): string[] {
  if (!bridge) return args;
  return [
    ...args,
    "-c",
    `mcp_servers.${bridge.name}.command=${JSON.stringify(bridge.command)}`,
    "-c",
    `mcp_servers.${bridge.name}.args=${JSON.stringify(bridge.args)}`,
  ];
}

function closeProcessBridge(
  processId: string,
  processBridges: Map<string, { connectionId: string; bridgeId: string }>,
  broker: ToolBridgeBroker,
): void {
  const bridge = processBridges.get(processId);
  processBridges.delete(processId);
  if (bridge) broker.closeBridge(bridge.connectionId, bridge.bridgeId);
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
