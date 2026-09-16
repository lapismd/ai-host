# `@lapismd/ai-host`

Standalone ACP process host for LapisMD. The npm package supports embedded
hosts and browser attachment; `lapis-ai-host` provides a Deno-compiled executable
with foreground operation, inspection, and user-service management.

## Install the executable

Choose the matching binary from a verified release artifact: `darwin-arm64`,
`darwin-x64`, `linux-arm64`, or `linux-x64`. Verify `SHA256SUMS`, then copy the
binary to a directory on your PATH, for example:

```sh
shasum -a 256 -c SHA256SUMS
mkdir -p ~/.local/bin
install -m 755 lapis-ai-host-darwin-arm64 ~/.local/bin/lapis-ai-host
lapis-ai-host --version
```

The executable contains its Deno runtime and extracts bundled files on first
launch. It needs a writable extraction location but no installed Node or Deno.
ACP agents remain external: install `codex-acp` or `cursor-agent`, or supply an agent registry with explicit commands. An external agent may itself require Node or other software. `doctor` checks command availability without launching, downloading, or authenticating agents.

## Initialize and run

```sh
lapis-ai-host init --workspace ~/code/workspace
lapis-ai-host config validate
lapis-ai-host serve
```

Configuration defaults to `~/.config/lapis-ai-host/default.json`. Set `--instance`
for another instance or `--config` for another file. XDG configuration and state
variables are respected. State is isolated by instance and configuration path.
`init` is idempotent and refuses conflicting definitions. It stores absolute
paths in an owner-only configuration and generates an owner-only token file.

Existing flag-only usage remains supported:

```sh
lapis-ai-host serve --workspace ~/code/workspace --port 7345
```

Explicit flags override configuration, then the established defaults. Bind is
`127.0.0.1`; a non-loopback bind requires repeatable `--origin` allowlist entries.
Use `--token-file` to supply an existing owner-only token; `--token` remains
supported for existing supervisors. Configuration files and tokens must have
mode `0600`.

### Connection token migration

The CLI no longer prints a token during startup. Retrieve it explicitly when
configuring a trusted client:

```sh
lapis-ai-host token show
```

`token show --json` also reveals the secret intentionally. Treat its output as a
credential. While running, this command returns the active token through the
owner-only control socket; while stopped, it reads the configured token file.
A transient `serve --token` override is not written back to that file. Embedded
library token results and output defaults remain compatible.

## Run as a user service

```sh
lapis-ai-host service install
lapis-ai-host service status
lapis-ai-host service restart
lapis-ai-host service stop
lapis-ai-host service start
lapis-ai-host service uninstall
```

Installation registers and starts a macOS LaunchAgent or Linux systemd user
service. Service definitions record absolute executable/configuration paths and
contain no connection tokens. Instances and custom configurations are isolated.
Uninstall preserves configuration, tokens, and workspace data. Restart closes
active sessions; it does not replay work. No service is installed by a build or
npm install.

## Inspect and troubleshoot

```sh
lapis-ai-host status
lapis-ai-host status --watch
lapis-ai-host doctor
lapis-ai-host sessions list --active
lapis-ai-host sessions show --session <id>
lapis-ai-host logs --lines 100
lapis-ai-host logs --follow
lapis-ai-host help service
```

Use `lapis-ai-host runtimes list` to inspect registered ACP runtimes. The default CLI commands are `codex-acp` and `cursor-agent acp`; embedded library agent defaults are unchanged. A custom `--agent-config` uses the existing `{ "agents": [...] }` registry format.

Status reports the live instance or `stopped`. Session inspection requires a
running host. Doctor checks configuration, workspace access, token permissions,
prerequisites and live connectivity; a stopped host is an unsuccessful
connectivity check. Runtime command availability does not imply authentication.
Logs contain operational metadata, never prompt/response text, tool payloads,
or terminal contents. Logs rotate at 10 MiB with three retained archives.

If startup fails, check `doctor`, the workspace path, permissions, and port
conflicts. Services retain the installation PATH and state-directory settings;
prefer absolute agent commands when the service environment differs from your
shell. Run `service install` again after moving an installed executable.

## JSON and terminal output

Human output uses checkmarks, crosses, and bullets. Color follows the terminal
and `NO_COLOR`; override it with `--color auto|always|never`.

```sh
lapis-ai-host status --json
lapis-ai-host status --watch --json
lapis-ai-host doctor --json
```

Finite commands return one `lapis-ai-host.cli/1` envelope with `command`, `ok`, and
`data` or `error`. Streaming commands return one event per line with `command`,
`event`, `time`, and `data`. JSON never contains ANSI or decorative icons. Error
exit codes are `1` for operation failure, `2` for invalid arguments/configuration,
and `3` when a required live service is unavailable. Doctor returns `1` when a
check fails. Global options work before and after commands; `--no-input` makes
noninteractive intent explicit (these commands never prompt).

The [CLI reference](./docs/cli/reference.md) is generated from the command tree.
`lapis-ai-host docs markdown-help` prints the same content.

## npm library compatibility

```sh
pnpm add @lapismd/ai-host
```

Use the root package for in-process hosts, `@lapismd/ai-host/client` for
browser/WebSocket attachment, and `@lapismd/ai-host/file-tools` for the
vault-free file-tool parsing and application helpers.

| Entry point                   | Purpose                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `@lapismd/ai-host`            | ACP executor, server, protocol, replay buffer, token helpers, and tool bridge exports.  |
| `@lapismd/ai-host/client`     | Browser-side runtime bridge that attaches to a running `lapis-ai-host serve` process.   |
| `@lapismd/ai-host/file-tools` | Algorithm-only file tool schemas, input normalization, diff parsing, and apply helpers. |
| `lapis-ai-host`               | CLI launcher for the authenticated local/remote ACP host.                               |
| `lapis-mcp-shim`              | Stable stdio MCP shim launcher used by built consumers.                                 |

## Development and validation

Use Deno **2.9.5** for reproducible executable builds and the repository's pnpm
version for library development.

```sh
pnpm install --frozen-lockfile
pnpm spec:check
pnpm check
pnpm test
pnpm build
deno task check
deno task build
deno task test:cli
deno task build:all
```

`pnpm build` preserves the published library under `dist/`. Deno builds write
only `artifacts/`: binaries, `SHA256SUMS`, `NOTICES.txt`, and `manifest.json` with
package version, source revision, target and toolchain. `--target linux-x64`
selects one target. Cross-compilation does not substitute for a native smoke run.
The CLI workflow runs isolated executable acceptance on all four native targets.

Update generated documentation with `deno task docs:write`; `docs:check` fails
if it drifts. `serve:local` remains a development helper using the ignored `.env`
token. Browser clients and consumer plugins retain their existing boundaries.

## Release

Changesets and the existing npm trusted-publishing workflow remain authoritative
for package releases. `pnpm packages:pack` verifies the npm artifact; the CLI
workflow prepares binaries and checksums without publishing them. Publish only
verified native artifacts from the same reviewed source/version. Publication,
installation, service replacement, and distribution signing/notarization require
explicit release authorization.

Canonical requirements live under [spec/src](./spec/src).
