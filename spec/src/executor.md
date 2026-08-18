# Executor

The executor adapts acpx, applies advertised session capabilities, and hosts
the application-tool MCP shim. It keeps acpx types inside this package.

## Requirements

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AH-ACP-001 | When an ACP session does not advertise `thinking` or `effort`, the host MUST keep the session usable with the agent default. It MUST NOT fail session start solely because the requested thinking control is unavailable.                                                                                                                   |
| AH-ACP-002 | Disposable ACP model discovery MUST read an agent's model status from a one-shot session and close that session without persistent state. Cleanup MUST tolerate agents that do not advertise `session/close` without turning a successful listing into a failure.                                                                            |
| AH-ACP-003 | The host MUST accept model, thinking, and a first-class `agent` on ACP start, default the agent to `codex`, pass that name and model to acpx `ensureSession`, and apply thinking through advertised session configuration only.                                                                                                              |
| AH-ACP-004 | `listAcpModels` MUST return each raw agent model id plus a structured entry with `label` and optional badges. Cursor bracket attributes MUST become a short label and Fast or Low/Medium/High badges. Session start MUST still receive the raw id. |
| AH-MCP-001 | Protocol v3 MUST add authenticated application-tool bridge open, response, close, call, and cancellation messages while preserving protocol-v2 agent fallback without tools. The host MUST expose tools through an official-SDK stdio MCP shim backed by a token-authenticated ephemeral `127.0.0.1` broker, reserve `lapis-tools`, keep credentials out of arguments and durable state, and cancel in-flight calls when the owning connection closes. |
