# Architecture

The supported acpx runtime dependency is 0.17.1. Controller-owned session stores
are volatile; durable, sanitized transcript ownership belongs to ai-controller.

The package publishes built JavaScript and declarations for transport mechanics,
a compatibility `./client` bridge and a vault-free `./file-tools` kernel.
Production source lives under feature folders `protocol`, `acp`, `inventory`,
`executor`, `mcp`, `ws`, and `file-tools`. Executor catalog, session, process,
and tool commands live as named modules under `src/executor/`. Tool-bridge
types, framing, HTTP, and shim resolution live as named modules under
`src/mcp/`. WebSocket handshake, command dispatch, replay fan-out, and the
attach-client helpers live as named modules under `src/ws/`. `src/index.ts`
and `src/client.ts` remain public entry facades. It has no operator
executable or service lifecycle. The sibling AI Controller
owns durable orchestration, the shared application SDK and standalone Deno CLI.
Agent model discovery remains transport-owned. Public `listAcpModels`
returns a live session, the last-good in-process catalog, or the agent's
CLI/app-server inventory. A cache miss MUST NOT start a oneshot ACP session.
The private MCP stdio shim
is a subprocess helper, not an installed command; embedding executables may
supply their own launcher and call the exported `runMcpShim` function.
Protocol-v4 session configuration preserves that boundary: consumers request
provider-neutral model or thinking values, while the executor selects
advertised acpx keys and returns verified field results without exposing the
native handle.

Specification validation is root-only development tooling. The root manifest
MUST consume the published `@lapismd/spec-validator` package from npm.
Checkout-specific dependency resolution for the validator is not part of the
package architecture or consumer contract.

Release automation is package-owned and repository-local. The first
`@lapismd/ai-host` npm version is a manual bootstrap publish from a verified
tarball. Future versions use Changesets version pull requests, an immutable
tarball artifact, the `npm-production` trusted publishing environment, npm OIDC
provenance, and a per-package GitHub tag/release named `ai-host@<version>`.
The release pack gate MUST rebuild `dist` immediately before creating the
tarball so fresh CI checkouts and workstation runs validate the same artifact
shape.

## Requirements

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AH-PKG-001 | Public `@lapismd/ai-host` MUST live at the repository root, publish built `dist` entrypoints for the root library, `./client`, and `./file-tools`, and expose `build`, `check`, and `test`. It MUST own acpx, agent-scoped model discovery, and standalone transport error propagation. Consumer plugins MUST NOT depend on it at runtime. `@lapis-notes/api` MAY depend on `./file-tools` only. Shared specification validation MUST remain a root-only npm development dependency. |
| AH-PKG-002 | `@lapismd/ai-host` MUST own live local or authenticated-remote MCP transport through the official-SDK stdio shim, Streamable HTTP MCP, and token-authenticated broker. The `./file-tools` kernel MUST remain algorithm-only. The package MUST NOT become a durable tool, note-content, or conversation authority.                                                                                                                                                                    |
| AH-PKG-003 | The package MUST NOT install operator commands, expose a standalone service entrypoint, or seed application credentials. AI Controller MUST own operator lifecycle and credential initialization.                                                                                                                                                                                                                                                                                    |
| AH-PKG-006 | Embedding executables MUST be able to start AI Host without printing its bearer token, provide the complete stdio MCP launcher command, and invoke the package-owned MCP shim through an importable entrypoint. The private package-relative shim launcher MUST remain compatible; it MUST NOT be installed as a public command.                                                                                                                                                     |
| AH-PKG-004 | Release automation MUST use Changesets for future version pull requests, rebuild `dist`, build and validate the selected npm tarball before publication, use npm trusted publishing through the `npm-production` environment after trusted-publisher configuration, and create `ai-host@<version>` GitHub tags/releases from the verified release manifest.                                                                                                                          |
| AH-PKG-005 | The transport library MUST remain a non-authoritative ACP execution transport. A controller profile MUST expose only registered ACP lifecycle, replay, permission and application-tool operations; Nostr identity, conversation routing, signer custody and publication policy remain consumer responsibilities.                                                                                                                                                                     |

| AH-PKG-007 | Built declarations MUST preserve typed public contracts under TypeScript NodeNext and Bundler resolution. Relative declaration imports MUST resolve to emitted ESM paths rather than silently degrading public types to `any`. |
| AH-PKG-008 | Root `check` and `checks:release` MUST run `pnpm audit` against the committed lockfile. Release revalidation MUST invoke that audit explicitly. Fixable findings MUST be resolved with declared ranges or workspace overrides in the same change. |
| AH-ARCH-001 | Repository validation MUST enforce counted-line budgets and the feature dependency matrix with `scripts/check-architecture.mjs`. New production source MUST NOT exceed 300 counted lines. New tests MUST NOT exceed 500 counted lines. Existing files MUST NOT increase counted lines without updating the path budget in `scripts/architecture-baseline.json` in the same change. A recorded budget MUST fail when the current counted size plus twenty is still below that budget. Production modules MUST NOT import tests. `src/file-tools` MUST NOT import MCP, executor, or WebSocket transport. Feature modules MUST follow the published dependency matrix. Composition roots MAY import feature modules. Organisation plans under `docs/plans/` are not canonical requirements. |

Operator migration is specified in [the retired CLI boundary](./cli.md). AI
Controller owns runnable service commands; the private MCP shim remains an
importable execution helper. The next public version records that boundary as a
minor release so npm no longer advertises the retired `lapis-ai-host` command.

Root validation runs `pnpm audit` before typechecking so a lockfile or override
change cannot land with a known-vulnerable graph. Workspace overrides pin
transitive patches such as Vitest 4.1.11.

For AH-ARCH-001, `scripts/check-architecture.mjs` enforces counted-line budgets
and the feature dependency matrix. New production and script files must stay at
or under 300 counted lines; new tests at or under 500. Existing files must not
grow counted lines without updating `scripts/architecture-baseline.json` in the
same change. A recorded budget fails when the current counted size plus twenty
is still below that budget. Session startup configuration, including an
advertised harness permission mode, lives in `session-startup-config.ts`, and
the `session-lifecycle.ts` budget records that extraction. `src/file-tools` must not import MCP, executor, or
WebSocket transport. Organisation plans under `docs/plans/` are not canonical
requirements.

Session status exposes permission-mode application separately from a requested mode.
The executor retains deadline checks at the execution boundary; the controller
owns the provider-independent approval policy. The affected modules remain below
the 300-counted-line limit.

ACP permission registration and settlement live in `permission-request.ts`.
The callback registers before notification and clears timers and abort listeners
before publishing one terminal update. This keeps runtime creation separate from
interaction lifetime, including synchronous consumers.
