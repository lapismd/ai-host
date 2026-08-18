# Architecture

The package lives at the repository root and publishes a library, a `./client`
bridge, a vault-free `./file-tools` kernel, and the `lapis-ai-host` and
`lapis-mcp-shim` CLIs. Disposable ACP model discovery returns raw ids plus
structured labels and badges for consumers. The development-only `serve:local` package script seeds
an ignored `.env` `LAPIS_AGENT_RUNTIME_TOKEN` when missing, then starts the
existing `serve` command with that token. It is a non-authoritative execution
transport: conversations, tool authority, and note content remain in the
consuming application. The file-tools leaf supplies schemas and apply
algorithms only.

## Requirements

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AH-PKG-001 | Private `@lapismd/ai-host` MUST live at the repository root, expose `build`, `check`, `test`, a `lapis-ai-host` CLI, and a `./file-tools` leaf. It MUST own acpx, agent-scoped model discovery, and standalone transport error propagation. Consumer plugins MUST NOT depend on it at runtime. `@lapis-notes/api` MAY depend on `./file-tools` only. |
| AH-PKG-002 | `@lapismd/ai-host` MUST own live local or authenticated-remote MCP transport through the official-SDK stdio shim and token-authenticated broker. The `./file-tools` kernel MUST remain algorithm-only. The package MUST NOT become a durable tool, note-content, or conversation authority. |
| AH-PKG-003 | The `serve:local` package script MUST remain development-only. It MUST seed an ignored `.env` `LAPIS_AGENT_RUNTIME_TOKEN` when that file or key is missing, then start `lapis-ai-host serve` with that token. It MUST NOT add a public CLI subcommand or change production token generation.                                              |
