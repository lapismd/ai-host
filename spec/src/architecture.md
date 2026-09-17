# Architecture

The package publishes built JavaScript and declarations for transport mechanics,
a compatibility `./client` bridge and a vault-free `./file-tools` kernel.
It has no operator executable or service lifecycle. The sibling AI Controller
owns durable orchestration, the shared application SDK and standalone Deno CLI.
Disposable model discovery remains transport-owned. The private MCP stdio shim
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

Operator migration is specified in [the retired CLI boundary](./cli.md). AI
Controller owns runnable service commands; the private MCP shim remains an
importable execution helper. The next public version records that boundary as a
minor release so npm no longer advertises the retired `lapis-ai-host` command.

Root validation runs `pnpm audit` before typechecking so a lockfile or override
change cannot land with a known-vulnerable graph. Workspace overrides pin
transitive patches such as Vitest 4.1.11.
