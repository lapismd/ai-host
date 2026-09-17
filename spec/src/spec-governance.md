# Specification governance

Canonical requirements live under `spec/src`. Protected implementation changes
MUST update the mapped chapter in the same Jujutsu change.

## Requirements

| ID         | Requirement                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AH-GOV-001 | `spec/src` MUST remain the canonical standalone specification and MUST build with mdBook.                                                                                                                                                  |
| AH-GOV-002 | Protected package, source, CLI, validation, and agent-guidance changes MUST update an owning canonical chapter in the same Jujutsu change.                                                                                                 |
| AH-GOV-003 | Every normative requirement ID MUST be unique and MUST have exactly one verification row with concrete evidence.                                                                                                                           |
| AH-GOV-004 | The repository MUST retain the extraction boundary, filter rules, representative commit mappings, and history-audit evidence.                                                                                                              |
| AH-GOV-005 | The configured spec-first gate MUST map package, source, release, and documentation changes to Architecture, Protocol, Executor, or File tools. It MUST map validation, workspace, and agent-guidance changes to Specification Governance. |

## Change map

| Protected area                                                                                                                                            | Required chapter     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/serve.ts`, `src/parse-cli.ts`, `src/cli.ts`, `src/token.ts`                                                                                          | `protocol.md`        |
| `src/ws-server.ts`, `src/protocol.ts`, `src/replay-buffer.ts`, `src/client.ts`                                                                            | `protocol.md`        |
| `src/executor.ts`, `src/acp-agent.ts`, `src/acp-session-options.ts`, `src/acp-model-catalog.ts`                                                           | `executor.md`        |
| `src/mcp-shim.ts`, `src/mcp-shim-cli.ts`, `src/tool-bridge.ts`                                                                                            | `executor.md`        |
| `src/file-tools/`                                                                                                                                         | `file-tools.md`      |
| `src/cli/**`, `src/cli.ts`, `src/main.ts`, `deno.json`, `deno.lock`, `docs/cli/**`, `scripts/build-cli.ts`, `scripts/docs-cli.ts`, `scripts/smoke-cli.ts` | `cli.md`             |
| `package.json`, `src/index.ts`, `bin/`, `scripts/`, `.changeset/`, `.github/workflows/`, `CHANGELOG.md`, `LICENSE.md`, `README.md`                        | `architecture.md`    |
| `spec-validator.config.mjs`, `AGENTS.md`, `pnpm-workspace.yaml`, `spec/book.toml`, `.gitignore`                                                           | `spec-governance.md` |

The repository-owned validator configuration and pnpm workspace file remain
governance inputs, but `@lapismd/spec-validator` itself is consumed as the
published npm package when available. Removing a local validator override MUST
keep this chapter in the same change so future spec gates exercise the
published validator without weakening the mapped-change policy.

Tracked `AGENTS.md` is standing workflow: after a verified slice, commit with
Jujutsu. Do not wait for a later user request. Its consumer guidance names Deno
desktop, web, Storybook, and smoke supervisors; it does not authorize a second
native desktop host. Its dependency guidance requires published LapisMD
packages to resolve through npm semver ranges while source fixes stay owned by
their source repositories. The same guidance requires `pnpm audit` on every
check. `pnpm-workspace.yaml` MAY record overrides for patched transitive
advisories that the audit gate requires.

Standalone executable and operator CLI behavior is specified in [Standalone operator CLI](./cli.md). The CLI suppresses automatic token output; embedded library behavior remains compatible.

Operator implementation and executable release workflows now belong to the
sibling AI Controller. This repository validates the transport library, its
public declarations and private shim packaging; removed CLI paths remain mapped
so accidental reintroduction still requires canonical review.
