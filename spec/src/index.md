# Specification

`@lapismd/ai-host` is the standalone LapisMD process host. It owns acpx, ACP
session execution, disposable model discovery, `lapis-ai-host serve` and
`serve-local`, the authenticated WebSocket protocol, bounded replay, and the
official-SDK MCP stdio shim.

Electron may call the library in-process. Web and Storybook attach only with a
configured URL and token after the user starts the CLI. Consumer plugins MUST
NOT depend on this package at runtime.

Canonical requirements live in the following chapters. Verification evidence
is indexed in [Verification](verification.md).
