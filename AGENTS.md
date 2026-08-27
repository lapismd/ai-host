# AI Host agent guide

This repository owns the standalone process host package `@lapismd/ai-host`.

## Ownership

- Keep acpx, ACP session execution, disposable model discovery, the WebSocket
  server, token handshake, replay buffer, MCP stdio shim, `lapis-ai-host`
  CLI, and the portable `./file-tools` kernel in this repository.
- Consumer hosts (Deno desktop, web, Storybook, smoke supervisors) attach through
  public exports. Do not move vault, conversation, or plugin policy here.
- Consumer plugins MUST NOT depend on this package at runtime.
- `@lapis-notes/api` MAY depend on `@lapismd/ai-host/file-tools` only. That
  leaf must stay free of MCP, acpx, and transport imports.

## Canonical specification

Normative package behavior lives under [`spec/src`](./spec/src). Apply this
authority order when sources disagree:

1. Higher-level workspace instructions and this tracked guide.
2. The owning `AH-<AREA>-NNN` requirement and verification row in `spec/src`.
3. Public source, exported types, and the `lapis-ai-host` CLI contract.
4. Tests as verification evidence.
5. README and generated or mirrored documentation.

Update the owning canonical chapter before or with a protected implementation,
CLI, or package-script change. Run `pnpm spec:first` after changing protected
paths. The canonical path map is in
[`spec-governance.md`](./spec/src/spec-governance.md#change-map).

A code-only behavior change is prohibited even when tests pass. When code and
specification disagree, treat the code as defective unless an explicit
specification change is accepted.

## Package dependency policy

- Consume published LapisMD packages through normal npm semver ranges.
- Keep publishable manifests portable. Do not vendor dependency source, edit
  dependency `node_modules`, or add checkout-specific paths.
- If a LapisMD dependency needs a source fix, make the change in the owning
  repository, verify it there, and consume a released package version here.

## Workflow

1. Inspect `jj --no-pager st` and preserve unrelated changes.
2. Read the relevant specification page and requirement IDs.
3. Update the specification and verification map before implementation.
4. Add focused regression evidence for the changed boundary.
5. Run `pnpm spec:check`, `pnpm check`, `pnpm test`, and `pnpm build`.
6. Commit the verified slice with Jujutsu. This is a standing request; do not
   wait for the user to ask.

Generated `spec/book/` output is ignored and non-normative. Do not rewrite the
filtered source history after the retained migration audit has been recorded.
