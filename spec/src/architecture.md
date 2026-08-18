# Architecture

The package lives at the repository root and publishes a library, a `./client`
bridge, and the `lapis-ai-host` and `lapis-mcp-shim` CLIs. The `serve:local`
package script starts `lapis-ai-host serve-local` for loopback testing with the
published fixed token. It is a non-authoritative execution transport:
conversations, tool implementations, and note content remain in the consuming
application.

## Requirements

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AH-PKG-001 | Private `@lapismd/ai-host` MUST live at the repository root, expose `build`, `check`, `test`, and a `lapis-ai-host` CLI. It MUST own acpx, agent-scoped model discovery, and standalone transport error propagation. Consumer plugins MUST NOT depend on it at runtime.                                                                     |
| AH-PKG-002 | `@lapismd/ai-host` MUST own live local or authenticated-remote MCP transport through the official-SDK stdio shim and token-authenticated broker. It MUST NOT become a durable tool, note-content, or conversation authority.                                                                                                                |
