import { resolveAcpAgent } from "../acp/acp-agent";
import {
  modelCatalogFromStatus,
  rememberLastGoodCatalog,
  unavailableAcpModelCatalog,
} from "./catalog";
import { finishCursorCatalog } from "./session-lifecycle";
import type { ExecutorState } from "./state";
import type { AgentHostSink, AgentRuntimeExecutor, AcpStartPayload } from "./types";

export function createCatalogCommands(
  state: ExecutorState,
): Pick<AgentRuntimeExecutor, "listAcpModels" | "listAcpAgents"> {
  return {
    async listAcpModels(
      _sink: AgentHostSink,
      payload: Pick<AcpStartPayload, "workspace" | "agent" | "sessionId">,
    ) {
      const agent = resolveAcpAgent(payload, state.agentRegistry);
      const requestedSessionId = payload.sessionId?.trim();
      const requestedLiveSession = requestedSessionId
        ? state.acpSessions.get(requestedSessionId)
        : undefined;
      const liveSession =
        requestedLiveSession &&
        !requestedLiveSession.restricted &&
        requestedLiveSession.agentId === agent.id
          ? requestedLiveSession
          : [...state.acpSessions.values()].find(
              (session) => !session.restricted && session.agentId === agent.id,
            );
      if (liveSession?.runtime.getStatus) {
        const catalog = modelCatalogFromStatus(
          agent.id,
          await liveSession.runtime.getStatus({ handle: liveSession.handle }),
        );
        rememberLastGoodCatalog(state.lastGoodCatalogs, catalog);
        return finishCursorCatalog(state, agent, catalog, payload.workspace);
      }
      const cached = state.lastGoodCatalogs.get(agent.id);
      if (cached) {
        return finishCursorCatalog(state, agent, cached, payload.workspace);
      }
      const pending = state.catalogRefresh.get(agent.id);
      if (pending) {
        await pending;
        return finishCursorCatalog(
          state,
          agent,
          state.lastGoodCatalogs.get(agent.id) ??
            unavailableAcpModelCatalog(agent.id),
          payload.workspace,
        );
      }
      const work = Promise.resolve()
        .then(() =>
          state.listAgentInventory(agent, { workspace: payload.workspace }),
        )
        .then((catalog) => {
          if (catalog.models.length > 0) {
            rememberLastGoodCatalog(state.lastGoodCatalogs, catalog);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          state.catalogRefresh.delete(agent.id);
        });
      state.catalogRefresh.set(agent.id, work);
      await work;
      return finishCursorCatalog(
        state,
        agent,
        state.lastGoodCatalogs.get(agent.id) ??
          unavailableAcpModelCatalog(agent.id),
        payload.workspace,
      );
    },

    listAcpAgents() {
      return {
        agents: state.agentRegistry.list().map(({ id, label, mcpTransport }) => ({
          id,
          label,
          mcpTransport,
        })),
      };
    },
  };
}
