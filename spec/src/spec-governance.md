# Specification governance

Canonical requirements live under `spec/src`. Protected implementation changes
MUST update the mapped chapter in the same Jujutsu change.

## Requirements

| ID         | Requirement                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AH-GOV-001 | `spec/src` MUST remain the canonical standalone specification and MUST build with mdBook.                                                                                                                                            |
| AH-GOV-002 | Protected package, source, CLI, validation, and agent-guidance changes MUST update an owning canonical chapter in the same Jujutsu change.                                                                                           |
| AH-GOV-003 | Every normative requirement ID MUST be unique and MUST have exactly one verification row with concrete evidence.                                                                                                                     |
| AH-GOV-004 | The repository MUST retain the extraction boundary, filter rules, representative commit mappings, and history-audit evidence.                                                                                                        |
| AH-GOV-005 | The configured spec-first gate MUST map package and source changes to Architecture, Protocol, Executor, or File tools. It MUST map validation, workspace, and agent-guidance changes to Specification Governance. |

## Change map

| Protected area | Required chapter |
| -------------- | ---------------- |
| `src/serve.ts`, `src/parse-cli.ts`, `src/cli.ts`, `src/token.ts` | `protocol.md` |
| `src/ws-server.ts`, `src/protocol.ts`, `src/replay-buffer.ts`, `src/client.ts` | `protocol.md` |
| `src/executor.ts`, `src/acp-agent.ts`, `src/acp-session-options.ts`, `src/acp-model-catalog.ts` | `executor.md` |
| `src/mcp-shim.ts`, `src/tool-bridge.ts` | `executor.md` |
| `src/file-tools/` | `file-tools.md` |
| `package.json`, `src/index.ts`, `bin/`, `scripts/` | `architecture.md` |
| `spec-validator.config.mjs`, `AGENTS.md`, `pnpm-workspace.yaml`, `spec/book.toml` | `spec-governance.md` |

Tracked `AGENTS.md` is standing workflow: after a verified slice, commit with
Jujutsu. Do not wait for a later user request.
