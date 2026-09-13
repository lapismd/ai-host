import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAcpAgentRegistry,
  resolveAcpAgent,
  type AcpAgentDefinition,
  type AcpAgentRegistry,
} from "./acp-agent";
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
  sequenceBase?: number;
  workspace?: string;
  agent?: string;
  model?: { provider?: string; model?: string };
  thinking?: "off" | "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
  mcpServers?: AcpMcpServer[];
  resumeSessionId?: string;
  appToolBridgeId?: string;
  restricted?: boolean;
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
    "allow_once" | "allow_always" | "reject_once" | "reject_always" | "cancel";
};

export type AcpModelCatalog = {
  agent: string;
  currentModel?: string;
  models: string[];
  entries: AcpModelEntry[];
  configOptions: AcpConfigOption[];
};

export type AcpConfigOption = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options?: Array<{ value: string; name: string; description?: string }>;
};

export type AcpAgentCatalogEntry = {
  id: string;
  label: string;
  mcpTransport: "stdio" | "http";
};

export type AcpSessionStatus = {
  sessionId: string;
  state: "initializing" | "idle" | "running" | "missing";
  runId?: string;
  latestSequence: number;
  pendingPermissions: Array<{
    requestId: string;
    expiresAt?: number;
    options: string[];
  }>;
};

export type AcpConfigurationFieldResult = {
  status: "applied" | "unchanged" | "unsupported";
  reason?: string;
};

export type AcpConfigurePayload = {
  sessionId: string;
  model?: { provider?: string; model?: string };
  thinking?: "off" | "low" | "medium" | "high";
};

export type AcpConfigureResult = {
  model?: AcpConfigurationFieldResult;
  thinking?: AcpConfigurationFieldResult;
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
    details?: {
      configOptions?: unknown;
      [key: string]: unknown;
    };
  }>;
  getCapabilities?(input: {
    handle: AcpRuntimeHandle;
  }):
    Promise<{ configOptionKeys?: string[] }> | { configOptionKeys?: string[] };
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

type PendingAcpApproval = ((decision: AcpPermissionDecision) => void) & {
  connectionId?: string;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  expiresAt?: number;
  options?: string[];
  timeout?: ReturnType<typeof setTimeout>;
};

export type CreateAcpxRuntimeContext = {
  agent: AcpAgentDefinition;
  connectionId?: string;
  permissionTimeoutMs: number;
};

