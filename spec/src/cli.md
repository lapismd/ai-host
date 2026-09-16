# Standalone operator CLI

The package ships a self-contained Deno executable alongside its existing npm
library and launchers. Host runtime policy remains package-owned. Consumer
application, identity, and conversation policy remains outside this CLI.

## Requirements

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AH-OPS-001 | A typed command tree MUST drive parsing, contextual help, typo hints, and the checked-in Markdown reference. Global config, instance, JSON, no-input, and color options MUST work before or after commands.                                                                                                                                                             |
| AH-OPS-002 | Finite JSON commands MUST return one versioned envelope. Serve, watched status, and followed logs MUST emit NDJSON. Errors MUST use stable codes and exit status 1 for operation failure, 2 for invalid input, and 3 for unavailable live control. Human output MUST support automatic, forced, and disabled color.                                                     |
| AH-OPS-003 | Init MUST atomically create owner-only configuration and tokens, retain absolute paths, be idempotent, and reject conflicting definitions. Explicit serve flags MUST override configuration, then existing defaults. Token output MUST require explicit token show; ordinary CLI output and logs MUST redact secrets. Embedded library defaults MUST remain compatible. |
| AH-OPS-004 | Each configuration and instance MUST have an owner-only local control socket. Status and read-only session inspection MUST use live host state, exclude content payloads, reject duplicate ownership, and safely recover stale sockets.                                                                                                                                 |
| AH-OPS-005 | User services MUST support install, start, stop, restart, status, and uninstall through launchd or systemd. Definitions MUST use absolute invocation and configuration paths, isolate instances, and preserve data on uninstall. Shutdown MUST close runtime sessions without replaying work.                                                                           |
| AH-OPS-006 | Doctor MUST report configuration, workspace, token, runtime prerequisites and live connectivity without starting or installing external agents. Logs MUST contain operational metadata only and support bounded retention and follow.                                                                                                                                   |
| AH-OPS-007 | Deno builds MUST produce macOS/Linux arm64/x64 executables, checksums, notices, and a version/revision/toolchain manifest outside npm dist. The compiled host MUST start without installed Node or Deno. External ACP agents and shells remain operator prerequisites.                                                                                                  |
| AH-OPS-008 | Compiled AI execution MUST launch its MCP shim through the same executable and resolve external ACP commands without using the host binary as Node. Each host MUST preserve its npm exports and WebSocket protocol.                                                                                                                                                     |

Default configuration is `$XDG_CONFIG_HOME/<binary>/<instance>.json` (fallback
`~/.config`). Private runtime state uses `$XDG_STATE_HOME` (fallback
`~/.local/state`) and a configuration-path hash to isolate custom configurations.
CLI schemas are `<binary>.cli/1`; library-returned tokens remain available to
embedding callers. `token show --json` is an explicit secret disclosure.

External ACP argv arrays preserve literal argument bytes when resolving an
installed executable. Host startup does not reinterpret the compiled binary as
Node, including when a configured package launcher is missing (AH-OPS-008).
