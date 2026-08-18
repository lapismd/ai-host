# Verification

| ID           | Status      | Evidence |
| ------------ | ----------- | -------- |
| AH-GOV-001   | Implemented | `pnpm spec:build` builds the standalone mdBook. |
| AH-GOV-002   | Implemented | `pnpm spec:first` maps protected changes to canonical chapters. |
| AH-GOV-003   | Implemented | `pnpm spec:validate` enforces unique definitions and one verification row per ID. |
| AH-GOV-004   | Implemented | `docs/HISTORY_MIGRATION.md` records the extraction and audit. |
| AH-GOV-005   | Implemented | Focused path classification in `spec-validator.config.mjs`. |
| AH-PKG-001   | Implemented | Root `package.json` names `@lapismd/ai-host` and exposes `build`, `check`, `test`, and `lapis-ai-host`. |
| AH-PKG-002   | Implemented | `src/mcp-shim.ts` and `src/tool-bridge.ts` own the stdio shim and broker without conversation storage. |
| AH-CLI-001   | Implemented | `src/parse-cli.test.ts` and `src/serve.ts` require a token and default to localhost. |
| AH-CLI-002   | Implemented | `src/parse-cli.test.ts` and `src/serve.test.ts` pin `serve-local` to the published loopback token and reject `--token` or a public bind. |
| AH-WS-001    | Implemented | `src/handshake.test.ts` rejects missing hello, a bad token, and a first command. |
| AH-WS-002    | Implemented | `src/protocol.ts` and `src/ws-contract.test.ts` use `desktop_agent_acp_*` commands and `agent-runtime-event` frames. |
| AH-WS-003    | Implemented | Executor and WebSocket tests reject pending commands on transport closure and emit one runtime error. |
| AH-PROTO-001 | Implemented | `src/replay-buffer.test.ts` and `src/ws-contract.test.ts` cover bounds, ordered subscribe, explicit-close cleanup, and no prompt resend. |
| AH-ACP-001   | Implemented | `src/acp-session-options.test.ts` and executor tests keep sessions usable when thinking is unadvertised. |
| AH-ACP-002   | Implemented | Executor tests preserve a successful catalog when backend `session/close` is unsupported. |
| AH-ACP-003   | Implemented | `src/acp-agent.ts` and `src/acp-session-options.ts` pass agent, model, and capability-aware thinking to acpx. |
| AH-MCP-001   | Implemented | `src/tool-bridge.test.ts` covers v3 bridge messages, reserved `lapis-tools`, token authorization, and disconnect cancellation. |
