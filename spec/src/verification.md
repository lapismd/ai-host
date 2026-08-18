# Verification

| ID           | Status      | Evidence |
| ------------ | ----------- | -------- |
| AH-GOV-001   | Implemented | `pnpm spec:build` builds the standalone mdBook. |
| AH-GOV-002   | Implemented | `pnpm spec:first` maps protected changes to canonical chapters. |
| AH-GOV-003   | Implemented | `pnpm spec:validate` enforces unique definitions and one verification row per ID. |
| AH-GOV-004   | Implemented | `docs/HISTORY_MIGRATION.md` records the extraction and audit. |
| AH-GOV-005   | Implemented | Focused path classification in `spec-validator.config.mjs`. |
| AH-PKG-001   | Implemented | Root `package.json` names `@lapismd/ai-host` and exposes `build`, `check`, `test`, `lapis-ai-host`, and `./file-tools`. |
| AH-PKG-002   | Implemented | `src/mcp-shim.ts` and `src/tool-bridge.ts` own the stdio shim and broker; `src/file-tools` stays algorithm-only. |
| AH-FT-001    | Implemented | `package.json` publishes `./file-tools`; the leaf and its isolation test import no MCP, acpx, or transport modules. |
| AH-FT-002    | Implemented | File-tools tests accept `{ path, content }` write plans and leave path checks to the caller. |
| AH-FT-003    | Implemented | File-tools tests hoist `edits[]`, flat old/new pairs, string aliases, `file_path`, and JSON-string `edits`. |
| AH-FT-004    | Implemented | File-tools tests cover unique, zero, repeated, overlapping, and no-op edit hunks. |
| AH-FT-005    | Implemented | File-tools tests parse V4A add, update, delete, and move envelopes and apply update hunks through injected operations. |
| AH-FT-006    | Implemented | Execute helpers take caller operations and a path resolver; no vault types appear in the leaf. |
| AH-FT-007    | Implemented | `src/file-tools/NOTICE.md` retains the OpenClaw MIT copyright. |
| AH-PKG-003   | Implemented | `scripts/serve-local.test.ts` seeds or reuses `.env` `LAPIS_AGENT_RUNTIME_TOKEN` and starts `serve`; `src/parse-cli.test.ts` still accepts only `serve`. |
| AH-CLI-001   | Implemented | `src/parse-cli.test.ts` and `src/serve.ts` require a token and default to localhost. |
| AH-WS-001    | Implemented | `src/handshake.test.ts` rejects missing hello, a bad token, and a first command. |
| AH-WS-002    | Implemented | `src/protocol.ts` and `src/ws-contract.test.ts` use `desktop_agent_acp_*` commands and `agent-runtime-event` frames. |
| AH-WS-003    | Implemented | Executor and WebSocket tests reject pending commands on transport closure and emit one runtime error. |
| AH-WS-004    | Implemented | `src/ws-contract.test.ts` issues two commands on a fresh bridge and shares one handshake. |
| AH-PROTO-001 | Implemented | `src/replay-buffer.test.ts` and `src/ws-contract.test.ts` cover bounds, ordered subscribe, explicit-close cleanup, and no prompt resend. |
| AH-ACP-001   | Implemented | `src/acp-session-options.test.ts` and executor tests keep sessions usable when thinking is unadvertised. |
| AH-ACP-002   | Implemented | Executor tests preserve a successful catalog when backend `session/close` is unsupported. |
| AH-ACP-003   | Implemented | `src/acp-agent.ts` and `src/acp-session-options.ts` pass agent, model, and capability-aware thinking to acpx. |
| AH-ACP-004   | Implemented | `src/acp-model-catalog.test.ts` and executor catalog tests return ids plus Cursor label and badges. |
| AH-ACP-005   | Implemented | Executor restart-resume test reuses the host id as sessionKey and omits acpx resumeSessionId. |
| AH-MCP-001   | Implemented | `src/tool-bridge.test.ts` covers v3 bridge messages, reserved `lapis-tools`, token authorization, and disconnect cancellation. |
| AH-MCP-002   | Implemented | `src/executor.test.ts` projects MCP servers with `type: stdio` and required stdio fields. |
