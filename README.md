# `@lapismd/ai-host`

Standalone ACP process host for LapisMD consumers. The package owns acpx
execution, disposable model discovery, `lapis-ai-host serve`, the authenticated
WebSocket protocol, bounded replay, and the official-SDK MCP stdio shim.

Electron calls the library in-process. Web and Storybook attach with a URL and
token after the user starts the CLI. For local browser attach, run
`pnpm serve:local` or `lapis-ai-host serve-local` and use the printed
`lapis-ai-host-local` token in Settings. Consumer plugins must not depend on
this package at runtime.

Canonical requirements live in [`spec/src`](./spec/src).