export type CreateAcpxRuntime = (
  sink: AgentRuntimeInputSink,
  sessionId: string,
  payload: AcpStartPayload,
  pendingApprovals: Map<string, PendingAcpApproval>,
  context: CreateAcpxRuntimeContext,
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
    payload: Pick<AcpStartPayload, "workspace" | "agent" | "sessionId">,
  ): Promise<AcpModelCatalog>;
  listAcpAgents(): { agents: AcpAgentCatalogEntry[] };
  getAcpSessionStatus(sessionId: string): AcpSessionStatus;
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
  configureAcpSession(
    payload: AcpConfigurePayload,
  ): Promise<AcpConfigureResult>;
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
  agentRegistry?: AcpAgentRegistry;
  permissionTimeoutMs?: number;
  disconnectGraceMs?: number;
  toolBridgeBroker?: ToolBridgeBroker;
  toolBridgeOptions?: ToolBridgeBrokerOptions;
}): AgentRuntimeExecutor {
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const processBridges = new Map<
    string,
    { connectionId: string; bridgeId: string }
  >();
  const acpSessions = new Map<string, AcpSessionState>();
  const pendingAcpSessions = new Map<string, PendingAcpSessionState>();
  const pendingApprovals = new Map<string, PendingAcpApproval>();
  const createAcpx = options?.createAcpxRuntime ?? defaultCreateAcpxRuntime;
  const agentRegistry = options?.agentRegistry ?? createAcpAgentRegistry();
  const permissionTimeoutMs = normalizePositiveDuration(
    options?.permissionTimeoutMs,
    15 * 60_000,
  );
  const disconnectGraceMs = normalizePositiveDuration(
    options?.disconnectGraceMs,
    60_000,
  );
  const toolBridges =
    options?.toolBridgeBroker ??
    new ToolBridgeBroker(options?.toolBridgeOptions);

  async function initializeAcpSession(
    sink: AgentHostSink,
    payload: AcpStartPayload,
    sessionId: string,
    initialState?: AcpSessionState,
  ): Promise<AcpSessionState> {
    const sequenceBase = resolveSequenceBase(payload);
    const existing = acpSessions.get(sessionId);
    if (existing) {
      if (
        existing.appToolBridgeId !== payload.appToolBridgeId ||
        existing.restricted !== (payload.restricted === true) ||
        (existing.appToolBridgeId !== undefined &&
          existing.connectionId !== sink.connectionId)
      ) {
        settlePendingPermissions(pendingApprovals, sessionId, {
          outcome: "reject_once",
        });
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
        existing.nextSequence = Math.max(existing.nextSequence, sequenceBase);
        return existing;
      }
    }
    const effectivePayload = payload.restricted
      ? restrictedAcpPayload(payload)
      : withAppToolMcpServer(payload, sink, toolBridges, agentRegistry);
    const agent = resolveAcpAgent(effectivePayload, agentRegistry);
    const session =
      initialState ?? createAcpSessionState(sessionId, sink, sequenceBase);
    session.nextSequence = Math.max(session.nextSequence, sequenceBase);
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
      {
        agent,
        connectionId: sink.connectionId,
        permissionTimeoutMs,
      },
    );
    const handle = await runtime.ensureSession({
      sessionKey: sessionId,
      agent: agent.id,
      mode: effectivePayload.restricted ? "oneshot" : "persistent",
      cwd: effectivePayload.workspace,
      sessionOptions: toAcpxSessionOptions(effectivePayload),
    });
    const thinking = toAcpxThinkingValue({
      agent: agent.id,
      thinking: effectivePayload.thinking,
    });
    const thinkingKey = thinking
      ? await thinkingConfigurationKey(runtime, handle)
      : undefined;
    if (thinking && thinkingKey) {
      try {
        if (!runtime.setConfigOption) {
          throw new Error(
            `ACP agent ${agent.id} does not support thinking configuration.`,
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
          discardPersistentState: !payload.resumeSessionId,
        });
        throw error;
      }
    }
    session.runtime = runtime;
    session.handle = handle;
    session.agentId = agent.id;
    session.connectionId = sink.connectionId;
    session.appToolBridgeId = effectivePayload.appToolBridgeId;
    session.restricted = effectivePayload.restricted === true;
    acpSessions.set(sessionId, session);
    return session;
  }

  function beginAcpTurn(
    session: AcpSessionState,
    sink: AgentHostSink,
    text: string,
    runId: string,
  ): void {
    if (session.running) {
      throw new Error(
        `ACP session already has an active turn: ${session.sessionId}`,
      );
    }
    session.sink = sink;
    session.currentRunId = runId;
    session.running = true;
    let turn: ReturnType<AcpSessionState["runtime"]["startTurn"]>;
    try {
      turn = session.runtime.startTurn({
        handle: session.handle,
        text,
        mode: "prompt",
        requestId: runId,
      });
    } catch (error) {
      session.running = false;
      throw error;
    }
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
          session.running = false;
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
        session.running = false;
      } catch (error) {
        settlePendingPermissions(pendingApprovals, session.sessionId, {
          outcome: "reject_once",
        });
        emitRuntimeEvent(session, runId, {
          sessionId: session.sessionId,
          type: "event",
          event: {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
        session.running = false;
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
      const child = spawn(
        command,
        nativeProcessArgs(payload.args ?? [], bridge),
        {
          cwd: payload.cwd,
          env: { ...process.env, ...payload.env, ...bridge?.env },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
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
      const sequenceBase = resolveSequenceBase(payload);
      const pending = pendingAcpSessions.get(sessionId);
      if (pending) {
        pending.session.sink = sink;
        pending.session.nextSequence = Math.max(
          pending.session.nextSequence,
          sequenceBase,
        );
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
      const session = createAcpSessionState(
        sessionId,
        sink,
        resolveSequenceBase(payload),
      );
      const pending: PendingAcpSessionState = {
        session,
        prompts: new Set(),
        closed: false,
        ready: new Promise<AcpSessionState>((resolve, reject) => {
          setTimeout(() => {
            void initializeAcpSession(sink, payload, sessionId, session).then(
              resolve,
              reject,
            );
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
      const agent = resolveAcpAgent(payload, agentRegistry);
      const requestedSessionId = payload.sessionId?.trim();
      const requestedLiveSession = requestedSessionId
        ? acpSessions.get(requestedSessionId)
        : undefined;
      const liveSession =
        requestedLiveSession &&
        !requestedLiveSession.restricted &&
        requestedLiveSession.agentId === agent.id
          ? requestedLiveSession
          : [...acpSessions.values()].find(
              (session) => !session.restricted && session.agentId === agent.id,
            );
      if (liveSession?.runtime.getStatus) {
        return modelCatalogFromStatus(
          agent.id,
          await liveSession.runtime.getStatus({ handle: liveSession.handle }),
        );
      }
      const sessionId = randomUUID();
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
        { ...payload, agent: agent.id },
        pendingApprovals,
        {
          agent,
          connectionId: sink.connectionId,
          permissionTimeoutMs,
        },
      );
      if (requestedSessionId && runtime.getStatus) {
        try {
          return modelCatalogFromStatus(
            agent.id,
            await runtime.getStatus({
              handle: {
                sessionKey: requestedSessionId,
                runtimeSessionName: requestedSessionId,
              },
            }),
          );
        } catch (error) {
          if (!isMissingAcpSession(error)) throw error;
        }
      }
      const handle = await runtime.ensureSession({
        sessionKey: `model-catalog:${agent.id}:${sessionId}`,
        agent: agent.id,
        mode: "oneshot",
        cwd: payload.workspace,
      });
      try {
        if (!runtime.getStatus) {
          return {
            agent: agent.id,
            models: [],
            entries: [],
            configOptions: [],
          };
        }
        return modelCatalogFromStatus(
          agent.id,
          await runtime.getStatus({ handle }),
        );
      } finally {
        await closeDisposableAcpSession(runtime, handle);
      }
    },

    listAcpAgents() {
      return {
        agents: agentRegistry.list().map(({ id, label, mcpTransport }) => ({
          id,
          label,
          mcpTransport,
        })),
      };
    },

    getAcpSessionStatus(sessionId) {
      const pending = pendingAcpSessions.get(sessionId);
      const session = acpSessions.get(sessionId) ?? pending?.session;
      if (!session) {
        return {
          sessionId,
          state: "missing",
          latestSequence: 0,
          pendingPermissions: [],
        };
      }
      return {
        sessionId,
        state: pending ? "initializing" : session.running ? "running" : "idle",
        ...(session.currentRunId !== "session"
          ? { runId: session.currentRunId }
          : {}),
        latestSequence: session.nextSequence,
        pendingPermissions: pendingPermissionsForSession(
          pendingApprovals,
          sessionId,
        ),
      };
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

    async configureAcpSession(payload) {
      const pending = pendingAcpSessions.get(payload.sessionId);
      const session =
        acpSessions.get(payload.sessionId) ?? (await pending?.ready);
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
        const currentModel = runtime.getStatus
          ? (await runtime.getStatus({ handle: session.handle })).models
              ?.currentModelId
          : undefined;
        if (currentModel === requestedModel) {
          result.model = { status: "unchanged" };
        } else if (!keys.includes("model") || !runtime.setConfigOption) {
          result.model = {
            status: "unsupported",
            reason: "The ACP session does not advertise model configuration.",
          };
        } else {
          try {
            await runtime.setConfigOption({
              handle: session.handle,
              key: "model",
              value: requestedModel,
            });
            const effectiveModel = runtime.getStatus
              ? (await runtime.getStatus({ handle: session.handle })).models
                  ?.currentModelId
              : undefined;
            result.model =
              effectiveModel === requestedModel
                ? { status: "applied" }
                : {
                    status: "unsupported",
                    reason:
                      "The ACP session did not verify the requested model.",
                  };
          } catch (error) {
            result.model = {
              status: "unsupported",
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        }
      }

      if (payload.thinking) {
        const thinkingKey = ["thinking", "effort", "reasoning_effort"].find(
          (key) => keys.includes(key),
        );
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
                thinking: payload.thinking,
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

    async cancelAcpSession(sessionId) {
      settlePendingPermissions(pendingApprovals, sessionId, {
        outcome: "cancel",
      });
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
      settlePendingPermissions(pendingApprovals, sessionId, {
        outcome: "reject_once",
      });
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
      const normalized = normalizePermissionDecision(decision, resolve.options);
      pendingApprovals.delete(key);
      clearPendingApprovalTimers(resolve);
      resolve(normalized);
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
      for (const [key, approval] of pendingApprovals) {
        if (approval.connectionId !== connectionId) continue;
        clearTimeout(approval.disconnectTimer);
        approval.disconnectTimer = setTimeout(() => {
          if (!pendingApprovals.delete(key)) return;
          clearPendingApprovalTimers(approval);
          approval({ outcome: "reject_once" });
        }, disconnectGraceMs);
      }
    },

    async close() {
      settlePendingPermissions(pendingApprovals, undefined, {
        outcome: "reject_once",
      });
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

function modelCatalogFromStatus(
  agent: string,
  status: Awaited<ReturnType<NonNullable<AcpxRuntimeLike["getStatus"]>>>,
): AcpModelCatalog {
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
    configOptions: parseAcpConfigOptions(status.details?.configOptions),
  };
}

function isMissingAcpSession(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("ACP session not found:")
  );
}

export function parseAcpConfigOptions(value: unknown): AcpConfigOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AcpConfigOption[] => {
    if (!item || typeof item !== "object") return [];
    const option = item as Record<string, unknown>;
    const id = typeof option.id === "string" ? option.id.trim() : "";
    const name = typeof option.name === "string" ? option.name.trim() : "";
    const type = option.type;
    const currentValue = option.currentValue;
    if (
      !id ||
      !name ||
      (type !== "select" && type !== "boolean") ||
      (typeof currentValue !== "string" && typeof currentValue !== "boolean")
    )
      return [];
    const values =
      type === "select" && Array.isArray(option.options)
        ? option.options.flatMap(
            (entry): NonNullable<AcpConfigOption["options"]> => {
              if (!entry || typeof entry !== "object") return [];
              const candidate = entry as Record<string, unknown>;
              const value =
                typeof candidate.value === "string"
                  ? candidate.value.trim()
                  : "";
              const label =
                typeof candidate.name === "string" ? candidate.name.trim() : "";
              return value && label
                ? [
                    {
                      value,
                      name: label,
                      ...(typeof candidate.description === "string" &&
                      candidate.description.trim()
                        ? { description: candidate.description.trim() }
                        : {}),
                    },
                  ]
                : [];
            },
          )
        : undefined;
    if (type === "select" && (!values || values.length === 0)) return [];
    return [
      {
        id,
        name,
        type,
        currentValue,
        ...(typeof option.description === "string" && option.description.trim()
          ? { description: option.description.trim() }
          : {}),
        ...(typeof option.category === "string" && option.category.trim()
          ? { category: option.category.trim() }
          : {}),
        ...(values ? { options: values } : {}),
      },
    ];
  });
}

type AcpSessionState = {
  sessionId: string;
  runtime: AcpxRuntimeLike;
  handle: AcpRuntimeHandle;
  sink: AgentHostSink;
  currentRunId: string;
  nextSequence: number;
  agentId?: string;
  connectionId?: string;
  appToolBridgeId?: string;
  restricted: boolean;
  running: boolean;
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
  sequenceBase = 0,
): AcpSessionState {
  return {
    sessionId,
    sink,
    currentRunId: "session",
    nextSequence: sequenceBase,
    runtime: undefined as unknown as AcpxRuntimeLike,
    handle: undefined as unknown as AcpRuntimeHandle,
    restricted: false,
    running: false,
  };
}

function resolveSequenceBase(payload: AcpStartPayload): number {
  const value = payload.sequenceBase ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("ACP sequence base must be a non-negative safe integer");
  }
  return value;
}

function resolveAcpSessionId(payload: AcpStartPayload): string {
  const sessionId = payload.sessionId?.trim();
  const resumeSessionId = payload.resumeSessionId?.trim();
  if (payload.restricted && resumeSessionId) {
    throw new Error("Restricted ACP sessions cannot resume persistent state.");
  }
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
  await session.runtime.close({
    handle: session.handle,
    reason: "close",
    discardPersistentState: session.restricted,
  });
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

async function thinkingConfigurationKey(
  runtime: AcpxRuntimeLike,
  handle: AcpRuntimeHandle,
): Promise<string | undefined> {
  if (!runtime.getCapabilities) return "thinking";
  const capabilities = await runtime.getCapabilities({ handle });
  const keys = capabilities.configOptionKeys ?? [];
  return ["thinking", "effort", "reasoning_effort"].find((key) =>
    keys.includes(key),
  );
}

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
    }) => unknown;
    createRuntimeStore: (options: { stateDir: string }) => unknown;
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
  let runtime: AcpxRuntimeLike;
  try {
    runtime = acpx.createAcpRuntime({
      cwd,
      sessionStore: acpx.createRuntimeStore({
        stateDir: `${cwd}/.lapis/ai-sessions`,
      }),
      agentRegistry: acpx.createAgentRegistry(
        context.agent.command
          ? { overrides: { [context.agent.id]: context.agent.command } }
          : undefined,
      ),
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
    if (temporaryCwd) {
      await rm(temporaryCwd, { recursive: true, force: true });
    }
    throw error;
  }
  if (!temporaryCwd) return runtime;
  const close = runtime.close.bind(runtime);
  const ensureSession = runtime.ensureSession.bind(runtime);
  runtime.ensureSession = async (input) => {
    try {
      return await ensureSession(input);
    } catch (error) {
      await rm(temporaryCwd, { recursive: true, force: true });
      throw error;
    }
  };
  runtime.close = async (input) => {
    try {
      await close(input);
    } finally {
      await rm(temporaryCwd, { recursive: true, force: true });
    }
  };
  return runtime;
}

function requiredConnectionId(sink: AgentHostSink): string {
  if (!sink.connectionId)
    throw new Error("Agent host connection identity missing");
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
  registry: AcpAgentRegistry,
): AcpStartPayload {
  if (
    (payload.mcpServers ?? []).some((server) => server.name === "lapis-tools")
  ) {
    throw new Error("MCP server name is reserved: lapis-tools");
  }
  if (!payload.appToolBridgeId) return payload;
  const connectionId = requiredConnectionId(sink);
  const appServer =
    resolveAcpAgent(payload, registry).mcpTransport === "http"
      ? broker.httpServerContribution(connectionId, payload.appToolBridgeId)
      : broker.serverContribution(connectionId, payload.appToolBridgeId);
  return {
    ...payload,
    mcpServers: [...(payload.mcpServers ?? []), appServer],
  };
}

function restrictedAcpPayload(payload: AcpStartPayload): AcpStartPayload {
  return {
    ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    ...(payload.agent ? { agent: payload.agent } : {}),
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.thinking ? { thinking: payload.thinking } : {}),
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
    restricted: true,
    mcpServers: [],
  };
}

export function toAcpxMcpServers(servers: AcpStartPayload["mcpServers"]): Array<
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
  offeredOutcomes?: readonly string[],
): AcpPermissionDecision {
  const outcome = typeof decision === "string" ? decision : decision.outcome;
  if (!PERMISSION_OUTCOMES.has(outcome)) {
    throw new Error(`Invalid ACP permission decision: ${outcome}`);
  }
  if (
    outcome !== "cancel" &&
    offeredOutcomes &&
    !offeredOutcomes.includes(outcome)
  ) {
    throw new Error(`ACP permission decision was not offered: ${outcome}`);
  }
  return { outcome } as AcpPermissionDecision;
}

const PERMISSION_OUTCOMES = new Set([
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
  "cancel",
]);

function permissionOptionOutcomes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const kind = (option as Record<string, unknown>).kind;
    return typeof kind === "string" && PERMISSION_OUTCOMES.has(kind)
      ? [kind]
      : [];
  });
}

function clearPendingApprovalTimers(approval: PendingAcpApproval): void {
  clearTimeout(approval.timeout);
  clearTimeout(approval.disconnectTimer);
}

function settlePendingPermissions(
  approvals: Map<string, PendingAcpApproval>,
  sessionId: string | undefined,
  decision: AcpPermissionDecision,
): void {
  const prefix = sessionId === undefined ? undefined : `${sessionId}:`;
  for (const [key, approval] of approvals) {
    if (prefix !== undefined && !key.startsWith(prefix)) continue;
    approvals.delete(key);
    clearPendingApprovalTimers(approval);
    approval(decision);
  }
}

function pendingPermissionsForSession(
  approvals: Map<string, PendingAcpApproval>,
  sessionId: string,
): AcpSessionStatus["pendingPermissions"] {
  const prefix = `${sessionId}:`;
  return [...approvals.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, approval]) => ({
      requestId: key.slice(prefix.length),
      ...(approval.expiresAt === undefined
        ? {}
        : { expiresAt: approval.expiresAt }),
      options: [...(approval.options ?? [])],
    }));
}

function normalizePositiveDuration(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}
