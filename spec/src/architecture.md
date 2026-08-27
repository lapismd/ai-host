# Architecture

The package lives at the repository root and publishes built JavaScript and
declaration files for the root library, a `./client` bridge, a vault-free
`./file-tools` kernel, and the `lapis-ai-host` and `lapis-mcp-shim` CLIs.
Disposable ACP model discovery returns raw ids plus structured labels and
badges for consumers. The development-only `serve:local` package script seeds
an ignored `.env` `LAPIS_AGENT_RUNTIME_TOKEN` when missing, then starts the
existing `serve` command with that token. It is a non-authoritative execution
transport: conversations, tool authority, and note content remain in the
consuming application. The file-tools leaf supplies schemas and apply
algorithms only. The stdio MCP projection launches the package-owned
`bin/lapis-mcp-shim.mjs` entrypoint in both source and built consumers; that
stable launcher delegates to the generated shim bundle.
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

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AH-PKG-001 | Public `@lapismd/ai-host` MUST live at the repository root, publish built `dist` entrypoints for the root library, `./client`, `./file-tools`, `lapis-ai-host`, and `lapis-mcp-shim`, and expose `build`, `check`, and `test`. It MUST own acpx, agent-scoped model discovery, and standalone transport error propagation. Consumer plugins MUST NOT depend on it at runtime. `@lapis-notes/api` MAY depend on `./file-tools` only. Shared specification validation MUST remain a root-only npm development dependency. |
| AH-PKG-002 | `@lapismd/ai-host` MUST own live local or authenticated-remote MCP transport through the official-SDK stdio shim, Streamable HTTP MCP, and token-authenticated broker. The `./file-tools` kernel MUST remain algorithm-only. The package MUST NOT become a durable tool, note-content, or conversation authority.                                                                                                                                                                                                       |
| AH-PKG-003 | The `serve:local` package script MUST remain development-only. It MUST seed an ignored `.env` `LAPIS_AGENT_RUNTIME_TOKEN` when that file or key is missing, then start `lapis-ai-host serve` with that token. It MUST NOT add a public CLI subcommand or change production token generation.                                                                                                                                                                                                                            |
| AH-PKG-004 | Release automation MUST use Changesets for future version pull requests, rebuild `dist`, build and validate the selected npm tarball before publication, use npm trusted publishing through the `npm-production` environment after trusted-publisher configuration, and create `ai-host@<version>` GitHub tags/releases from the verified release manifest.                                                                                                                      |
