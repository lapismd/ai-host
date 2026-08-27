# `@lapismd/ai-host`

[![Release](https://github.com/lapismd/ai-host/actions/workflows/release.yml/badge.svg)](https://github.com/lapismd/ai-host/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@lapismd/ai-host.svg)](https://www.npmjs.com/package/@lapismd/ai-host)

Standalone ACP process host for LapisMD consumers. AI Host owns acpx execution,
disposable model discovery, `lapis-ai-host serve`, the authenticated WebSocket
protocol, bounded replay, and the official-SDK MCP stdio shim.

Electron calls the library in-process. Web and Storybook attach with a URL and
token after the user starts the CLI. For local browser attach, run
`pnpm serve:local`; the script writes `.env` with
`LAPIS_AGENT_RUNTIME_TOKEN` when missing and starts `serve` with that token.
Consumer plugins must not depend on this package at runtime.

## Install

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

## Local development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

`pnpm build` writes publishable JavaScript and declarations to `dist/`. The
published package exports built files only; consumer manifests must use
portable registry dependency ranges rather than checkout-specific paths.

## Release

`@lapismd/ai-host@0.1.0` was manually bootstrapped from a reviewed tarball.
Prepare and review future release artifacts with:

```sh
pnpm release:plan --registry https://registry.npmjs.org
pnpm packages:pack
```

Future versions use Changesets version PRs and npm trusted publishing from
`.github/workflows/release.yml` after the `npm-production` trusted publisher is
configured.

Canonical requirements live in [`spec/src`](./spec/src).
