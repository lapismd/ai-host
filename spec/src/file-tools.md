# File tools

`@lapismd/ai-host/file-tools` is a portable kernel for OpenClaw-shaped
`read`, `write`, `edit`, and `apply_patch` algorithms. It owns schemas, alias
normalization, and text application. It MUST NOT import MCP, acpx, or WebSocket
code, and it MUST NOT perform vault, conversation, or plugin policy.

## Requirements

| ID        | Requirement |
| --------- | ----------- |
| AH-FT-001 | `@lapismd/ai-host` MUST publish a `./file-tools` export whose implementation imports only that leaf. The leaf MUST NOT import MCP, acpx, WebSocket, executor, or shim modules. Consumer plugins MUST NOT depend on the host package. `@lapis-notes/api` MAY depend on this export only. |
| AH-FT-002 | The kernel MUST accept OpenClaw `write` input `{ path, content }` and MUST treat that as a full-file create or overwrite plan. Path containment MUST be supplied by the caller. |
| AH-FT-003 | The kernel MUST accept OpenClaw `edit` input `{ path, edits: [{ oldText, newText }] }` and MUST hoist legacy flat `oldText`/`newText` plus `old_string`/`new_string`/`old_str`/`new_str` and `file_path` aliases. A JSON-string `edits` value MUST parse when it is an array. |
| AH-FT-004 | `edit` MUST replace each `oldText` against the original file text. Each hunk MUST match exactly once, MUST NOT overlap another hunk, and MUST change the text. Zero, repeated, or overlapping matches MUST fail without a planned write. |
| AH-FT-005 | The kernel MUST parse V4A envelopes bounded by `*** Begin Patch` and `*** End Patch` and MUST support `*** Add File`, `*** Update File` with optional `*** Move to`, and `*** Delete File`. It MUST plan every hunk before the first write or remove. Update hunks MUST apply in order through caller-supplied path resolution and file operations. |
| AH-FT-006 | File I/O MUST go through caller-supplied operations. The kernel MUST NOT read a vault, choose trash versus delete, or become a durable tool or note-content authority. |
| AH-FT-007 | Adapted OpenClaw algorithm sources MUST retain the MIT copyright notice in the leaf. |

### AH-FT-003 acceptance details

Alias normalization must:

- Prefer a non-empty canonical `edits` array when present.
- Hoist a legacy top-level old/new pair into `edits` when the array is absent.
- Accept `path` or `file_path`.
- Reject empty `edits` after normalization.
